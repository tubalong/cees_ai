import { NotFoundException } from '@nestjs/common';
import {
    ProjectMemberRole, ProjectStatus, TaskAssigneeType, TaskPriority, TaskStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { TaskService } from './task.service';

describe('TaskService', () => {
    it('requires real project membership even with project.manage_all', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(null);
        const service = createService(prisma, ['project.manage_all']);

        await expect(service.getTask(PROJECT_ID, TASK_ID)).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                tenantId: TENANT_ID,
                members: { some: { membershipId: CURRENT_MEMBERSHIP_ID, deletedAt: null } },
            }),
        }));
    });

    it('rejects creating tasks in completed projects', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess({ status: ProjectStatus.COMPLETED }));
        const service = createService(prisma);

        await expect(service.createTask(PROJECT_ID, createTaskInput()))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'PROJECT_READ_ONLY' }) });
        expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it('rechecks project state only after acquiring the project row lock', async () => {
        const prisma = createPrismaMock();
        let releaseLock: (() => void) | undefined;
        prisma.$queryRaw.mockImplementation(() => new Promise((resolve) => {
            releaseLock = () => resolve([{ id: PROJECT_ID }]);
        }));
        prisma.project.findFirst.mockResolvedValue(projectAccess({ status: ProjectStatus.COMPLETED }));
        const service = createService(prisma);

        const creation = service.createTask(PROJECT_ID, createTaskInput());

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(prisma.project.findFirst).not.toHaveBeenCalled();
        releaseLock?.();
        await expect(creation)
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'PROJECT_READ_ONLY' }) });
        expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it('requires all assignees to be active project members', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess());
        prisma.projectMember.findMany.mockResolvedValue([{ membershipId: CURRENT_MEMBERSHIP_ID }]);
        prisma.task.findMany.mockResolvedValue([]);
        const service = createService(prisma);

        await expect(service.createTask(PROJECT_ID, createTaskInput({
            collaboratorMembershipIds: [OTHER_MEMBERSHIP_ID],
        }))).rejects.toMatchObject({ response: expect.objectContaining({ code: 'TASK_ASSIGNEE_INVALID' }) });
    });

    it('creates owner, collaborators, activity and audit in one transaction', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess());
        prisma.projectMember.findMany.mockResolvedValue([
            { membershipId: CURRENT_MEMBERSHIP_ID },
            { membershipId: OTHER_MEMBERSHIP_ID },
        ]);
        prisma.task.findMany.mockResolvedValue([]);
        prisma.task.create.mockResolvedValue({ id: TASK_ID });
        prisma.task.findFirst.mockResolvedValue(taskRecord());
        const service = createService(prisma);

        await service.createTask(PROJECT_ID, createTaskInput({
            collaboratorMembershipIds: [OTHER_MEMBERSHIP_ID],
        }));

        expect(prisma.$queryRaw.mock.invocationCallOrder[0])
            .toBeLessThan(prisma.project.findFirst.mock.invocationCallOrder[0]);
        expect(prisma.project.findFirst.mock.invocationCallOrder[0])
            .toBeLessThan(prisma.task.create.mock.invocationCallOrder[0]);
        expect(prisma.taskAssignee.createMany).toHaveBeenCalledWith({
            data: expect.arrayContaining([
                expect.objectContaining({
                    membershipId: CURRENT_MEMBERSHIP_ID,
                    assigneeType: TaskAssigneeType.OWNER,
                }),
                expect.objectContaining({
                    membershipId: OTHER_MEMBERSHIP_ID,
                    assigneeType: TaskAssigneeType.COLLABORATOR,
                }),
            ]),
        });
        expect(prisma.taskActivity.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'TASK_CREATED', actorMembershipId: CURRENT_MEMBERSHIP_ID }),
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'TASK_CREATED', resourceType: 'TASK' }),
        });
    });

    it('rejects task hierarchy cycles', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess());
        prisma.task.findFirst.mockResolvedValue(taskRecord());
        prisma.task.findMany.mockResolvedValue([{ id: TASK_ID, parentId: null }]);
        const service = createService(prisma);

        await expect(service.updateTask(PROJECT_ID, TASK_ID, { parentId: TASK_ID, version: 1 }))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'TASK_HIERARCHY_CYCLE' }) });
    });

    it('rejects task hierarchies deeper than ten levels', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess());
        prisma.projectMember.findMany.mockResolvedValue([{ membershipId: CURRENT_MEMBERSHIP_ID }]);
        prisma.task.findMany.mockResolvedValue(Array.from({ length: 10 }, (_, index) => ({
            id: `70000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
            parentId: index === 0
                ? null
                : `70000000-0000-0000-0000-${String(index).padStart(12, '0')}`,
        })));
        const service = createService(prisma);

        await expect(service.createTask(PROJECT_ID, createTaskInput({
            parentId: '70000000-0000-0000-0000-000000000010',
        }))).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'TASK_HIERARCHY_DEPTH_EXCEEDED' }),
        });
    });

    it('rejects editing terminal tasks', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess());
        prisma.task.findFirst.mockResolvedValue(taskRecord({ status: TaskStatus.DONE }));
        const service = createService(prisma);

        await expect(service.updateTask(PROJECT_ID, TASK_ID, { title: '重新修改', version: 1 }))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'TASK_READ_ONLY' }) });
    });

    it('requires a reason when blocking a task', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess());
        prisma.task.findFirst.mockResolvedValue(taskRecord({ status: TaskStatus.IN_PROGRESS }));
        const service = createService(prisma);

        await expect(service.transitionTask(PROJECT_ID, TASK_ID, {
            status: TaskStatus.BLOCKED,
            version: 1,
        })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'TASK_STATUS_REASON_REQUIRED' }) });
    });

    it('rejects unsupported status transitions', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess());
        prisma.task.findFirst.mockResolvedValue(taskRecord({ status: TaskStatus.TODO }));
        const service = createService(prisma);

        await expect(service.transitionTask(PROJECT_ID, TASK_ID, {
            status: TaskStatus.DONE,
            version: 1,
        })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'TASK_STATUS_TRANSITION_INVALID' }) });
    });

    it('allows a collaborator to transition an assigned task', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess({ members: [{ role: ProjectMemberRole.MEMBER }] }));
        prisma.task.findFirst.mockResolvedValue(taskRecord({
            assignees: [assigneeRecord(CURRENT_MEMBERSHIP_ID, TaskAssigneeType.COLLABORATOR)],
        }));
        prisma.task.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma);

        await service.transitionTask(PROJECT_ID, TASK_ID, {
            status: TaskStatus.IN_PROGRESS,
            version: 1,
        });

        expect(prisma.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: TaskStatus.IN_PROGRESS, version: { increment: 1 } }),
        }));
        expect(prisma.taskActivity.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'TASK_STATUS_CHANGED' }),
        });
    });

    it('records completion time when a task enters done', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess());
        prisma.task.findFirst.mockResolvedValue(taskRecord({ status: TaskStatus.IN_PROGRESS }));
        prisma.task.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma);

        await service.transitionTask(PROJECT_ID, TASK_ID, {
            status: TaskStatus.DONE,
            version: 1,
        });

        expect(prisma.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: TaskStatus.DONE, completedAt: expect.any(Date) }),
        }));
    });

    it('clears completion time when a done task is reopened', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess());
        prisma.task.findFirst.mockResolvedValue(taskRecord({ status: TaskStatus.DONE }));
        prisma.task.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma);

        await service.transitionTask(PROJECT_ID, TASK_ID, {
            status: TaskStatus.IN_PROGRESS,
            version: 1,
            reason: '重新处理遗漏项',
        });

        expect(prisma.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: TaskStatus.IN_PROGRESS, completedAt: null }),
        }));
    });

    it('requires a reason when a done task is reopened', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess());
        prisma.task.findFirst.mockResolvedValue(taskRecord({ status: TaskStatus.DONE }));
        const service = createService(prisma);

        await expect(service.transitionTask(PROJECT_ID, TASK_ID, {
            status: TaskStatus.IN_PROGRESS,
            version: 1,
        })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'TASK_STATUS_REASON_REQUIRED' }) });
    });

    it('rejects stale task versions during status transitions', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess());
        prisma.task.findFirst.mockResolvedValue(taskRecord());
        prisma.task.updateMany.mockResolvedValue({ count: 0 });
        const service = createService(prisma);

        await expect(service.transitionTask(PROJECT_ID, TASK_ID, {
            status: TaskStatus.IN_PROGRESS,
            version: 99,
        })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'TASK_VERSION_CONFLICT' }) });
    });

    it('does not allow an unassigned ordinary project member to transition tasks', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess({ members: [{ role: ProjectMemberRole.MEMBER }] }));
        prisma.task.findFirst.mockResolvedValue(taskRecord({
            assignees: [assigneeRecord(OTHER_MEMBERSHIP_ID, TaskAssigneeType.OWNER)],
        }));
        const service = createService(prisma);

        await expect(service.transitionTask(PROJECT_ID, TASK_ID, {
            status: TaskStatus.IN_PROGRESS,
            version: 1,
        })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'TASK_EXECUTOR_REQUIRED' }) });
    });

    it('does not allow ordinary members to edit another members comment', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess({ members: [{ role: ProjectMemberRole.MEMBER }] }));
        prisma.task.findFirst.mockResolvedValue(taskRecord({
            assignees: [assigneeRecord(OTHER_MEMBERSHIP_ID, TaskAssigneeType.OWNER)],
        }));
        prisma.taskComment.findFirst.mockResolvedValue(commentRecord());
        const service = createService(prisma);

        await expect(service.updateComment(PROJECT_ID, TASK_ID, COMMENT_ID, { content: '修改', version: 1 }))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'TASK_COMMENT_MUTATION_DENIED' }) });
    });

    it('rejects attachment files outside the current tenant', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess());
        prisma.task.findFirst.mockResolvedValue(taskRecord());
        prisma.fileObject.findFirst.mockResolvedValue(null);
        const service = createService(prisma);

        await expect(service.addAttachment(PROJECT_ID, TASK_ID, { fileObjectId: FILE_ID }))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'TASK_ATTACHMENT_FILE_INVALID' }) });
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const CURRENT_MEMBERSHIP_ID = '20000000-0000-0000-0000-000000000001';
const OTHER_MEMBERSHIP_ID = '20000000-0000-0000-0000-000000000002';
const PROJECT_ID = '30000000-0000-0000-0000-000000000001';
const TASK_ID = '40000000-0000-0000-0000-000000000001';
const COMMENT_ID = '50000000-0000-0000-0000-000000000001';
const FILE_ID = '60000000-0000-0000-0000-000000000001';

function createService(prisma: Record<string, any>, permissions: string[] = []): TaskService {
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
    return new TaskService(prisma as unknown as PrismaService, tenantContext);
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        project: { findFirst: jest.fn() },
        projectMember: { findMany: jest.fn() },
        task: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
        taskAssignee: { createMany: jest.fn(), deleteMany: jest.fn() },
        taskComment: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
        taskAttachment: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
        taskActivity: { findMany: jest.fn(), create: jest.fn() },
        fileObject: { findFirst: jest.fn() },
        auditLog: { create: jest.fn() },
        $queryRaw: jest.fn().mockResolvedValue([{ id: PROJECT_ID }]),
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function projectAccess(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: PROJECT_ID,
        status: ProjectStatus.ACTIVE,
        members: [{ role: ProjectMemberRole.OWNER }],
        ...overrides,
    };
}

function createTaskInput(overrides: Record<string, unknown> = {}): any {
    return {
        title: '实现任务体系',
        priority: TaskPriority.MEDIUM,
        ownerMembershipId: CURRENT_MEMBERSHIP_ID,
        collaboratorMembershipIds: [],
        ...overrides,
    };
}

function taskRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: TASK_ID,
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        parentId: null,
        title: '实现任务体系',
        description: null,
        status: TaskStatus.TODO,
        priority: TaskPriority.MEDIUM,
        dueDate: null,
        createdAt: new Date('2026-09-09T00:00:00.000Z'),
        updatedAt: new Date('2026-09-09T00:00:00.000Z'),
        version: 1,
        assignees: [assigneeRecord(CURRENT_MEMBERSHIP_ID, TaskAssigneeType.OWNER)],
        _count: { children: 0, comments: 0, attachments: 0 },
        ...overrides,
    };
}

function assigneeRecord(membershipId: string, assigneeType: TaskAssigneeType): Record<string, unknown> {
    return {
        membershipId,
        assigneeType,
        membership: membershipRecord({ id: membershipId }),
    };
}

function commentRecord(): Record<string, unknown> {
    return {
        id: COMMENT_ID,
        taskId: TASK_ID,
        content: '原评论',
        authorMembership: membershipRecord({ id: OTHER_MEMBERSHIP_ID }),
        createdAt: new Date('2026-09-09T00:00:00.000Z'),
        updatedAt: new Date('2026-09-09T00:00:00.000Z'),
        version: 1,
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
