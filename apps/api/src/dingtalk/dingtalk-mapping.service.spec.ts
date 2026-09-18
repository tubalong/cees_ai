import { DingTalkIntegrationStatus, MembershipStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { DingTalkMappingService } from './dingtalk-mapping.service';

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const ACTOR_MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const ROOT_DEPARTMENT_ID = '60000000-0000-0000-0000-000000000001';
const DINGTALK_DEPARTMENT_ID = '80000000-0000-0000-0000-000000000001';
const DINGTALK_USER_ID = '90000000-0000-0000-0000-000000000001';
const EMPLOYEE_ROLE_ID = '70000000-0000-0000-0000-000000000001';
const MANAGER_ROLE_ID = '70000000-0000-0000-0000-000000000002';

describe('DingTalkMappingService', () => {
    it('previews same-parent department matching and unique member matching', async () => {
        const prisma = createPrismaMock();
        prisma.dingTalkDepartment.findMany.mockResolvedValue([
            {
                id: DINGTALK_DEPARTMENT_ID,
                externalDepartmentId: 'dept-rd',
                parentExternalDepartmentId: '1',
                departmentId: null,
                name: '研发部',
                displayOrder: 10,
                isDeleted: false,
            },
        ]);
        prisma.dingTalkUser.findMany.mockResolvedValue([
            {
                id: DINGTALK_USER_ID,
                externalUserId: 'user-001',
                name: '张三',
                departmentExternalIds: ['dept-rd'],
                membershipId: null,
            },
        ]);
        prisma.department.findMany.mockResolvedValue([
            { id: ROOT_DEPARTMENT_ID, parentId: null, name: '研发部', normalizedName: '研发部' },
        ]);
        prisma.tenantMembership.findMany.mockResolvedValue([]);

        const result = await createService(prisma).preview({
            activationExpiresInDays: 7,
            createMissingDepartments: true,
            createMissingMembers: true,
        });

        expect(result.summary).toEqual({
            departmentMatchedCount: 1,
            departmentCreateCount: 0,
            departmentConflictCount: 0,
            userMatchedCount: 0,
            userCreateCount: 1,
            userConflictCount: 0,
        });
        expect(result.departments[0]).toEqual(expect.objectContaining({
            action: 'MATCH_EXISTING',
            departmentId: ROOT_DEPARTMENT_ID,
            reason: 'SAME_PARENT_AND_NAME',
        }));
        expect(result.users[0]).toEqual(expect.objectContaining({
            action: 'CREATE',
            suggestedAccount: 'zhangsan',
            departmentPaths: ['研发部'],
        }));
    });

    it('treats planned parent departments as available for child creation', async () => {
        const prisma = createPrismaMock();
        prisma.dingTalkDepartment.findMany.mockResolvedValue([
            {
                id: 'dingtalk-child',
                externalDepartmentId: 'dept-rd',
                parentExternalDepartmentId: 'dept-hq',
                departmentId: null,
                name: '研发部',
                displayOrder: 10,
                isDeleted: false,
            },
            {
                id: 'dingtalk-parent',
                externalDepartmentId: 'dept-hq',
                parentExternalDepartmentId: '1',
                departmentId: null,
                name: '总部',
                displayOrder: 0,
                isDeleted: false,
            },
            {
                id: 'dingtalk-grandchild',
                externalDepartmentId: 'dept-backend',
                parentExternalDepartmentId: 'dept-rd',
                departmentId: null,
                name: '后端组',
                displayOrder: 10,
                isDeleted: false,
            },
        ]);

        const preview = await createService(prisma).preview({
            activationExpiresInDays: 7,
            createMissingDepartments: true,
            createMissingMembers: true,
        });

        expect(preview.summary).toEqual({
            departmentMatchedCount: 0,
            departmentCreateCount: 3,
            departmentConflictCount: 0,
            userMatchedCount: 0,
            userCreateCount: 0,
            userConflictCount: 0,
        });
        expect(preview.departments).toEqual(expect.arrayContaining([
            expect.objectContaining({ externalDepartmentId: 'dept-hq', action: 'CREATE', reason: 'NOT_FOUND' }),
            expect.objectContaining({ externalDepartmentId: 'dept-rd', action: 'CREATE', reason: 'NOT_FOUND' }),
            expect.objectContaining({ externalDepartmentId: 'dept-backend', action: 'CREATE', reason: 'NOT_FOUND' }),
        ]));
        expect(preview.departments.some((item) => item.reason === 'PARENT_MAPPING_MISSING')).toBe(false);

        prisma.$transaction.mockImplementation(async (callback: (value: Record<string, any>) => unknown) => callback(prisma));
        prisma.department.create
            .mockResolvedValueOnce({ id: 'cees-hq' })
            .mockResolvedValueOnce({ id: 'cees-rd' })
            .mockResolvedValueOnce({ id: 'cees-backend' });
        prisma.dingTalkDepartment.updateMany.mockResolvedValue({ count: 1 });
        prisma.auditLog.create.mockResolvedValue({});

        await createService(prisma).apply({
            activationExpiresInDays: 7,
            createMissingDepartments: true,
            createMissingMembers: true,
            departmentResolutions: [],
            userResolutions: [],
        });

        expect(prisma.department.create.mock.calls.map((call: [{ data: { name: string; parentId: string | null } }]) => ({
            name: call[0].data.name,
            parentId: call[0].data.parentId,
        }))).toEqual([
            { name: '总部', parentId: null },
            { name: '研发部', parentId: 'cees-hq' },
            { name: '后端组', parentId: 'cees-rd' },
        ]);
    });

    it('applies a new member mapping with a tenant-wide suffixed account and activation token', async () => {
        const prisma = createPrismaMock();
        prisma.$transaction.mockImplementation(async (callback: (value: Record<string, any>) => unknown) => callback(prisma));
        prisma.dingTalkDepartment.findMany.mockResolvedValue([
            {
                id: DINGTALK_DEPARTMENT_ID,
                externalDepartmentId: 'dept-rd',
                parentExternalDepartmentId: '1',
                departmentId: ROOT_DEPARTMENT_ID,
                name: '研发部',
                displayOrder: 10,
                isDeleted: false,
            },
        ]);
        prisma.dingTalkUser.findMany.mockResolvedValue([
            {
                id: DINGTALK_USER_ID,
                externalUserId: 'user-001',
                name: '张三',
                departmentExternalIds: ['dept-rd'],
                membershipId: null,
            },
        ]);
        prisma.department.findMany.mockResolvedValue([
            { id: ROOT_DEPARTMENT_ID, parentId: null, name: '研发部', normalizedName: '研发部' },
        ]);
        prisma.tenantMembership.findMany.mockResolvedValue([
            { id: 'member-1', departmentId: ROOT_DEPARTMENT_ID, displayName: '另一位张三', account: 'zhangsan', normalizedAccount: 'zhangsan', status: MembershipStatus.ACTIVE, user: { displayName: '另一位张三' } },
        ]);
        prisma.role.findMany.mockResolvedValue([
            { id: EMPLOYEE_ROLE_ID, code: 'employee' },
            { id: MANAGER_ROLE_ID, code: 'manager' },
        ]);
        prisma.department.findFirst.mockResolvedValue({ id: ROOT_DEPARTMENT_ID });
        prisma.user.create.mockResolvedValue({});
        prisma.tenantMembership.create.mockResolvedValue({});
        prisma.membershipRole.create.mockResolvedValue({});
        prisma.tenantInvitation.create.mockResolvedValue({});
        prisma.dingTalkUser.updateMany.mockResolvedValue({ count: 1 });
        prisma.dingTalkDepartment.updateMany.mockResolvedValue({ count: 1 });
        prisma.auditLog.create.mockResolvedValue({});

        const result = await createService(prisma).apply({
            activationExpiresInDays: 7,
            createMissingDepartments: true,
            createMissingMembers: true,
            departmentResolutions: [],
            userResolutions: [],
            roleAssignments: [
                { roleId: EMPLOYEE_ROLE_ID, dingtalkUserIds: [DINGTALK_USER_ID] },
                { roleId: MANAGER_ROLE_ID, dingtalkUserIds: [DINGTALK_USER_ID] },
            ],
        });

        expect(result.credentials[0]).toEqual(expect.objectContaining({
            account: 'zhangsan2',
            displayName: '张三',
            tenantCode: 'cees',
            roleIds: [EMPLOYEE_ROLE_ID, MANAGER_ROLE_ID],
            roleCodes: ['employee', 'manager'],
        }));
        expect(result.credentials[0].activationToken.length).toBeGreaterThanOrEqual(32);
        expect(prisma.tenantMembership.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                account: 'zhangsan2',
                status: MembershipStatus.PENDING_ACTIVATION,
                passwordHash: null,
            }),
        }));
        expect(prisma.membershipRole.createMany).toHaveBeenCalledWith({
            data: [
                { tenantId: TENANT_ID, membershipId: expect.any(String), roleId: EMPLOYEE_ROLE_ID },
                { tenantId: TENANT_ID, membershipId: expect.any(String), roleId: MANAGER_ROLE_ID },
            ],
            skipDuplicates: true,
        });
        expect(JSON.stringify(prisma.auditLog.create.mock.calls[0][0])).not.toContain(result.credentials[0].activationToken);
    });

    it('requires at least one role for every new member', async () => {
        const prisma = createPrismaMock();
        prisma.dingTalkUser.findMany.mockResolvedValue([
            {
                id: DINGTALK_USER_ID,
                externalUserId: 'user-001',
                name: '张三',
                departmentExternalIds: [],
                membershipId: null,
            },
        ]);

        await expect(createService(prisma).apply({
            activationExpiresInDays: 7,
            createMissingDepartments: true,
            createMissingMembers: true,
            departmentResolutions: [],
            userResolutions: [],
            roleAssignments: [],
        })).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'DINGTALK_MAPPING_ROLE_REQUIRED',
                details: { dingtalkUserIds: [DINGTALK_USER_ID] },
            }),
        });
    });

    it('does not allow tenant_admin in bulk mapping role assignments', async () => {
        const prisma = createPrismaMock();
        prisma.dingTalkUser.findMany.mockResolvedValue([
            {
                id: DINGTALK_USER_ID,
                externalUserId: 'user-001',
                name: '张三',
                departmentExternalIds: [],
                membershipId: null,
            },
        ]);
        prisma.role.findMany.mockResolvedValue([
            { id: EMPLOYEE_ROLE_ID, code: 'tenant_admin' },
        ]);

        await expect(createService(prisma).apply({
            activationExpiresInDays: 7,
            createMissingDepartments: true,
            createMissingMembers: true,
            departmentResolutions: [],
            userResolutions: [],
            roleAssignments: [{ roleId: EMPLOYEE_ROLE_ID, dingtalkUserIds: [DINGTALK_USER_ID] }],
        })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'DINGTALK_MAPPING_TENANT_ADMIN_FORBIDDEN' }),
        });
    });
    it('requires a resolution when duplicate members have the same name', async () => {
        const prisma = createPrismaMock();
        prisma.dingTalkUser.findMany.mockResolvedValue([
            {
                id: DINGTALK_USER_ID,
                externalUserId: 'user-001',
                name: '张三',
                departmentExternalIds: [],
                membershipId: null,
            },
        ]);
        prisma.tenantMembership.findMany.mockResolvedValue([
            { id: 'member-1', departmentId: null, displayName: '张三', account: 'zhangsan', normalizedAccount: 'zhangsan', status: MembershipStatus.ACTIVE, user: { displayName: '张三' } },
            { id: 'member-2', departmentId: null, displayName: '张三', account: 'zhangsan2', normalizedAccount: 'zhangsan2', status: MembershipStatus.ACTIVE, user: { displayName: '张三' } },
        ]);

        const result = await createService(prisma).preview({
            activationExpiresInDays: 7,
            createMissingDepartments: true,
            createMissingMembers: true,
        });

        expect(result.users[0]).toEqual(expect.objectContaining({
            action: 'CONFLICT',
            candidateMembershipIds: ['member-1', 'member-2'],
        }));
    });
});

function createService(prisma: Record<string, any>): DingTalkMappingService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: ACTOR_MEMBERSHIP_ID,
            requestId: 'request-1',
            roles: ['tenant_admin'],
            permissions: [],
        }),
    } as unknown as TenantContext;
    return new DingTalkMappingService(prisma as PrismaService, tenantContext);
}

function createPrismaMock(): Record<string, any> {
    return {
        tenant: { findUniqueOrThrow: jest.fn().mockResolvedValue({ code: 'cees' }) },
        dingTalkIntegration: { findUnique: jest.fn().mockResolvedValue({ id: 'integration-1', status: DingTalkIntegrationStatus.ACTIVE }) },
        dingTalkDepartment: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
        dingTalkUser: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
        department: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), findFirst: jest.fn() },
        tenantMembership: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), create: jest.fn() },
        tenantInvitation: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
        role: { findFirst: jest.fn().mockResolvedValue({ id: EMPLOYEE_ROLE_ID }), findMany: jest.fn().mockResolvedValue([]) },
        user: { create: jest.fn() },
        membershipRole: { create: jest.fn(), createMany: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
}
