import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
    HrEmployeeChangeStatus, HrEmployeeChangeType, HrLeaveRequestStatus, HrLeaveUnit, HrProfileStatus, MembershipStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { DataScopeResolverService } from '../rbac/data-scope-resolver.service';
import { TenantContext } from '../tenant/tenant-context';
import { HrService } from './hr.service';

describe('HrService', () => {
    it('reserves leave balance when submitting a request', async () => {
        const prisma = createPrismaMock();
        prisma.hrLeaveType.findFirst.mockResolvedValue({ id: LEAVE_TYPE_ID, enabled: true, unit: HrLeaveUnit.DAY });
        prisma.hrLeaveBalance.findFirst.mockResolvedValue(balanceRecord({ remainingDays: 10 }));
        prisma.hrLeaveRequest.create.mockResolvedValue(leaveRequestRecord());
        const service = createService(prisma);

        const result = await service.createLeaveRequest({
            leaveTypeId: LEAVE_TYPE_ID,
            startAt: '2026-09-21T01:00:00.000Z',
            endAt: '2026-09-22T09:00:00.000Z',
            durationDays: 2,
            reason: '年假',
        });

        expect(result.status).toBe(HrLeaveRequestStatus.SUBMITTED);
        expect(prisma.hrLeaveBalance.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ pendingDays: { increment: 2 }, remainingDays: { decrement: 2 } }),
        }));
        expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ action: 'HR_LEAVE_REQUEST_SUBMITTED' }),
        }));
    });

    it('rejects a leave request when balance is insufficient', async () => {
        const prisma = createPrismaMock();
        prisma.hrLeaveType.findFirst.mockResolvedValue({ id: LEAVE_TYPE_ID, enabled: true, unit: HrLeaveUnit.DAY });
        prisma.hrLeaveBalance.findFirst.mockResolvedValue(balanceRecord({ remainingDays: 1 }));
        const service = createService(prisma);

        await expect(service.createLeaveRequest({
            leaveTypeId: LEAVE_TYPE_ID,
            startAt: '2026-09-21T01:00:00.000Z',
            endAt: '2026-09-22T09:00:00.000Z',
            durationDays: 2,
        })).rejects.toBeInstanceOf(ConflictException);
    });

    it('moves reserved balance to used balance when approved', async () => {
        const prisma = createPrismaMock();
        prisma.hrLeaveRequest.findFirst.mockResolvedValue(leaveRequestRecord());
        prisma.hrLeaveBalance.findFirst.mockResolvedValue(balanceRecord());
        prisma.hrLeaveRequest.updateMany.mockResolvedValue({ count: 1 });
        prisma.hrLeaveRequest.findUniqueOrThrow.mockResolvedValue(leaveRequestRecord({ status: HrLeaveRequestStatus.APPROVED, version: 2 }));
        const service = createService(prisma);

        const result = await service.reviewLeaveRequest(REQUEST_ID, { decision: 'APPROVE', version: 1 });

        expect(result.status).toBe(HrLeaveRequestStatus.APPROVED);
        expect(prisma.hrLeaveBalance.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ pendingDays: { decrement: 2 }, usedDays: { increment: 2 } }),
        }));
    });

    it('masks sensitive profile fields without sensitive read permission', async () => {
        const prisma = createPrismaMock();
        prisma.hrProfile.findFirst.mockResolvedValue(profileRecord());
        const service = createService(prisma, ['hr.profile.read']);

        const result = await service.getProfile(MEMBERSHIP_ID);

        expect(result).toEqual(expect.objectContaining({
            phone: '138****8000',
            email: 'z***@example.com',
            idType: '***',
            idNumber: '**************1234',
            emergencyContactName: '张*',
            emergencyContactPhone: '139****0000',
        }));
    });

    it('returns full sensitive profile fields with sensitive read permission', async () => {
        const prisma = createPrismaMock();
        prisma.hrProfile.findFirst.mockResolvedValue(profileRecord());
        const service = createService(prisma, ['hr.profile.read', 'hr.profile.sensitive.read']);

        const result = await service.getProfile(MEMBERSHIP_ID);

        expect(result).toEqual(expect.objectContaining({
            phone: '13812348000',
            email: 'zhangsan@example.com',
            idType: '身份证',
            idNumber: '110101199001011234',
            emergencyContactName: '张三',
            emergencyContactPhone: '13912340000',
        }));
    });

    it('rejects sensitive profile updates without sensitive manage permission', async () => {
        const service = createService(createPrismaMock(), ['hr.profile.manage']);

        await expect(service.updateProfile(MEMBERSHIP_ID, { phone: '13812348000', version: 1 }))
            .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows sensitive profile updates with sensitive manage permission', async () => {
        const prisma = createPrismaMock();
        prisma.hrProfile.findFirst.mockResolvedValue(profileRecord());
        prisma.hrProfile.updateMany.mockResolvedValue({ count: 1 });
        prisma.hrProfile.findFirstOrThrow.mockResolvedValue(profileRecord({ phone: '13800000000', version: 2 }));
        const service = createService(prisma, ['hr.profile.manage', 'hr.profile.sensitive.manage', 'hr.profile.sensitive.read']);

        const result = await service.updateProfile(MEMBERSHIP_ID, { phone: '13800000000', version: 1 });

        expect(result.phone).toBe('13800000000');
        expect(prisma.hrProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ phone: '13800000000' }),
        }));
    });

    it.each([HrEmployeeChangeType.RESIGNATION, HrEmployeeChangeType.TERMINATION])(
        'disables the tenant subject and revokes sessions for approved %s',
        async (type) => {
            const prisma = createPrismaMock();
            prisma.hrEmployeeChange.findFirst.mockResolvedValue(employeeChangeRecord({ type }));
            prisma.hrEmployeeChange.updateMany.mockResolvedValue({ count: 1 });
            prisma.hrEmployeeChange.findUniqueOrThrow.mockResolvedValue(employeeChangeRecord({
                type,
                status: HrEmployeeChangeStatus.EFFECTIVE,
                version: 2,
            }));
            prisma.hrProfile.updateMany.mockResolvedValue({ count: 1 });
            prisma.tenantMembership.findFirst.mockResolvedValue(membershipRecord());
            prisma.tenantMembership.updateMany.mockResolvedValue({ count: 1 });
            prisma.authSession.updateMany.mockResolvedValue({ count: 2 });
            const service = createService(prisma, ['hr.employee_change.approve']);

            await service.reviewEmployeeChange(EMPLOYEE_CHANGE_ID, { decision: 'APPROVE', version: 1 });

            expect(prisma.hrProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ leaveDate: expect.any(Date), status: HrProfileStatus.TERMINATED }),
            }));
            expect(prisma.tenantMembership.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ status: MembershipStatus.DISABLED }),
            }));
            expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
                where: { tenantId: TENANT_ID, membershipId: OFFBOARDED_MEMBERSHIP_ID, revokedAt: null },
                data: { revokedAt: expect.any(Date) },
            });
            expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    action: 'HR_OFFBOARDING_SUBJECT_DISABLED',
                    resourceType: 'TENANT_MEMBERSHIP',
                    resourceId: OFFBOARDED_MEMBERSHIP_ID,
                    metadata: {
                        employeeChangeId: EMPLOYEE_CHANGE_ID,
                        employeeChangeType: type,
                        revokedSessionCount: 2,
                    },
                }),
            }));
        },
    );

    it('prevents offboarding the last active tenant administrator', async () => {
        const prisma = createPrismaMock();
        prisma.hrEmployeeChange.findFirst.mockResolvedValue(employeeChangeRecord());
        prisma.hrEmployeeChange.updateMany.mockResolvedValue({ count: 1 });
        prisma.hrProfile.updateMany.mockResolvedValue({ count: 1 });
        prisma.tenantMembership.findFirst.mockResolvedValue(membershipRecord({
            membershipRoles: [{ role: { code: 'tenant_admin' } }],
        }));
        prisma.tenantMembership.count.mockResolvedValue(0);
        const service = createService(prisma, ['hr.employee_change.approve']);

        await expect(service.reviewEmployeeChange(EMPLOYEE_CHANGE_ID, { decision: 'APPROVE', version: 1 }))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'TENANT_LAST_ADMIN' }) });
        expect(prisma.tenantMembership.updateMany).not.toHaveBeenCalled();
        expect(prisma.authSession.updateMany).not.toHaveBeenCalled();
    });

    it('derives the leave duration on the server and rejects a mismatching client value', async () => {
        const prisma = createPrismaMock();
        prisma.hrLeaveType.findFirst.mockResolvedValue({ id: LEAVE_TYPE_ID, enabled: true, unit: HrLeaveUnit.DAY });
        const service = createService(prisma, ['hr.leave.request']);

        await expect(service.createLeaveRequest({
            leaveTypeId: LEAVE_TYPE_ID,
            startAt: '2026-09-21T01:00:00.000Z',
            endAt: '2026-09-22T09:00:00.000Z',
            durationDays: 0.5,
        })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'HR_LEAVE_DURATION_MISMATCH' }),
        });
        expect(prisma.hrLeaveRequest.create).not.toHaveBeenCalled();
    });

    it('rejects a sub-minute hourly leave request that rounds down to zero days', async () => {
        const prisma = createPrismaMock();
        prisma.hrLeaveType.findFirst.mockResolvedValue({ id: LEAVE_TYPE_ID, enabled: true, unit: HrLeaveUnit.HOUR });
        const service = createService(prisma, ['hr.leave.request']);

        await expect(service.createLeaveRequest({
            leaveTypeId: LEAVE_TYPE_ID,
            startAt: '2026-09-21T01:00:00.000Z',
            endAt: '2026-09-21T01:00:30.000Z',
        })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'HR_LEAVE_DURATION_TOO_SHORT' }),
        });
        expect(prisma.hrLeaveRequest.create).not.toHaveBeenCalled();
    });

    it('rejects a leave request overlapping an existing submitted request', async () => {
        const prisma = createPrismaMock();
        prisma.hrLeaveType.findFirst.mockResolvedValue({ id: LEAVE_TYPE_ID, enabled: true, unit: HrLeaveUnit.DAY });
        prisma.hrLeaveRequest.findFirst.mockResolvedValue({ id: REQUEST_ID });
        const service = createService(prisma, ['hr.leave.request']);

        await expect(service.createLeaveRequest({
            leaveTypeId: LEAVE_TYPE_ID,
            startAt: '2026-09-21T01:00:00.000Z',
            endAt: '2026-09-22T09:00:00.000Z',
        })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'HR_LEAVE_REQUEST_OVERLAP' }),
        });
        expect(prisma.hrLeaveRequest.create).not.toHaveBeenCalled();
    });

    it('splits a cross-year leave request across both years and reserves each year', async () => {
        const prisma = createPrismaMock();
        prisma.hrLeaveType.findFirst.mockResolvedValue({ id: LEAVE_TYPE_ID, enabled: true, unit: HrLeaveUnit.DAY });
        prisma.hrLeaveBalance.findFirst.mockResolvedValue(balanceRecord({ remainingDays: 10 }));
        prisma.hrLeaveRequest.create.mockImplementation(async ({ data }: Record<string, any>) =>
            leaveRequestRecord({ ...data, id: REQUEST_ID }));
        const service = createService(prisma, ['hr.leave.request']);

        const result = await service.createLeaveRequest({
            leaveTypeId: LEAVE_TYPE_ID,
            startAt: '2026-12-28T00:00:00.000Z',
            endAt: '2027-01-05T00:00:00.000Z',
        });

        expect(result.durationDays).toBe(9);
        expect(result.yearAllocations).toEqual([{ year: 2026, days: 4 }, { year: 2027, days: 5 }]);
        expect(prisma.hrLeaveRequest.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ yearAllocations: [{ year: 2026, days: 4 }, { year: 2027, days: 5 }] }),
        }));
        expect(prisma.hrLeaveBalance.update).toHaveBeenCalledTimes(2);
    });

    it('prevents reviewing your own leave request', async () => {
        const prisma = createPrismaMock();
        prisma.hrLeaveRequest.findFirst.mockResolvedValue(leaveRequestRecord({ membershipId: MEMBERSHIP_ID }));
        const service = createService(prisma, ['hr.leave.approve']);

        await expect(service.reviewLeaveRequest(REQUEST_ID, { decision: 'APPROVE', version: 1 }))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'HR_SELF_REVIEW_FORBIDDEN' }) });
        expect(prisma.hrLeaveBalance.update).not.toHaveBeenCalled();
    });

    it('rejects profile status and leave date edits that bypass employee changes', async () => {
        const prisma = createPrismaMock();
        const service = createService(prisma, ['hr.profile.manage']);

        await expect(service.updateProfile(MEMBERSHIP_ID, { status: HrProfileStatus.TERMINATED, version: 1 }))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'HR_PROFILE_TERMINATION_REQUIRES_CHANGE' }) });
        await expect(service.updateProfile(MEMBERSHIP_ID, { leaveDate: '2026-09-30', version: 1 }))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'HR_PROFILE_LEAVE_DATE_REQUIRES_CHANGE' }) });
        expect(prisma.hrProfile.updateMany).not.toHaveBeenCalled();
    });

    it('syncs the tenant membership department when the profile department changes', async () => {
        const prisma = createPrismaMock();
        prisma.hrProfile.findFirst.mockResolvedValue(profileRecord());
        prisma.hrProfile.updateMany.mockResolvedValue({ count: 1 });
        prisma.hrProfile.findFirstOrThrow.mockResolvedValue(profileRecord({ departmentId: DEPARTMENT_ID, version: 2 }));
        prisma.department.findFirst.mockResolvedValue({ id: DEPARTMENT_ID });
        prisma.tenantMembership.findMany.mockResolvedValue([]);
        const service = createService(prisma, ['hr.profile.manage', 'department.member.assign']);

        await service.updateProfile(MEMBERSHIP_ID, { departmentId: DEPARTMENT_ID, version: 1 });

        expect(prisma.tenantMembership.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ departmentId: DEPARTMENT_ID }),
        }));
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const LEAVE_TYPE_ID = '60000000-0000-0000-0000-000000000001';
const BALANCE_ID = '70000000-0000-0000-0000-000000000001';
const REQUEST_ID = '80000000-0000-0000-0000-000000000001';
const OFFBOARDED_MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000002';
const EMPLOYEE_CHANGE_ID = '90000000-0000-0000-0000-000000000001';
const REQUESTER_MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000003';
const DEPARTMENT_ID = '40000000-0000-0000-0000-000000000001';

function createService(prisma: Record<string, any>, permissions: string[] = []): HrService {
    const tenantContext = { require: jest.fn().mockReturnValue({
        tenantId: TENANT_ID, userId: USER_ID, membershipId: MEMBERSHIP_ID, requestId: 'request-id',
        roles: ['tenant_admin'], permissions,
    }) } as unknown as TenantContext;
    const scope = { resolve: jest.fn().mockResolvedValue({ tenantWide: true, membershipIds: [], departmentIds: [], projectIds: [], scopes: [] }) } as unknown as DataScopeResolverService;
    return new HrService(prisma as unknown as PrismaService, tenantContext, scope);
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        hrLeaveType: { findFirst: jest.fn() },
        hrLeaveBalance: { findFirst: jest.fn(), update: jest.fn() },
        hrLeaveRequest: { findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
        hrProfile: { findFirst: jest.fn(), updateMany: jest.fn(), findFirstOrThrow: jest.fn() },
        hrEmployeeChange: { findFirst: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
        tenantMembership: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
        tenant: { findFirst: jest.fn() },
        department: { findFirst: jest.fn() },
        authSession: { updateMany: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function balanceRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { id: BALANCE_ID, tenantId: TENANT_ID, membershipId: MEMBERSHIP_ID, leaveTypeId: LEAVE_TYPE_ID,
        year: 2026, totalDays: 10, usedDays: 0, pendingDays: 2, remainingDays: 8, unit: HrLeaveUnit.DAY,
        version: 1, createdAt: new Date('2026-09-01T00:00:00.000Z'), updatedAt: new Date('2026-09-01T00:00:00.000Z'), ...overrides };
}

function leaveRequestRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { id: REQUEST_ID, tenantId: TENANT_ID, membershipId: REQUESTER_MEMBERSHIP_ID, leaveTypeId: LEAVE_TYPE_ID,
        startAt: new Date('2026-09-21T01:00:00.000Z'), endAt: new Date('2026-09-22T09:00:00.000Z'),
        durationDays: 2, reason: '年假', status: HrLeaveRequestStatus.SUBMITTED, reviewedBy: null, reviewedAt: null,
        reviewComment: null, version: 1, createdAt: new Date('2026-09-17T00:00:00.000Z'), updatedAt: new Date('2026-09-17T00:00:00.000Z'), ...overrides };
}

function profileRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: '51000000-0000-0000-0000-000000000001', tenantId: TENANT_ID, membershipId: MEMBERSHIP_ID,
        employeeNo: 'E001', displayName: '张三', departmentId: null, position: '工程师', employmentType: '全职',
        managerMembershipId: null, entryDate: new Date('2026-01-01T00:00:00.000Z'), leaveDate: null,
        phone: '13812348000', email: 'zhangsan@example.com', idType: '身份证', idNumber: '110101199001011234',
        emergencyContactName: '张三', emergencyContactPhone: '13912340000', educationLevel: '本科', costCenter: null,
        jobLevel: 'P5', probationEndDate: null, regularDate: null, workLocation: '上海', status: HrProfileStatus.ACTIVE,
        version: 1, createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-09-17T00:00:00.000Z'),
        ...overrides,
    };
}

function employeeChangeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: EMPLOYEE_CHANGE_ID, tenantId: TENANT_ID, membershipId: OFFBOARDED_MEMBERSHIP_ID,
        type: HrEmployeeChangeType.RESIGNATION, effectiveDate: new Date('2026-09-30T00:00:00.000Z'),
        fromDepartmentId: null, toDepartmentId: null, fromPosition: '工程师', toPosition: null,
        fromManagerMembershipId: null, toManagerMembershipId: null, reason: '个人原因',
        status: HrEmployeeChangeStatus.SUBMITTED, reviewedBy: null, reviewedAt: null, reviewComment: null,
        version: 1, createdAt: new Date('2026-09-17T00:00:00.000Z'), updatedAt: new Date('2026-09-17T00:00:00.000Z'),
        ...overrides,
    };
}

function membershipRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: OFFBOARDED_MEMBERSHIP_ID, tenantId: TENANT_ID, departmentId: null, status: MembershipStatus.ACTIVE,
        membershipRoles: [], version: 1, ...overrides,
    };
}
