import { ForbiddenException } from '@nestjs/common';
import { DepartmentStatus, MembershipStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { OrganizationImportDto } from './organization-import.dto';
import { OrganizationImportService } from './organization-import.service';

describe('OrganizationImportService', () => {
    it('validates reusable departments and new members without writing data', async () => {
        const prisma = createPrismaMock();
        prisma.department.findMany.mockResolvedValue([
            existingDepartment({ id: ROOT_DEPARTMENT_ID, name: '总部', normalizedName: '总部' }),
        ]);
        prisma.role.findMany.mockResolvedValue([{ id: EMPLOYEE_ROLE_ID, code: 'employee' }]);
        const service = createService(prisma);

        const result = await service.validate(importInput());

        expect(result.valid).toBe(true);
        expect(result.summary).toEqual({
            departmentCount: 2,
            departmentCreateCount: 1,
            departmentReuseCount: 1,
            memberCount: 1,
        });
        expect(result.departments).toEqual([
            expect.objectContaining({ clientRef: 'department-hq', action: 'REUSE', departmentId: ROOT_DEPARTMENT_ID }),
            expect.objectContaining({ clientRef: 'department-rd', action: 'CREATE', path: '总部/研发部' }),
        ]);
        expect(result.members[0]).toEqual(expect.objectContaining({
            account: 'zhangsan',
            departmentPath: '总部/研发部',
            effectiveRoleIds: [EMPLOYEE_ROLE_ID],
        }));
        expect(prisma.department.create).not.toHaveBeenCalled();
        expect(prisma.user.createMany).not.toHaveBeenCalled();
    });

    it('returns row issues for duplicate accounts and occupied accounts', async () => {
        const prisma = createPrismaMock();
        prisma.role.findMany.mockResolvedValue([{ id: EMPLOYEE_ROLE_ID, code: 'employee' }]);
        prisma.tenantMembership.findMany.mockResolvedValue([{ normalizedAccount: 'zhangsan' }]);
        const service = createService(prisma);
        const input = importInput();
        input.members.push({
            clientRef: 'member-002',
            account: 'ZHANGSAN',
            displayName: '另一位张三',
            departmentClientRef: 'department-rd',
        });

        const result = await service.validate(input);

        expect(result.valid).toBe(false);
        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'ORGANIZATION_IMPORT_ACCOUNT_DUPLICATE', clientRef: 'member-001' }),
            expect.objectContaining({ code: 'ORGANIZATION_IMPORT_ACCOUNT_DUPLICATE', clientRef: 'member-002' }),
            expect.objectContaining({ code: 'ORGANIZATION_IMPORT_ACCOUNT_EXISTS', clientRef: 'member-001' }),
        ]));
    });

    it('creates departments, pending members, roles, invitations and one audit event atomically', async () => {
        const prisma = createPrismaMock();
        prisma.role.findMany.mockResolvedValue([{ id: EMPLOYEE_ROLE_ID, code: 'employee' }]);
        prisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID, code: 'cees' });
        const service = createService(prisma);

        const result = await service.confirm(importInput());

        expect(prisma.department.create).toHaveBeenCalledTimes(2);
        expect(prisma.user.createMany).toHaveBeenCalledWith({
            data: [expect.objectContaining({ displayName: '张三' })],
        });
        expect(prisma.tenantMembership.createMany).toHaveBeenCalledWith({
            data: [expect.objectContaining({
                tenantId: TENANT_ID,
                account: 'zhangsan',
                status: MembershipStatus.PENDING_ACTIVATION,
                passwordHash: null,
            })],
        });
        const membershipId = prisma.tenantMembership.createMany.mock.calls[0][0].data[0].id;
        expect(prisma.membershipRole.createMany).toHaveBeenCalledWith({
            data: [{ tenantId: TENANT_ID, membershipId, roleId: EMPLOYEE_ROLE_ID }],
        });
        expect(prisma.tenantInvitation.createMany).toHaveBeenCalledWith({
            data: [expect.objectContaining({
                tenantId: TENANT_ID,
                targetMembershipId: membershipId,
                account: 'zhangsan',
            })],
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'ORGANIZATION_MEMBERS_IMPORTED',
                resourceType: 'TENANT',
                metadata: expect.objectContaining({ memberCount: 1, departmentCreateCount: 2 }),
            }),
        });
        expect(result.members[0]).toEqual(expect.objectContaining({
            membershipId,
            tenantCode: 'cees',
            account: 'zhangsan',
        }));
        expect(result.members[0].activationToken.length).toBeGreaterThanOrEqual(32);
        expect(JSON.stringify(prisma.auditLog.create.mock.calls[0][0])).not.toContain(result.members[0].activationToken);
    });

    it('forbids assigning tenant_admin through a batch import', async () => {
        const prisma = createPrismaMock();
        prisma.role.findMany.mockResolvedValue([{ id: EMPLOYEE_ROLE_ID, code: 'tenant_admin' }]);
        const service = createService(prisma);

        await expect(service.confirm(importInput())).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.user.createMany).not.toHaveBeenCalled();
        expect(prisma.tenantMembership.createMany).not.toHaveBeenCalled();
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const ACTOR_MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const ROOT_DEPARTMENT_ID = '60000000-0000-0000-0000-000000000001';
const EMPLOYEE_ROLE_ID = '70000000-0000-0000-0000-000000000001';

function createService(prisma: Record<string, any>): OrganizationImportService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: ACTOR_MEMBERSHIP_ID,
            requestId: 'request-1',
            roles: ['tenant_admin'],
            permissions: ['department.create', 'member.invite', 'role.assign'],
        }),
    } as unknown as TenantContext;
    return new OrganizationImportService(prisma as PrismaService, tenantContext);
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        department: {
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValue({}),
        },
        tenantMembership: {
            findMany: jest.fn().mockResolvedValue([]),
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        tenantInvitation: {
            findMany: jest.fn().mockResolvedValue([]),
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        role: {
            findMany: jest.fn().mockResolvedValue([]),
        },
        tenant: {
            findUnique: jest.fn().mockResolvedValue(null),
        },
        user: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        membershipRole: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        tenantInvitationRole: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        auditLog: {
            create: jest.fn().mockResolvedValue({}),
        },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
        async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma),
    );
    return prisma;
}

function existingDepartment(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
        id: ROOT_DEPARTMENT_ID,
        parentId: null,
        name: '总部',
        normalizedName: '总部',
        status: DepartmentStatus.ACTIVE,
        ...overrides,
    };
}

function importInput(): OrganizationImportDto {
    return {
        defaultRoleIds: [EMPLOYEE_ROLE_ID],
        departments: [
            {
                clientRef: 'department-hq',
                name: '总部',
                parentClientRef: null,
                description: '公司总部',
                sortOrder: 0,
            },
            {
                clientRef: 'department-rd',
                name: '研发部',
                parentClientRef: 'department-hq',
                description: '产品研发部门',
                sortOrder: 10,
            },
        ],
        members: [
            {
                clientRef: 'member-001',
                account: 'zhangsan',
                displayName: '张三',
                departmentClientRef: 'department-rd',
            },
        ],
        activationExpiresInDays: 7,
    };
}
