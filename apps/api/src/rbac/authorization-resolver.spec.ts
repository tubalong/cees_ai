import { PrismaService } from '../database/prisma.service';
import { resolveMembershipAuthorization } from './authorization-resolver';

describe('resolveMembershipAuthorization', () => {
    it('resolves current roles and sorts unique permission codes', async () => {
        const prisma = createPrismaMock();
        prisma.membershipRole.findMany.mockResolvedValue([
            { roleId: ROLE_ID },
            { roleId: SECOND_ROLE_ID },
        ]);
        prisma.role.findMany.mockResolvedValue([
            { id: ROLE_ID, code: 'hr_admin' },
            { id: SECOND_ROLE_ID, code: 'finance_reviewer' },
        ]);
        prisma.rolePermission.findMany.mockResolvedValue([
            { permissionId: LEAVE_APPROVE_PERMISSION_ID },
            { permissionId: EXPENSE_APPROVE_PERMISSION_ID },
            { permissionId: LEAVE_APPROVE_PERMISSION_ID },
        ]);
        prisma.permission.findMany.mockResolvedValue([
            { code: 'finance.expense.approve' },
            { code: 'hr.leave.approve' },
        ]);

        const result = await resolveMembershipAuthorization(prisma as unknown as PrismaService, TENANT_ID, MEMBERSHIP_ID);

        expect(result.roles).toEqual(['finance_reviewer', 'hr_admin']);
        expect(result.permissions).toEqual(['finance.expense.approve', 'hr.leave.approve']);
    });

    it('ignores deleted roles when resolving permissions', async () => {
        const prisma = createPrismaMock();
        prisma.membershipRole.findMany.mockResolvedValue([
            { roleId: ROLE_ID },
            { roleId: SECOND_ROLE_ID },
        ]);
        prisma.role.findMany.mockResolvedValue([
            { id: ROLE_ID, code: 'hr_admin' },
        ]);
        prisma.rolePermission.findMany.mockResolvedValue([
            { permissionId: LEAVE_APPROVE_PERMISSION_ID },
        ]);
        prisma.permission.findMany.mockResolvedValue([
            { code: 'hr.leave.approve' },
        ]);

        const result = await resolveMembershipAuthorization(prisma as unknown as PrismaService, TENANT_ID, MEMBERSHIP_ID);

        expect(result.roles).toEqual(['hr_admin']);
        expect(result.permissions).toEqual(['hr.leave.approve']);
        expect(prisma.role.findMany).toHaveBeenCalledWith({
            where: {
                tenantId: TENANT_ID,
                id: { in: [ROLE_ID, SECOND_ROLE_ID] },
                deletedAt: null,
            },
            select: { id: true, code: true },
        });
    });

    it('returns empty authorization when the membership has no roles', async () => {
        const prisma = createPrismaMock();
        prisma.membershipRole.findMany.mockResolvedValue([]);

        const result = await resolveMembershipAuthorization(prisma as unknown as PrismaService, TENANT_ID, MEMBERSHIP_ID);

        expect(result).toEqual({ roles: [], permissions: [] });
        expect(prisma.role.findMany).not.toHaveBeenCalled();
        expect(prisma.permission.findMany).not.toHaveBeenCalled();
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const ROLE_ID = '20000000-0000-0000-0000-000000000001';
const SECOND_ROLE_ID = '20000000-0000-0000-0000-000000000002';
const LEAVE_APPROVE_PERMISSION_ID = '30000000-0000-0000-0000-000000000001';
const EXPENSE_APPROVE_PERMISSION_ID = '30000000-0000-0000-0000-000000000002';

function createPrismaMock(): Record<string, any> {
    return {
        membershipRole: { findMany: jest.fn() },
        role: { findMany: jest.fn() },
        rolePermission: { findMany: jest.fn() },
        permission: { findMany: jest.fn() },
    };
}
