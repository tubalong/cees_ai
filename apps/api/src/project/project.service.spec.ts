import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProjectMemberRole, ProjectStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { ProjectService } from './project.service';

describe('ProjectService', () => {
    afterEach(() => jest.useRealTimers());

    it('limits ordinary members to projects they joined', async () => {
        const prisma = createPrismaMock();
        prisma.project.findMany.mockResolvedValue([]);
        const service = createService(prisma);

        await service.listProjects({ includeArchived: false, limit: 20 });

        expect(prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                tenantId: TENANT_ID,
                members: { some: { membershipId: CURRENT_MEMBERSHIP_ID, deletedAt: null } },
            }),
        }));
    });

    it('returns not found when a same-tenant user is not a project member', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectRecord({
            ownerMembershipId: OTHER_MEMBERSHIP_ID,
            members: [projectMemberRecord({ membershipId: OTHER_MEMBERSHIP_ID })],
        }));
        const service = createService(prisma);

        await expect(service.getProject(PROJECT_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('allows project.manage_all to access projects without membership', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectRecord({
            ownerMembershipId: OTHER_MEMBERSHIP_ID,
            members: [projectMemberRecord({ membershipId: OTHER_MEMBERSHIP_ID })],
        }));
        prisma.task.count.mockResolvedValue(0);
        const service = createService(prisma, ['project.manage_all']);

        const result = await service.getProject(PROJECT_ID);

        expect(result.id).toBe(PROJECT_ID);
        expect(result.currentMemberRole).toBeNull();
    });

    it('creates the current membership as project owner by default', async () => {
        useFixedNow();
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst.mockResolvedValue({ id: CURRENT_MEMBERSHIP_ID });
        prisma.project.create.mockResolvedValue({ id: PROJECT_ID });
        prisma.projectMember.createMany.mockResolvedValue({ count: 1 });
        prisma.project.findFirst.mockResolvedValue(projectRecord({ code: 'PRJ-2026-1' }));
        prisma.task.count.mockResolvedValue(0);
        prisma.$queryRaw.mockResolvedValue([{ last_number: 1 }]);
        const service = createService(prisma);

        await service.createProject({ name: '项目一' });

        expect(prisma.project.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                tenantId: TENANT_ID,
                ownerMembershipId: CURRENT_MEMBERSHIP_ID,
                code: 'PRJ-2026-1',
                normalizedCode: 'prj-2026-1',
            }),
        }));
        expect(prisma.projectMember.createMany).toHaveBeenCalledWith(expect.objectContaining({
            data: [expect.objectContaining({
                membershipId: CURRENT_MEMBERSHIP_ID,
                role: ProjectMemberRole.OWNER,
            })],
        }));
        expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ action: 'PROJECT_CREATED', resourceType: 'PROJECT' }),
        }));
    });

    it('allocates the project code from the tenant time zone year', async () => {
        jest.useFakeTimers();
        // 2026-12-31T16:30Z 在东八区已经是 2027 年，UTC 仍是 2026 年。
        jest.setSystemTime(new Date('2026-12-31T16:30:00.000Z'));
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst.mockResolvedValue({ id: CURRENT_MEMBERSHIP_ID });
        prisma.project.create.mockResolvedValue({ id: PROJECT_ID });
        prisma.projectMember.createMany.mockResolvedValue({ count: 1 });
        prisma.project.findFirst.mockResolvedValue(projectRecord({ code: 'PRJ-2027-4' }));
        prisma.task.count.mockResolvedValue(0);
        prisma.$queryRaw.mockResolvedValue([{ last_number: 4 }]);

        await createService(prisma).createProject({ name: '跨年项目' });

        expect(prisma.project.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ code: 'PRJ-2027-4', normalizedCode: 'prj-2027-4' }),
        }));

        prisma.tenant.findFirst.mockResolvedValue({ timezone: 'UTC' });
        prisma.project.create.mockClear();
        prisma.$queryRaw.mockResolvedValue([{ last_number: 1 }]);

        await createService(prisma).createProject({ name: '跨年项目' });

        expect(prisma.project.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ code: 'PRJ-2026-1' }),
        }));
    });

    it('adds initial members without duplicating the owner', async () => {
        useFixedNow();
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst.mockResolvedValue({ id: CURRENT_MEMBERSHIP_ID });
        prisma.project.create.mockResolvedValue({ id: PROJECT_ID });
        prisma.projectMember.createMany.mockResolvedValue({ count: 2 });
        prisma.project.findFirst.mockResolvedValue(projectRecord());
        prisma.task.count.mockResolvedValue(0);
        prisma.$queryRaw.mockResolvedValue([{ last_number: 2 }]);
        const service = createService(prisma, ['project.member.manage']);

        await service.createProject({
            name: '带初始成员的项目',
            memberMembershipIds: [CURRENT_MEMBERSHIP_ID, OTHER_MEMBERSHIP_ID, OTHER_MEMBERSHIP_ID],
        });

        expect(prisma.projectMember.createMany).toHaveBeenCalledWith(expect.objectContaining({
            data: [
                expect.objectContaining({ membershipId: CURRENT_MEMBERSHIP_ID, role: ProjectMemberRole.OWNER }),
                expect.objectContaining({ membershipId: OTHER_MEMBERSHIP_ID, role: ProjectMemberRole.MEMBER }),
            ],
        }));
    });

    it('requires project.member.manage to add initial members', async () => {
        const prisma = createPrismaMock();
        const service = createService(prisma);

        await expect(service.createProject({
            name: '无权限',
            memberMembershipIds: [OTHER_MEMBERSHIP_ID],
        })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PROJECT_MEMBER_MANAGE_DENIED' }) });
        expect(prisma.project.create).not.toHaveBeenCalled();
    });

    it('records startedAt on the first start only', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst
            .mockResolvedValueOnce(projectRecord({ status: ProjectStatus.PLANNING }))
            .mockResolvedValueOnce(projectRecord({ status: ProjectStatus.ACTIVE, startedAt: new Date('2026-09-11T00:00:00.000Z') }));
        prisma.project.updateMany.mockResolvedValue({ count: 1 });

        await createService(prisma).start(PROJECT_ID, { version: 1 });

        expect(prisma.project.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: ProjectStatus.ACTIVE, startedAt: expect.any(Date) }),
        }));

        prisma.project.findFirst.mockReset();
        prisma.project.updateMany.mockClear();
        prisma.project.findFirst
            .mockResolvedValueOnce(projectRecord({ status: ProjectStatus.PAUSED, startedAt: new Date('2026-09-01T00:00:00.000Z') }))
            .mockResolvedValueOnce(projectRecord({ status: ProjectStatus.ACTIVE, startedAt: new Date('2026-09-01T00:00:00.000Z') }));

        await createService(prisma).resume(PROJECT_ID, { version: 1 });

        const resumeData = prisma.project.updateMany.mock.calls[0][0].data as Record<string, unknown>;
        expect(resumeData.startedAt).toBeUndefined();
    });

    it('records closedAt when cancelling and clears it when restoring the archive', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst
            .mockResolvedValueOnce(projectRecord({ status: ProjectStatus.ACTIVE }))
            .mockResolvedValueOnce(projectRecord({ status: ProjectStatus.CANCELLED, closedAt: new Date('2026-09-11T00:00:00.000Z') }));
        prisma.project.updateMany.mockResolvedValue({ count: 1 });

        await createService(prisma).cancel(PROJECT_ID, { reason: '业务调整', version: 1 });

        expect(prisma.project.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: ProjectStatus.CANCELLED, closedAt: expect.any(Date) }),
        }));

        prisma.project.findFirst.mockReset();
        prisma.project.updateMany.mockClear();
        prisma.project.findFirst
            .mockResolvedValueOnce(projectRecord({ status: ProjectStatus.ARCHIVED, closedAt: new Date('2026-09-11T00:00:00.000Z') }))
            .mockResolvedValueOnce(projectRecord({ status: ProjectStatus.COMPLETED }));

        await createService(prisma).restore(PROJECT_ID, { version: 1 });

        expect(prisma.project.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: ProjectStatus.COMPLETED, closedAt: null }),
        }));
    });

    it('rejects project mutation after completion', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectRecord({ status: ProjectStatus.COMPLETED }));
        const service = createService(prisma);

        await expect(service.updateProject(PROJECT_ID, { name: '新名称', version: 1 }))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'PROJECT_READ_ONLY' }) });
    });

    it('rejects adding a membership outside the current tenant', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectRecord());
        prisma.tenantMembership.findFirst.mockResolvedValue(null);
        const service = createService(prisma);

        await expect(service.addMember(PROJECT_ID, {
            membershipId: OTHER_MEMBERSHIP_ID,
            role: ProjectMemberRole.MEMBER,
        })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PROJECT_MEMBERSHIP_INVALID' }) });
        expect(prisma.projectMember.create).not.toHaveBeenCalled();
    });

    it('rejects stale project versions', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectRecord());
        prisma.project.updateMany.mockResolvedValue({ count: 0 });
        const service = createService(prisma);

        await expect(service.updateProject(PROJECT_ID, { name: '新名称', version: 99 }))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'PROJECT_VERSION_CONFLICT' }) });
    });

    it('does not allow removing the project owner through member removal', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectRecord());
        const service = createService(prisma);

        await expect(service.removeMember(PROJECT_ID, CURRENT_MEMBERSHIP_ID, 1))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'PROJECT_OWNER_MUTATION_DENIED' }) });
    });

    it('does not remove members assigned to unfinished tasks', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectRecord({
            members: [
                projectMemberRecord(),
                projectMemberRecord({
                    id: OTHER_PROJECT_MEMBER_ID,
                    membershipId: OTHER_MEMBERSHIP_ID,
                    role: ProjectMemberRole.MEMBER,
                }),
            ],
        }));
        prisma.taskAssignee.findFirst.mockResolvedValue({ taskId: '50000000-0000-0000-0000-000000000001' });
        const service = createService(prisma);

        await expect(service.removeMember(PROJECT_ID, OTHER_MEMBERSHIP_ID, 1))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'PROJECT_MEMBER_HAS_ACTIVE_TASKS' }) });
        expect(prisma.$queryRaw.mock.invocationCallOrder[0])
            .toBeLessThan(prisma.taskAssignee.findFirst.mock.invocationCallOrder[0]);
        expect(prisma.projectMember.updateMany).not.toHaveBeenCalled();
    });

    it('transfers ownership and demotes the previous owner to manager', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst
            .mockResolvedValueOnce(projectRecord({
                members: [
                    projectMemberRecord(),
                    projectMemberRecord({
                        id: OTHER_PROJECT_MEMBER_ID,
                        membershipId: OTHER_MEMBERSHIP_ID,
                        role: ProjectMemberRole.MEMBER,
                    }),
                ],
            }))
            .mockResolvedValueOnce(projectRecord({
                ownerMembershipId: OTHER_MEMBERSHIP_ID,
                members: [
                    projectMemberRecord({ role: ProjectMemberRole.MANAGER }),
                    projectMemberRecord({
                        id: OTHER_PROJECT_MEMBER_ID,
                        membershipId: OTHER_MEMBERSHIP_ID,
                        role: ProjectMemberRole.OWNER,
                    }),
                ],
            }));
        prisma.tenantMembership.findFirst.mockResolvedValue({ id: OTHER_MEMBERSHIP_ID });
        prisma.project.updateMany.mockResolvedValue({ count: 1 });
        prisma.projectMember.updateMany.mockResolvedValue({ count: 1 });
        prisma.projectMember.update.mockResolvedValue({ id: OTHER_PROJECT_MEMBER_ID });
        prisma.task.count.mockResolvedValue(0);
        const service = createService(prisma);

        const result = await service.transferOwner(PROJECT_ID, { membershipId: OTHER_MEMBERSHIP_ID, version: 1 });

        expect(prisma.project.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ ownerMembershipId: OTHER_MEMBERSHIP_ID }),
        }));
        expect(prisma.projectMember.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ role: ProjectMemberRole.MANAGER }),
        }));
        expect(prisma.projectMember.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ role: ProjectMemberRole.OWNER }),
        }));
        expect(result.owner?.membershipId).toBe(OTHER_MEMBERSHIP_ID);
    });

    it('rejects completion while unfinished tasks exist', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectRecord({ status: ProjectStatus.ACTIVE }));
        prisma.task.count.mockResolvedValue(2);
        const service = createService(prisma);

        await expect(service.complete(PROJECT_ID, { completionSummary: '完成', version: 1 }))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'PROJECT_HAS_UNFINISHED_TASKS' }) });
        expect(prisma.project.updateMany).not.toHaveBeenCalled();
    });

    it('checks unfinished tasks only after acquiring the project row lock', async () => {
        const prisma = createPrismaMock();
        let releaseLock: (() => void) | undefined;
        prisma.$queryRaw.mockImplementation(() => new Promise((resolve) => {
            releaseLock = () => resolve([{ id: PROJECT_ID }]);
        }));
        prisma.project.findFirst
            .mockResolvedValueOnce(projectRecord({ status: ProjectStatus.ACTIVE }))
            .mockResolvedValueOnce(projectRecord({ status: ProjectStatus.COMPLETED }));
        prisma.task.count.mockResolvedValue(0);
        prisma.project.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma);

        const completion = service.complete(PROJECT_ID, { completionSummary: '完成', version: 1 });

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(prisma.project.findFirst).not.toHaveBeenCalled();
        expect(prisma.task.count).not.toHaveBeenCalled();
        releaseLock?.();
        await completion;
        expect(prisma.$queryRaw.mock.invocationCallOrder[0])
            .toBeLessThan(prisma.task.count.mock.invocationCallOrder[0]);
        expect(prisma.task.count.mock.invocationCallOrder[0])
            .toBeLessThan(prisma.project.updateMany.mock.invocationCallOrder[0]);
    });

    it('records status history and audit when completing a project', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst
            .mockResolvedValueOnce(projectRecord({ status: ProjectStatus.ACTIVE }))
            .mockResolvedValueOnce(projectRecord({ status: ProjectStatus.COMPLETED }));
        prisma.task.count.mockResolvedValue(0);
        prisma.project.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma);

        await service.complete(PROJECT_ID, { completionSummary: '已验收', version: 1 });

        expect(prisma.projectStatusHistory.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                fromStatus: ProjectStatus.ACTIVE,
                toStatus: ProjectStatus.COMPLETED,
                changedByMembershipId: CURRENT_MEMBERSHIP_ID,
            }),
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'PROJECT_COMPLETED' }),
        });
    });

    it('does not delete projects that already contain tasks', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectRecord());
        prisma.task.count.mockResolvedValue(1);
        const service = createService(prisma);

        await expect(service.deleteProject(PROJECT_ID, 1)).rejects.toBeInstanceOf(ConflictException);
        expect(prisma.project.updateMany).not.toHaveBeenCalled();
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const CURRENT_MEMBERSHIP_ID = '20000000-0000-0000-0000-000000000001';
const OTHER_MEMBERSHIP_ID = '20000000-0000-0000-0000-000000000002';
const PROJECT_ID = '30000000-0000-0000-0000-000000000001';
const PROJECT_MEMBER_ID = '40000000-0000-0000-0000-000000000001';
const OTHER_PROJECT_MEMBER_ID = '40000000-0000-0000-0000-000000000002';

function createService(prisma: Record<string, any>, permissions: string[] = []): ProjectService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: CURRENT_MEMBERSHIP_ID,
            requestId: 'request-id',
            roles: [],
            permissions,
        }),
    } as unknown as TenantContext;
    return new ProjectService(prisma as unknown as PrismaService, tenantContext);
}

function useFixedNow(): void {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-11T08:00:00.000Z'));
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        project: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
        projectMember: {
            findFirst: jest.fn(),
            create: jest.fn(),
            createMany: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
        },
        projectStatusHistory: { create: jest.fn() },
        projectActivity: { create: jest.fn() },
        tenantMembership: { findFirst: jest.fn() },
        tenant: { findFirst: jest.fn().mockResolvedValue({ timezone: 'Asia/Shanghai' }) },
        department: { findFirst: jest.fn() },
        task: { count: jest.fn(), groupBy: jest.fn() },
        taskAssignee: { findFirst: jest.fn() },
        auditLog: { create: jest.fn() },
        $queryRaw: jest.fn().mockResolvedValue([{ id: PROJECT_ID }]),
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function projectRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: PROJECT_ID,
        tenantId: TENANT_ID,
        code: 'PRJ-001',
        normalizedCode: 'prj-001',
        departmentId: null,
        ownerMembershipId: CURRENT_MEMBERSHIP_ID,
        ownerMembership: membershipRecord(),
        name: '项目一',
        description: null,
        status: ProjectStatus.PLANNING,
        startedAt: null,
        completedAt: null,
        closedAt: null,
        completedByMembershipId: null,
        completionSummary: null,
        createdAt: new Date('2026-09-08T00:00:00.000Z'),
        updatedAt: new Date('2026-09-08T00:00:00.000Z'),
        version: 1,
        members: [projectMemberRecord()],
        _count: { members: 1 },
        ...overrides,
    };
}

function projectMemberRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: PROJECT_MEMBER_ID,
        membershipId: CURRENT_MEMBERSHIP_ID,
        role: ProjectMemberRole.OWNER,
        joinedAt: new Date('2026-09-08T00:00:00.000Z'),
        version: 1,
        membership: membershipRecord(),
        ...overrides,
    };
}

function membershipRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: CURRENT_MEMBERSHIP_ID,
        account: 'zhangsan',
        displayName: '张三',
        departmentId: null,
        user: { displayName: '张三' },
        ...overrides,
    };
}
