import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataScope } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { RbacService } from './rbac.service';

describe('RbacService', () => {
    it('returns the platform permission catalog', async () => {
        const prisma = createPrismaMock();
        prisma.permission.findMany.mockResolvedValue([
            permissionRecord(PERMISSION_ID, 'role.read', '查看角色'),
        ]);
        const service = createService(prisma);

        const result = await service.listPermissions();

        expect(result.items).toEqual([{ id: PERMISSION_ID, code: 'role.read', name: '查看角色' }]);
        expect(prisma.permission.findMany).toHaveBeenCalledWith({ orderBy: { code: 'asc' } });
    });

    it('lists only current tenant roles and returns a cursor', async () => {
        const prisma = createPrismaMock();
        prisma.role.findMany.mockResolvedValue([
            roleRecord({ id: ROLE_ID }),
            roleRecord({ id: SECOND_ROLE_ID, code: 'reviewer', name: '审核员' }),
        ]);
        const service = createService(prisma);

        const result = await service.listRoles({ limit: 1, keyword: 'manager' });

        expect(result.items).toHaveLength(1);
        expect(result.nextCursor).toBe(ROLE_ID);
        expect(prisma.role.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tenantId: TENANT_ID, deletedAt: null }),
            take: 2,
        }));
    });

    it('creates a tenant role with default AI permissions and writes audit', async () => {
        const prisma = createPrismaMock();
        prisma.role.findUnique.mockResolvedValue(null);
        prisma.role.create.mockResolvedValue({ id: ROLE_ID });
        prisma.permission.findMany.mockResolvedValue([
            permissionRecord(PERMISSION_ID, 'image.read', '查看图片'),
            permissionRecord(SECOND_PERMISSION_ID, 'document.read', '读取文档'),
        ]);
        prisma.role.findFirst.mockResolvedValue(roleRecord());
        const service = createService(prisma);

        const result = await service.createRole({
            code: 'manager',
            name: '项目经理',
            description: ' 管理项目 ',
            dataScope: DataScope.PROJECT,
        });

        expect(result.code).toBe('manager');
        expect(prisma.role.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: TENANT_ID,
                code: 'manager',
                name: '项目经理',
                description: '管理项目',
            }),
            select: { id: true },
        });
        expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
            data: [
                { tenantId: TENANT_ID, roleId: ROLE_ID, permissionId: PERMISSION_ID },
                { tenantId: TENANT_ID, roleId: ROLE_ID, permissionId: SECOND_PERMISSION_ID },
            ],
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'ROLE_CREATED', resourceId: ROLE_ID }),
        });
    });

    it('updates a custom role with optimistic locking', async () => {
        const prisma = createPrismaMock();
        prisma.role.findFirst
            .mockResolvedValueOnce(roleRecord())
            .mockResolvedValueOnce(roleRecord({ name: '高级项目经理', version: 2 }));
        prisma.role.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma);

        const result = await service.updateRole(ROLE_ID, { name: '高级项目经理', version: 1 });

        expect(result.version).toBe(2);
        expect(prisma.role.updateMany).toHaveBeenCalledWith({
            where: { id: ROLE_ID, tenantId: TENANT_ID, version: 1, deletedAt: null },
            data: expect.objectContaining({ name: '高级项目经理', version: { increment: 1 } }),
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'ROLE_UPDATED' }),
        });
    });

    it('protects system roles from modification', async () => {
        const prisma = createPrismaMock();
        prisma.role.findFirst.mockResolvedValue(roleRecord({
            code: 'tenant_admin',
            name: '租户管理员',
            isSystem: true,
        }));
        const service = createService(prisma);

        await expect(service.updateRole(ROLE_ID, { name: '管理员', version: 1 }))
            .rejects.toBeInstanceOf(ConflictException);
        expect(prisma.role.updateMany).not.toHaveBeenCalled();
    });

    it('replaces permissions and increments the role version', async () => {
        const prisma = createPrismaMock();
        prisma.role.findFirst
            .mockResolvedValueOnce(roleRecord())
            .mockResolvedValueOnce(roleRecord({
                version: 2,
                rolePermissions: [permissionAssignment(PERMISSION_ID, 'document.read', '读取文档')],
            }));
        prisma.permission.findMany.mockResolvedValue([{ id: PERMISSION_ID, code: 'document.read' }]);
        prisma.role.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma);

        const result = await service.replaceRolePermissions(ROLE_ID, {
            permissionIds: [PERMISSION_ID],
            version: 1,
        });

        expect(result.permissions).toEqual([{ id: PERMISSION_ID, code: 'document.read', name: '读取文档' }]);
        expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID, roleId: ROLE_ID } });
        expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
            data: [{ tenantId: TENANT_ID, roleId: ROLE_ID, permissionId: PERMISSION_ID }],
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'ROLE_PERMISSIONS_REPLACED' }),
        });
    });

    it('rejects permission ids outside the catalog', async () => {
        const prisma = createPrismaMock();
        prisma.role.findFirst.mockResolvedValue(roleRecord());
        prisma.permission.findMany.mockResolvedValue([]);
        const service = createService(prisma);

        await expect(service.replaceRolePermissions(ROLE_ID, {
            permissionIds: [PERMISSION_ID],
            version: 1,
        })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('prevents deleting a role that is still assigned', async () => {
        const prisma = createPrismaMock();
        prisma.role.findFirst.mockResolvedValue(roleRecord());
        prisma.membershipRole.count.mockResolvedValue(1);
        prisma.resourceAcl.count.mockResolvedValue(0);
        const service = createService(prisma);

        await expect(service.deleteRole(ROLE_ID, 1)).rejects.toMatchObject({
            response: { code: 'RBAC_ROLE_IN_USE' },
        });
        expect(prisma.role.deleteMany).not.toHaveBeenCalled();
    });

    it('deletes an unused custom role and preserves an audit trail', async () => {
        const prisma = createPrismaMock();
        prisma.role.findFirst.mockResolvedValue(roleRecord());
        prisma.membershipRole.count.mockResolvedValue(0);
        prisma.resourceAcl.count.mockResolvedValue(0);
        prisma.role.deleteMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma);

        await service.deleteRole(ROLE_ID, 1);

        expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID, roleId: ROLE_ID } });
        expect(prisma.role.deleteMany).toHaveBeenCalledWith({
            where: { id: ROLE_ID, tenantId: TENANT_ID, version: 1, isSystem: false },
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'ROLE_DELETED', resourceId: ROLE_ID }),
        });
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const ROLE_ID = '20000000-0000-0000-0000-000000000001';
const SECOND_ROLE_ID = '20000000-0000-0000-0000-000000000002';
const PERMISSION_ID = '30000000-0000-0000-0000-000000000001';
const SECOND_PERMISSION_ID = '30000000-0000-0000-0000-000000000002';

function createService(prisma: Record<string, any>): RbacService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'request-id',
            roles: ['tenant_admin'],
            permissions: ['role.read', 'role.create', 'role.update', 'role.delete'],
        }),
    } as unknown as TenantContext;
    return new RbacService(prisma as unknown as PrismaService, tenantContext);
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        permission: { findMany: jest.fn() },
        role: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            updateMany: jest.fn(),
            deleteMany: jest.fn(),
        },
        rolePermission: { deleteMany: jest.fn(), createMany: jest.fn() },
        membershipRole: { count: jest.fn() },
        resourceAcl: { count: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function roleRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: ROLE_ID,
        tenantId: TENANT_ID,
        code: 'manager',
        name: '项目经理',
        description: '管理项目',
        dataScope: DataScope.PROJECT,
        isSystem: false,
        version: 1,
        createdAt: new Date('2026-09-04T00:00:00.000Z'),
        updatedAt: new Date('2026-09-04T00:00:00.000Z'),
        deletedAt: null,
        rolePermissions: [],
        _count: { membershipRoles: 0 },
        ...overrides,
    };
}

function permissionRecord(id: string, code: string, name: string): Record<string, unknown> {
    return { id, code, name };
}

function permissionAssignment(id: string, code: string, name: string): Record<string, unknown> {
    return {
        permissionId: id,
        permission: permissionRecord(id, code, name),
    };
}
