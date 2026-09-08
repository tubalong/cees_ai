import { ConflictException } from '@nestjs/common';
import { DepartmentStatus, MembershipStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from './tenant-context';
import { TenantService } from './tenant.service';

describe('TenantService', () => {
    it('updates the current tenant with optimistic locking and audit', async () => {
        const prisma = createPrismaMock();
        const current = tenantRecord();
        prisma.tenant.findFirst
            .mockResolvedValueOnce(current)
            .mockResolvedValueOnce({ ...current, name: 'CEES Updated', version: 2 });
        prisma.tenant.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma);

        const result = await service.updateCurrentTenant({ name: 'CEES Updated', version: 1 });

        expect(result.name).toBe('CEES Updated');
        expect(result.version).toBe(2);
        expect(prisma.tenant.updateMany).toHaveBeenCalledWith({
            where: { id: TENANT_ID, version: 1, deletedAt: null },
            data: { name: 'CEES Updated', version: { increment: 1 } },
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'TENANT_UPDATED', resourceId: TENANT_ID }),
        });
    });

    it('lists only current tenant members and returns a cursor', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findMany.mockResolvedValue([
            memberRecord({ id: MEMBER_ID }),
            memberRecord({ id: SECOND_MEMBER_ID }),
        ]);
        const service = createService(prisma);

        const result = await service.listMembers({ limit: 1, keyword: 'admin' });

        expect(result.items).toHaveLength(1);
        expect(result.nextCursor).toBe(MEMBER_ID);
        expect(prisma.tenantMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tenantId: TENANT_ID, deletedAt: null }),
            take: 2,
        }));
    });

    it('disables a member, revokes sessions and writes audit', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst
            .mockResolvedValueOnce(memberRecord())
            .mockResolvedValueOnce(memberRecord({ status: MembershipStatus.DISABLED, version: 2 }));
        prisma.tenantMembership.updateMany.mockResolvedValue({ count: 1 });
        prisma.authSession.updateMany.mockResolvedValue({ count: 2 });
        const service = createService(prisma);

        const result = await service.updateMember(MEMBER_ID, {
            status: MembershipStatus.DISABLED,
            version: 1,
        });

        expect(result.status).toBe(MembershipStatus.DISABLED);
        expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
            where: { tenantId: TENANT_ID, membershipId: MEMBER_ID, revokedAt: null },
            data: { revokedAt: expect.any(Date) },
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'MEMBER_DISABLED', resourceId: MEMBER_ID }),
        });
    });

    it('prevents the current member from disabling itself', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst.mockResolvedValue(memberRecord({ id: CURRENT_MEMBERSHIP_ID }));
        const service = createService(prisma);

        await expect(service.updateMember(CURRENT_MEMBERSHIP_ID, {
            status: MembershipStatus.DISABLED,
            version: 1,
        })).rejects.toMatchObject({ response: { code: 'TENANT_MEMBER_SELF_OPERATION' } });
    });

    it('prevents removing the last active tenant administrator', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst.mockResolvedValue(memberRecord({
            membershipRoles: [roleAssignment(ADMIN_ROLE_ID, 'tenant_admin', '租户管理员')],
        }));
        prisma.tenantMembership.count.mockResolvedValue(0);
        const service = createService(prisma);

        await expect(service.removeMember(MEMBER_ID)).rejects.toBeInstanceOf(ConflictException);
        expect(prisma.tenantMembership.updateMany).not.toHaveBeenCalled();
    });

    it('replaces member roles in one transaction and increments membership version', async () => {
        const prisma = createPrismaMock();
        const newRoleId = '20000000-0000-0000-0000-000000000002';
        prisma.tenantMembership.findFirst
            .mockResolvedValueOnce(memberRecord())
            .mockResolvedValueOnce(memberRecord({
                version: 2,
                membershipRoles: [roleAssignment(newRoleId, 'manager', '项目经理')],
            }));
        prisma.role.findMany.mockResolvedValue([{ id: newRoleId, code: 'manager', name: '项目经理' }]);
        prisma.tenantMembership.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma);

        const result = await service.replaceMemberRoles(MEMBER_ID, {
            roleIds: [newRoleId],
            version: 1,
        });

        expect(result.roles).toEqual([{ id: newRoleId, code: 'manager', name: '项目经理' }]);
        expect(prisma.membershipRole.deleteMany).toHaveBeenCalledWith({
            where: { tenantId: TENANT_ID, membershipId: MEMBER_ID },
        });
        expect(prisma.membershipRole.createMany).toHaveBeenCalledWith({
            data: [{ tenantId: TENANT_ID, membershipId: MEMBER_ID, roleId: newRoleId }],
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'MEMBER_ROLES_REPLACED' }),
        });
    });

    it('changes a member account and revokes existing sessions', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst
            .mockResolvedValueOnce(memberRecord())
            .mockResolvedValueOnce(memberRecord({ account: 'member2', normalizedAccount: 'member2', version: 2 }));
        prisma.tenantMembership.findUnique.mockResolvedValue(null);
        prisma.tenantMembership.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma);

        const result = await service.updateMemberAccount(MEMBER_ID, { account: 'Member2', version: 1 });

        expect(result.account).toBe('member2');
        expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
            where: { tenantId: TENANT_ID, membershipId: MEMBER_ID, revokedAt: null },
            data: { revokedAt: expect.any(Date) },
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'TENANT_MEMBER_ACCOUNT_CHANGED' }),
        });
    });

    it('changes a member department only with the department assignment permission', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst
            .mockResolvedValueOnce(memberRecord())
            .mockResolvedValueOnce(memberRecord({ departmentId: DEPARTMENT_ID, version: 2 }));
        prisma.department.findFirst.mockResolvedValue({ id: DEPARTMENT_ID, status: DepartmentStatus.ACTIVE });
        prisma.tenantMembership.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma);

        const result = await service.updateMember(MEMBER_ID, { departmentId: DEPARTMENT_ID, version: 1 });

        expect(result.departmentId).toBe(DEPARTMENT_ID);
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'MEMBER_DEPARTMENT_CHANGED' }),
        });
    });

    it('rejects department changes without the department assignment permission', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst.mockResolvedValue(memberRecord());
        const service = createService(prisma, ['member.update']);

        await expect(service.updateMember(MEMBER_ID, {
            departmentId: DEPARTMENT_ID,
            version: 1,
        })).rejects.toMatchObject({ response: { code: 'AUTH_PERMISSION_DENIED' } });
        expect(prisma.department.findFirst).not.toHaveBeenCalled();
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const CURRENT_MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const MEMBER_ID = '50000000-0000-0000-0000-000000000002';
const SECOND_MEMBER_ID = '50000000-0000-0000-0000-000000000003';
const ADMIN_ROLE_ID = '20000000-0000-0000-0000-000000000001';
const DEPARTMENT_ID = '60000000-0000-0000-0000-000000000001';

function createService(prisma: Record<string, any>, permissions?: string[]): TenantService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: CURRENT_MEMBERSHIP_ID,
            requestId: 'request-id',
            roles: ['tenant_admin'],
            permissions: permissions ?? [
                'tenant.read',
                'tenant.update',
                'member.read',
                'member.update',
                'member.remove',
                'role.assign',
                'department.member.assign',
            ],
        }),
    } as unknown as TenantContext;
    return new TenantService(prisma as unknown as PrismaService, tenantContext);
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        tenant: { findFirst: jest.fn(), updateMany: jest.fn() },
        tenantMembership: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
            updateMany: jest.fn(),
            count: jest.fn(),
        },
        department: { findFirst: jest.fn() },
        role: { findMany: jest.fn() },
        membershipRole: { deleteMany: jest.fn(), createMany: jest.fn() },
        authSession: { updateMany: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function tenantRecord(): Record<string, unknown> {
    return {
        id: TENANT_ID,
        code: 'cees',
        name: 'CEES',
        status: TenantStatus.ACTIVE,
        version: 1,
        createdAt: new Date('2026-09-04T00:00:00.000Z'),
        updatedAt: new Date('2026-09-04T00:00:00.000Z'),
        deletedAt: null,
    };
}

function memberRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: MEMBER_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        departmentId: null,
        displayName: 'Tenant Member',
        account: 'member1',
        normalizedAccount: 'member1',
        passwordHash: 'password-hash',
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: null,
        status: MembershipStatus.ACTIVE,
        joinedAt: new Date('2026-09-04T00:00:00.000Z'),
        version: 1,
        deletedAt: null,
        user: {
            id: USER_ID,
            displayName: 'Global Member',
        },
        membershipRoles: [roleAssignment('20000000-0000-0000-0000-000000000003', 'member', '普通成员')],
        ...overrides,
    };
}

function roleAssignment(roleId: string, code: string, name: string): Record<string, unknown> {
    return {
        roleId,
        role: { id: roleId, code, name, deletedAt: null },
    };
}
