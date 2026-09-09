import { ConflictException } from '@nestjs/common';
import { DepartmentStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { TenantService } from '../tenant/tenant.service';
import { OrganizationService } from './organization.service';

describe('OrganizationService', () => {
    it('builds the current tenant department tree', async () => {
        const prisma = createPrismaMock();
        prisma.department.findMany.mockResolvedValue([
            departmentRecord({ id: ROOT_DEPARTMENT_ID }),
            departmentRecord({ id: CHILD_DEPARTMENT_ID, parentId: ROOT_DEPARTMENT_ID, name: '研发部' }),
        ]);
        const service = createService(prisma);

        const result = await service.listDepartments({});

        expect(result.items).toHaveLength(1);
        expect(result.items[0].children[0].id).toBe(CHILD_DEPARTMENT_ID);
        expect(prisma.department.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenantId: TENANT_ID, deletedAt: null, status: undefined },
        }));
    });

    it('creates a normalized department and writes audit', async () => {
        const prisma = createPrismaMock();
        prisma.department.findMany.mockResolvedValue([]);
        prisma.department.create.mockResolvedValue({ id: ROOT_DEPARTMENT_ID });
        prisma.department.findFirst.mockResolvedValue(departmentRecord());
        const service = createService(prisma);

        const result = await service.createDepartment({ name: '  Research   Center ', parentId: null, sortOrder: 3 });

        expect(result.id).toBe(ROOT_DEPARTMENT_ID);
        expect(prisma.department.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: TENANT_ID,
                name: 'Research Center',
                normalizedName: 'research center',
                sortOrder: 3,
            }),
            select: { id: true },
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'DEPARTMENT_CREATED', resourceId: ROOT_DEPARTMENT_ID }),
        });
    });

    it('rejects moving a department below its descendant', async () => {
        const prisma = createPrismaMock();
        prisma.department.findFirst.mockResolvedValue(departmentRecord());
        prisma.department.findMany.mockResolvedValue([
            { id: ROOT_DEPARTMENT_ID, parentId: null, status: DepartmentStatus.ACTIVE },
            { id: CHILD_DEPARTMENT_ID, parentId: ROOT_DEPARTMENT_ID, status: DepartmentStatus.ACTIVE },
        ]);
        const service = createService(prisma);

        await expect(service.updateDepartment(ROOT_DEPARTMENT_ID, {
            parentId: CHILD_DEPARTMENT_ID,
            version: 1,
        })).rejects.toMatchObject({ response: { code: 'DEPARTMENT_HIERARCHY_INVALID' } });
        expect(prisma.department.updateMany).not.toHaveBeenCalled();
    });

    it('prevents deleting a department that still has children', async () => {
        const prisma = createPrismaMock();
        prisma.department.findFirst.mockResolvedValue(departmentRecord());
        prisma.department.count.mockResolvedValue(1);
        prisma.tenantMembership.count.mockResolvedValue(0);
        const service = createService(prisma);

        await expect(service.deleteDepartment(ROOT_DEPARTMENT_ID, 1)).rejects.toBeInstanceOf(ConflictException);
        expect(prisma.department.updateMany).not.toHaveBeenCalled();
    });

    it('delegates member department assignment to the tenant service', async () => {
        const prisma = createPrismaMock();
        const tenantService = {
            updateMember: jest.fn().mockResolvedValue({ id: MEMBERSHIP_ID, departmentId: ROOT_DEPARTMENT_ID }),
        } as unknown as TenantService;
        const service = createService(prisma, tenantService);

        const result = await service.assignMemberDepartment(MEMBERSHIP_ID, {
            departmentId: ROOT_DEPARTMENT_ID,
            version: 2,
        });

        expect(result.departmentId).toBe(ROOT_DEPARTMENT_ID);
        expect(tenantService.updateMember).toHaveBeenCalledWith(MEMBERSHIP_ID, {
            departmentId: ROOT_DEPARTMENT_ID,
            version: 2,
        });
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const ROOT_DEPARTMENT_ID = '60000000-0000-0000-0000-000000000001';
const CHILD_DEPARTMENT_ID = '60000000-0000-0000-0000-000000000002';

function createService(prisma: Record<string, any>, tenantService?: TenantService): OrganizationService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'request-id',
            roles: ['tenant_admin'],
            permissions: ['department.read', 'department.create', 'department.update', 'department.delete'],
        }),
    } as unknown as TenantContext;
    const memberService = tenantService ?? ({
        listMembers: jest.fn(),
        updateMember: jest.fn(),
    } as unknown as TenantService);
    return new OrganizationService(prisma as unknown as PrismaService, tenantContext, memberService);
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        department: {
            findMany: jest.fn(),
            findFirst: jest.fn(),
            create: jest.fn(),
            updateMany: jest.fn(),
            count: jest.fn(),
        },
        tenantMembership: { count: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function departmentRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: ROOT_DEPARTMENT_ID,
        tenantId: TENANT_ID,
        parentId: null,
        name: '总部',
        normalizedName: '总部',
        description: null,
        sortOrder: 0,
        status: DepartmentStatus.ACTIVE,
        version: 1,
        createdAt: new Date('2026-09-08T00:00:00.000Z'),
        updatedAt: new Date('2026-09-08T00:00:00.000Z'),
        _count: { children: 0, memberships: 0 },
        ...overrides,
    };
}
