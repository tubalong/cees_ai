import { ConflictException } from '@nestjs/common';
import { HrLeaveRequestStatus, HrLeaveUnit } from '@prisma/client';
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
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const LEAVE_TYPE_ID = '60000000-0000-0000-0000-000000000001';
const BALANCE_ID = '70000000-0000-0000-0000-000000000001';
const REQUEST_ID = '80000000-0000-0000-0000-000000000001';

function createService(prisma: Record<string, any>): HrService {
    const tenantContext = { require: jest.fn().mockReturnValue({
        tenantId: TENANT_ID, userId: USER_ID, membershipId: MEMBERSHIP_ID, requestId: 'request-id',
        roles: ['tenant_admin'], permissions: [],
    }) } as unknown as TenantContext;
    const scope = { resolve: jest.fn().mockResolvedValue({ tenantWide: true, membershipIds: [], departmentIds: [], projectIds: [], scopes: [] }) } as unknown as DataScopeResolverService;
    return new HrService(prisma as unknown as PrismaService, tenantContext, scope);
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        hrLeaveType: { findFirst: jest.fn() },
        hrLeaveBalance: { findFirst: jest.fn(), update: jest.fn() },
        hrLeaveRequest: { findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
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
    return { id: REQUEST_ID, tenantId: TENANT_ID, membershipId: MEMBERSHIP_ID, leaveTypeId: LEAVE_TYPE_ID,
        startAt: new Date('2026-09-21T01:00:00.000Z'), endAt: new Date('2026-09-22T09:00:00.000Z'),
        durationDays: 2, reason: '年假', status: HrLeaveRequestStatus.SUBMITTED, reviewedBy: null, reviewedAt: null,
        reviewComment: null, version: 1, createdAt: new Date('2026-09-17T00:00:00.000Z'), updatedAt: new Date('2026-09-17T00:00:00.000Z'), ...overrides };
}
