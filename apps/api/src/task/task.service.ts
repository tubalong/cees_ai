import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
    AuditOutcome, FilePurpose, MembershipStatus, Prisma, ProjectMemberRole, ProjectStatus,
    TaskAssigneeType, TaskStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { dateKeyToUtcMidnight, localDateKey } from '../common/tenant-time';
import { lockProjectForUpdate } from '../project/project-transaction-lock';
import { RequestTenantContext, TenantContext } from '../tenant/tenant-context';
import {
    AddTaskAttachmentDto, CreateTaskCommentDto, CreateTaskDto, ListTaskEntriesQueryDto,
    ListTasksQueryDto, ReplaceTaskAssigneesDto, TaskTransitionDto, UpdateTaskCommentDto, UpdateTaskDto,
} from './dto';
import {
    TaskActivityListResult, TaskActivityResult, TaskAssigneeResult, TaskAttachmentListResult,
    TaskAttachmentResult, TaskCommentListResult, TaskCommentResult, TaskListResult,
    TaskMemberResult, TaskResult,
} from './task.types';

const MAX_TASK_DEPTH = 10;
const READ_ONLY_PROJECT_STATUSES = new Set<ProjectStatus>([
    ProjectStatus.COMPLETED, ProjectStatus.CANCELLED, ProjectStatus.ARCHIVED,
]);
const TERMINAL_TASK_STATUSES = new Set<TaskStatus>([TaskStatus.DONE, TaskStatus.CANCELLED]);
const ALLOWED_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
    [TaskStatus.TODO]: new Set([TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED]),
    [TaskStatus.IN_PROGRESS]: new Set([TaskStatus.BLOCKED, TaskStatus.DONE, TaskStatus.CANCELLED]),
    [TaskStatus.BLOCKED]: new Set([TaskStatus.IN_PROGRESS, TaskStatus.DONE, TaskStatus.CANCELLED]),
    [TaskStatus.DONE]: new Set([TaskStatus.IN_PROGRESS]),
    [TaskStatus.CANCELLED]: new Set(),
};

const memberIdentitySelect = {
    id: true,
    account: true,
    displayName: true,
    departmentId: true,
    user: { select: { displayName: true } },
} satisfies Prisma.TenantMembershipSelect;

const assigneeSelect = {
    membershipId: true,
    assigneeType: true,
    membership: { select: memberIdentitySelect },
} satisfies Prisma.TaskAssigneeSelect;

const taskSelect = {
    id: true,
    tenantId: true,
    projectId: true,
    parentId: true,
    relationType: true,
    relationId: true,
    title: true,
    description: true,
    status: true,
    priority: true,
    dueDate: true,
    createdAt: true,
    updatedAt: true,
    version: true,
    assignees: {
        select: assigneeSelect,
        orderBy: [{ assigneeType: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    },
    _count: {
        select: {
            children: { where: { deletedAt: null } },
            comments: { where: { deletedAt: null } },
            attachments: { where: { deletedAt: null } },
        },
    },
} satisfies Prisma.TaskSelect;

const commentSelect = {
    id: true,
    taskId: true,
    content: true,
    createdAt: true,
    updatedAt: true,
    version: true,
    authorMembership: { select: memberIdentitySelect },
} satisfies Prisma.TaskCommentSelect;

const attachmentSelect = {
    id: true,
    taskId: true,
    fileObjectId: true,
    createdByMembershipId: true,
    createdAt: true,
    version: true,
    fileObject: { select: { originalName: true, mimeType: true, sizeBytes: true } },
} satisfies Prisma.TaskAttachmentSelect;

const activitySelect = {
    id: true,
    taskId: true,
    action: true,
    metadata: true,
    createdAt: true,
    actorMembership: { select: memberIdentitySelect },
} satisfies Prisma.TaskActivitySelect;

type TaskRecord = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;
type TaskCommentRecord = Prisma.TaskCommentGetPayload<{ select: typeof commentSelect }>;
type TaskAttachmentRecord = Prisma.TaskAttachmentGetPayload<{ select: typeof attachmentSelect }>;
type TaskActivityRecord = Prisma.TaskActivityGetPayload<{ select: typeof activitySelect }>;
type TaskDb = PrismaService | Prisma.TransactionClient;

interface ProjectAccessRecord {
    id: string;
    status: ProjectStatus;
    ownerMembershipId: string | null;
    tenant: { timezone: string };
    members: Array<{ role: ProjectMemberRole }>;
}

@Injectable()
export class TaskService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
    ) { }

    async listTasks(projectId: string, query: ListTasksQueryDto): Promise<TaskListResult> {
        const context = this.tenantContext.require();
        await this.requireProjectAccess(context, projectId);
        if (query.parentId && query.rootOnly) {
            throw new BadRequestException({
                code: 'TASK_PARENT_FILTER_CONFLICT',
                message: 'parentId 与 rootOnly 不能同时使用',
            });
        }
        const keyword = normalizeOptionalText(query.keyword);
        const tasks = await this.prisma.task.findMany({
            where: {
                tenantId: context.tenantId,
                projectId,
                deletedAt: null,
                status: query.status,
                priority: query.priority,
                parentId: query.parentId ?? (query.rootOnly ? null : undefined),
                assignees: query.assigneeMembershipId
                    ? { some: { membershipId: query.assigneeMembershipId } }
                    : undefined,
                OR: keyword
                    ? [
                        { title: { contains: keyword, mode: 'insensitive' } },
                        { description: { contains: keyword, mode: 'insensitive' } },
                    ]
                    : undefined,
            },
            select: taskSelect,
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        const hasNextPage = tasks.length > query.limit;
        const page = hasNextPage ? tasks.slice(0, query.limit) : tasks;
        return {
            items: page.map(toTaskResult),
            nextCursor: hasNextPage ? page[page.length - 1]?.id ?? null : null,
        };
    }

    async getTask(projectId: string, taskId: string): Promise<TaskResult> {
        const context = this.tenantContext.require();
        await this.requireProjectAccess(context, projectId);
        return toTaskResult(await this.requireTask(context, projectId, taskId));
    }

    async createTask(projectId: string, input: CreateTaskDto): Promise<TaskResult> {
        const context = this.tenantContext.require();
        const collaboratorMembershipIds = uniqueMembershipIds(input.collaboratorMembershipIds);
        const title = normalizeRequiredText(input.title, 'TASK_TITLE_REQUIRED', '任务标题不能为空');
        const taskId = await this.prisma.$transaction(async (transaction) => {
            await lockProjectForUpdate(transaction, context.tenantId, projectId);
            const project = await this.requireProjectAccess(context, projectId, transaction);
            this.assertProjectEditable(project);
            await this.validateProjectAssignees(
                context,
                projectId,
                input.ownerMembershipId,
                collaboratorMembershipIds,
                transaction,
            );
            await this.validateTaskParent(context, projectId, input.parentId ?? null, undefined, transaction);
            if (input.decisionId) {
                const decision = await transaction.projectDecision.findFirst({ where: { id: input.decisionId, tenantId: context.tenantId, projectId, deletedAt: null }, select: { id: true } });
                if (!decision) throw new BadRequestException({ code: 'TASK_DECISION_INVALID', message: '来源决策不存在或不属于当前项目' });
            }
            const task = await transaction.task.create({
                data: {
                    tenantId: context.tenantId,
                    projectId,
                    parentId: input.parentId ?? null,
                    title,
                    description: normalizeOptionalText(input.description),
                    priority: input.priority,
                    dueDate: toNullableDate(input.dueDate),
                    relationType: input.decisionId ? 'PROJECT_DECISION' : null,
                    relationId: input.decisionId ?? null,
                    createdByMembershipId: context.membershipId,
                    createdBy: context.userId,
                    updatedBy: context.userId,
                },
                select: { id: true },
            });
            await transaction.taskAssignee.createMany({
                data: buildAssigneeRows(context.tenantId, task.id, input.ownerMembershipId, collaboratorMembershipIds),
            });
            await transaction.taskActivity.create({
                data: activityData(context, task.id, 'TASK_CREATED', {
                    title,
                    parentId: input.parentId ?? null,
                    ownerMembershipId: input.ownerMembershipId,
                    collaboratorMembershipIds,
                }),
            });
            await transaction.projectActivity.create({
                data: {
                    tenantId: context.tenantId,
                    projectId,
                    actorMembershipId: context.membershipId,
                    type: 'TASK_CREATED',
                    resourceType: 'TASK',
                    resourceId: task.id,
                    summary: `任务“${title}”已创建`,
                    metadata: { ownerMembershipId: input.ownerMembershipId, decisionId: input.decisionId ?? null },
                },
            });
            await transaction.auditLog.create({
                data: auditData(context, 'TASK_CREATED', 'TASK', task.id, {
                    projectId, title, parentId: input.parentId ?? null,
                }),
            });
            return task.id;
        });
        return this.getTask(projectId, taskId);
    }

    async updateTask(projectId: string, taskId: string, input: UpdateTaskDto): Promise<TaskResult> {
        const context = this.tenantContext.require();
        const data: Prisma.TaskUncheckedUpdateManyInput = {
            updatedBy: context.userId,
            version: { increment: 1 },
        };
        const changedFields: string[] = [];
        if (input.title !== undefined) {
            data.title = normalizeRequiredText(input.title, 'TASK_TITLE_REQUIRED', '任务标题不能为空');
            changedFields.push('title');
        }
        if (input.description !== undefined) {
            data.description = normalizeOptionalText(input.description);
            changedFields.push('description');
        }
        if (input.parentId !== undefined) {
            data.parentId = input.parentId;
            changedFields.push('parentId');
        }
        if (input.priority !== undefined) {
            data.priority = input.priority;
            changedFields.push('priority');
        }
        if (input.dueDate !== undefined) {
            data.dueDate = toNullableDate(input.dueDate);
            changedFields.push('dueDate');
        }
        const result = await this.prisma.$transaction(async (transaction) => {
            await lockProjectForUpdate(transaction, context.tenantId, projectId);
            const project = await this.requireProjectAccess(context, projectId, transaction);
            const task = await this.requireTask(context, projectId, taskId, transaction);
            this.assertProjectEditable(project);
            this.assertTaskManager(context, project, task);
            this.assertTaskEditable(task);
            if (input.parentId !== undefined) {
                await this.validateTaskParent(context, projectId, input.parentId, taskId, transaction);
            }
            if (!hasTaskChanges(input)) {
                if (task.version !== input.version) throw this.versionConflict();
                return toTaskResult(task);
            }
            const updated = await transaction.task.updateMany({
                where: { id: taskId, tenantId: context.tenantId, projectId, version: input.version, deletedAt: null },
                data,
            });
            if (updated.count !== 1) throw this.versionConflict();
            await transaction.taskActivity.create({
                data: activityData(context, taskId, 'TASK_UPDATED', { changedFields }),
            });
            await transaction.auditLog.create({
                data: auditData(context, 'TASK_UPDATED', 'TASK', taskId, { projectId, changedFields }),
            });
            return null;
        });
        if (result) return result;
        return this.getTask(projectId, taskId);
    }

    async deleteTask(projectId: string, taskId: string, version: number): Promise<void> {
        const context = this.tenantContext.require();
        await this.prisma.$transaction(async (transaction) => {
            await lockProjectForUpdate(transaction, context.tenantId, projectId);
            const project = await this.requireProjectAccess(context, projectId, transaction);
            const task = await this.requireTask(context, projectId, taskId, transaction);
            this.assertProjectEditable(project);
            this.assertTaskManager(context, project, task);
            const child = await transaction.task.findFirst({
                where: { tenantId: context.tenantId, projectId, parentId: taskId, deletedAt: null },
                select: { id: true },
            });
            if (child) {
                throw new ConflictException({
                    code: 'TASK_HAS_CHILDREN', message: '任务仍有子任务，不能删除', details: { childTaskId: child.id },
                });
            }
            const deleted = await transaction.task.updateMany({
                where: { id: taskId, tenantId: context.tenantId, projectId, version, deletedAt: null },
                data: { deletedAt: new Date(), updatedBy: context.userId, version: { increment: 1 } },
            });
            if (deleted.count !== 1) throw this.versionConflict();
            await transaction.taskAssignee.deleteMany({ where: { tenantId: context.tenantId, taskId } });
            await transaction.taskActivity.create({
                data: activityData(context, taskId, 'TASK_DELETED', { title: task.title }),
            });
            await transaction.auditLog.create({
                data: auditData(context, 'TASK_DELETED', 'TASK', taskId, { projectId, title: task.title }),
            });
        });
    }

    async transitionTask(projectId: string, taskId: string, input: TaskTransitionDto): Promise<TaskResult> {
        const context = this.tenantContext.require();
        const reason = normalizeOptionalText(input.reason);
        if ((input.status === TaskStatus.BLOCKED || input.status === TaskStatus.CANCELLED) && !reason) {
            throw new BadRequestException({ code: 'TASK_STATUS_REASON_REQUIRED', message: '任务阻塞或取消时必须填写原因' });
        }
        await this.prisma.$transaction(async (transaction) => {
            await lockProjectForUpdate(transaction, context.tenantId, projectId);
            const project = await this.requireProjectAccess(context, projectId, transaction);
            const task = await this.requireTask(context, projectId, taskId, transaction);
            this.assertProjectEditable(project);
            this.assertTaskExecutorOrManager(context, project, task);
            if (task.status === TaskStatus.DONE && input.status === TaskStatus.IN_PROGRESS && !reason) {
                throw new BadRequestException({ code: 'TASK_STATUS_REASON_REQUIRED', message: '任务重开时必须填写原因' });
            }
            if (!ALLOWED_TRANSITIONS[task.status].has(input.status)) {
                throw new ConflictException({
                    code: 'TASK_STATUS_TRANSITION_INVALID',
                    message: '当前任务状态不允许执行该流转',
                    details: { fromStatus: task.status, toStatus: input.status },
                });
            }
            const updated = await transaction.task.updateMany({
                where: {
                    id: taskId, tenantId: context.tenantId, projectId,
                    status: task.status, version: input.version, deletedAt: null,
                },
                data: {
                    status: input.status,
                    completedAt: input.status === TaskStatus.DONE ? new Date() : null,
                    updatedBy: context.userId,
                    version: { increment: 1 },
                },
            });
            if (updated.count !== 1) throw this.versionConflict();
            const metadata = { fromStatus: task.status, toStatus: input.status, reason };
            await transaction.taskActivity.create({
                data: activityData(context, taskId, 'TASK_STATUS_CHANGED', metadata),
            });
            await transaction.projectActivity.create({
                data: {
                    tenantId: context.tenantId,
                    projectId,
                    actorMembershipId: context.membershipId,
                    type: input.status === TaskStatus.DONE ? 'TASK_COMPLETED' : 'TASK_STATUS_CHANGED',
                    resourceType: 'TASK',
                    resourceId: taskId,
                    summary: input.status === TaskStatus.DONE ? `任务“${task.title}”已完成` : `任务“${task.title}”状态变更为 ${input.status}`,
                    metadata,
                },
            });
            await transaction.auditLog.create({
                data: auditData(context, 'TASK_STATUS_CHANGED', 'TASK', taskId, { projectId, ...metadata }),
            });
            if (input.status === TaskStatus.DONE) {
                await this.syncDailyReportOnTaskDone(transaction, context, project, task, new Date());
            }
        });
        return this.getTask(projectId, taskId);
    }

    async replaceAssignees(projectId: string, taskId: string, input: ReplaceTaskAssigneesDto): Promise<TaskResult> {
        const context = this.tenantContext.require();
        const collaboratorMembershipIds = uniqueMembershipIds(input.collaboratorMembershipIds);
        await this.prisma.$transaction(async (transaction) => {
            await lockProjectForUpdate(transaction, context.tenantId, projectId);
            const project = await this.requireProjectAccess(context, projectId, transaction);
            const task = await this.requireTask(context, projectId, taskId, transaction);
            this.assertProjectEditable(project);
            this.assertTaskManager(context, project, task);
            this.assertTaskEditable(task);
            await this.validateProjectAssignees(
                context,
                projectId,
                input.ownerMembershipId,
                collaboratorMembershipIds,
                transaction,
            );
            const updated = await transaction.task.updateMany({
                where: { id: taskId, tenantId: context.tenantId, projectId, version: input.version, deletedAt: null },
                data: { updatedBy: context.userId, version: { increment: 1 } },
            });
            if (updated.count !== 1) throw this.versionConflict();
            await transaction.taskAssignee.deleteMany({ where: { tenantId: context.tenantId, taskId } });
            await transaction.taskAssignee.createMany({
                data: buildAssigneeRows(context.tenantId, taskId, input.ownerMembershipId, collaboratorMembershipIds),
            });
            const metadata = { ownerMembershipId: input.ownerMembershipId, collaboratorMembershipIds };
            await transaction.taskActivity.create({
                data: activityData(context, taskId, 'TASK_ASSIGNEES_CHANGED', metadata),
            });
            await transaction.projectActivity.create({
                data: {
                    tenantId: context.tenantId,
                    projectId,
                    actorMembershipId: context.membershipId,
                    type: 'TASK_ASSIGNEES_CHANGED',
                    resourceType: 'TASK',
                    resourceId: taskId,
                    summary: `任务“${task.title}”的负责人或协作人已调整`,
                    metadata,
                },
            });
            await transaction.auditLog.create({
                data: auditData(context, 'TASK_ASSIGNEES_CHANGED', 'TASK', taskId, { projectId, ...metadata }),
            });
        });
        return this.getTask(projectId, taskId);
    }

    async listComments(projectId: string, taskId: string, query: ListTaskEntriesQueryDto): Promise<TaskCommentListResult> {
        const context = this.tenantContext.require();
        await this.requireProjectAccess(context, projectId);
        await this.requireTask(context, projectId, taskId);
        const comments = await this.prisma.taskComment.findMany({
            where: { tenantId: context.tenantId, taskId, deletedAt: null },
            select: commentSelect,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        const hasNextPage = comments.length > query.limit;
        const page = hasNextPage ? comments.slice(0, query.limit) : comments;
        return {
            items: page.map(toTaskCommentResult),
            nextCursor: hasNextPage ? page[page.length - 1]?.id ?? null : null,
        };
    }

    async createComment(projectId: string, taskId: string, input: CreateTaskCommentDto): Promise<TaskCommentResult> {
        const context = this.tenantContext.require();
        const content = normalizeRequiredText(input.content, 'TASK_COMMENT_CONTENT_REQUIRED', '评论内容不能为空');
        const commentId = await this.prisma.$transaction(async (transaction) => {
            await lockProjectForUpdate(transaction, context.tenantId, projectId);
            const project = await this.requireProjectAccess(context, projectId, transaction);
            await this.requireTask(context, projectId, taskId, transaction);
            this.assertProjectEditable(project);
            const comment = await transaction.taskComment.create({
                data: {
                    tenantId: context.tenantId,
                    taskId,
                    content,
                    authorMembershipId: context.membershipId,
                    createdBy: context.userId,
                    updatedBy: context.userId,
                },
                select: { id: true },
            });
            await transaction.taskActivity.create({
                data: activityData(context, taskId, 'TASK_COMMENT_CREATED', { commentId: comment.id }),
            });
            await transaction.auditLog.create({
                data: auditData(context, 'TASK_COMMENT_CREATED', 'TASK_COMMENT', comment.id, { projectId, taskId }),
            });
            return comment.id;
        });
        return this.requireComment(context, taskId, commentId);
    }

    async updateComment(
        projectId: string,
        taskId: string,
        commentId: string,
        input: UpdateTaskCommentDto,
    ): Promise<TaskCommentResult> {
        const context = this.tenantContext.require();
        const content = normalizeRequiredText(input.content, 'TASK_COMMENT_CONTENT_REQUIRED', '评论内容不能为空');
        await this.prisma.$transaction(async (transaction) => {
            await lockProjectForUpdate(transaction, context.tenantId, projectId);
            const project = await this.requireProjectAccess(context, projectId, transaction);
            const task = await this.requireTask(context, projectId, taskId, transaction);
            const comment = await this.requireCommentRecord(context, taskId, commentId, transaction);
            this.assertProjectEditable(project);
            this.assertCommentManager(context, project, task, comment.authorMembership.id);
            const updated = await transaction.taskComment.updateMany({
                where: { id: commentId, tenantId: context.tenantId, taskId, version: input.version, deletedAt: null },
                data: { content, updatedBy: context.userId, version: { increment: 1 } },
            });
            if (updated.count !== 1) throw this.versionConflict();
            await transaction.taskActivity.create({
                data: activityData(context, taskId, 'TASK_COMMENT_UPDATED', { commentId }),
            });
            await transaction.auditLog.create({
                data: auditData(context, 'TASK_COMMENT_UPDATED', 'TASK_COMMENT', commentId, { projectId, taskId }),
            });
        });
        return this.requireComment(context, taskId, commentId);
    }

    async deleteComment(projectId: string, taskId: string, commentId: string, version: number): Promise<void> {
        const context = this.tenantContext.require();
        await this.prisma.$transaction(async (transaction) => {
            await lockProjectForUpdate(transaction, context.tenantId, projectId);
            const project = await this.requireProjectAccess(context, projectId, transaction);
            const task = await this.requireTask(context, projectId, taskId, transaction);
            const comment = await this.requireCommentRecord(context, taskId, commentId, transaction);
            this.assertProjectEditable(project);
            this.assertCommentManager(context, project, task, comment.authorMembership.id);
            const deleted = await transaction.taskComment.updateMany({
                where: { id: commentId, tenantId: context.tenantId, taskId, version, deletedAt: null },
                data: { deletedAt: new Date(), updatedBy: context.userId, version: { increment: 1 } },
            });
            if (deleted.count !== 1) throw this.versionConflict();
            await transaction.taskActivity.create({
                data: activityData(context, taskId, 'TASK_COMMENT_DELETED', { commentId }),
            });
            await transaction.auditLog.create({
                data: auditData(context, 'TASK_COMMENT_DELETED', 'TASK_COMMENT', commentId, { projectId, taskId }),
            });
        });
    }

    async listAttachments(projectId: string, taskId: string): Promise<TaskAttachmentListResult> {
        const context = this.tenantContext.require();
        await this.requireProjectAccess(context, projectId);
        await this.requireTask(context, projectId, taskId);
        const attachments = await this.prisma.taskAttachment.findMany({
            where: { tenantId: context.tenantId, taskId, deletedAt: null },
            select: attachmentSelect,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        return { items: attachments.map(toTaskAttachmentResult) };
    }

    async addAttachment(projectId: string, taskId: string, input: AddTaskAttachmentDto): Promise<TaskAttachmentResult> {
        const context = this.tenantContext.require();
        let attachmentId: string;
        try {
            attachmentId = await this.prisma.$transaction(async (transaction) => {
                await lockProjectForUpdate(transaction, context.tenantId, projectId);
                const project = await this.requireProjectAccess(context, projectId, transaction);
                await this.requireTask(context, projectId, taskId, transaction);
                this.assertProjectEditable(project);
                const file = await transaction.fileObject.findFirst({
                    where: {
                        id: input.fileObjectId,
                        tenantId: context.tenantId,
                        purpose: FilePurpose.ATTACHMENT,
                        deletedAt: null,
                    },
                    select: { id: true },
                });
                if (!file) {
                    throw new BadRequestException({
                        code: 'TASK_ATTACHMENT_FILE_INVALID',
                        message: '文件不存在、未完成上传或不属于当前租户',
                    });
                }
                const attachment = await transaction.taskAttachment.create({
                    data: {
                        tenantId: context.tenantId,
                        taskId,
                        fileObjectId: input.fileObjectId,
                        createdByMembershipId: context.membershipId,
                        createdBy: context.userId,
                        updatedBy: context.userId,
                    },
                    select: { id: true },
                });
                await transaction.taskActivity.create({
                    data: activityData(context, taskId, 'TASK_ATTACHMENT_ADDED', {
                        attachmentId: attachment.id,
                        fileObjectId: input.fileObjectId,
                    }),
                });
                await transaction.auditLog.create({
                    data: auditData(context, 'TASK_ATTACHMENT_ADDED', 'TASK_ATTACHMENT', attachment.id, {
                        projectId, taskId, fileObjectId: input.fileObjectId,
                    }),
                });
                return attachment.id;
            });
        } catch (error) {
            if (isPrismaError(error, 'P2002')) {
                throw new ConflictException({
                    code: 'TASK_ATTACHMENT_CONFLICT', message: '该文件已经关联到当前任务',
                });
            }
            throw error;
        }
        return this.requireAttachment(context, taskId, attachmentId);
    }

    async removeAttachment(
        projectId: string,
        taskId: string,
        attachmentId: string,
        version: number,
    ): Promise<void> {
        const context = this.tenantContext.require();
        await this.prisma.$transaction(async (transaction) => {
            await lockProjectForUpdate(transaction, context.tenantId, projectId);
            const project = await this.requireProjectAccess(context, projectId, transaction);
            const task = await this.requireTask(context, projectId, taskId, transaction);
            const attachment = await this.requireAttachmentRecord(context, taskId, attachmentId, transaction);
            this.assertProjectEditable(project);
            if (attachment.createdByMembershipId !== context.membershipId && !this.isTaskManager(context, project, task)) {
                throw new ForbiddenException({
                    code: 'TASK_ATTACHMENT_MUTATION_DENIED',
                    message: '只有附件添加者或任务管理者可以移除附件',
                });
            }
            const removed = await transaction.taskAttachment.updateMany({
                where: { id: attachmentId, tenantId: context.tenantId, taskId, version, deletedAt: null },
                data: { deletedAt: new Date(), updatedBy: context.userId, version: { increment: 1 } },
            });
            if (removed.count !== 1) throw this.versionConflict();
            const metadata = { attachmentId, fileObjectId: attachment.fileObjectId };
            await transaction.taskActivity.create({
                data: activityData(context, taskId, 'TASK_ATTACHMENT_REMOVED', metadata),
            });
            await transaction.auditLog.create({
                data: auditData(context, 'TASK_ATTACHMENT_REMOVED', 'TASK_ATTACHMENT', attachmentId, {
                    projectId, taskId, fileObjectId: attachment.fileObjectId,
                }),
            });
        });
    }

    async listActivities(projectId: string, taskId: string, query: ListTaskEntriesQueryDto): Promise<TaskActivityListResult> {
        const context = this.tenantContext.require();
        await this.requireProjectAccess(context, projectId);
        await this.requireTask(context, projectId, taskId);
        const activities = await this.prisma.taskActivity.findMany({
            where: { tenantId: context.tenantId, taskId },
            select: activitySelect,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        const hasNextPage = activities.length > query.limit;
        const page = hasNextPage ? activities.slice(0, query.limit) : activities;
        return {
            items: page.map(toTaskActivityResult),
            nextCursor: hasNextPage ? page[page.length - 1]?.id ?? null : null,
        };
    }

    private async syncDailyReportOnTaskDone(
        transaction: Prisma.TransactionClient,
        context: RequestTenantContext,
        project: ProjectAccessRecord,
        task: TaskRecord,
        completedAt: Date,
    ): Promise<void> {
        const owner = task.assignees.find((assignee) => assignee.assigneeType === TaskAssigneeType.OWNER);
        if (!owner) return;

        const dateKey = localDateKey(project.tenant.timezone, completedAt);
        const periodStart = dateKeyToUtcMidnight(dateKey);
        const item = `完成：${task.title}`;
        const existing = await transaction.workReport.findFirst({
            where: {
                tenantId: context.tenantId,
                authorMembershipId: owner.membershipId,
                type: 'DAILY',
                periodStart,
                deletedAt: null,
            },
            select: { id: true, content: true, status: true, reviewerMembershipId: true, version: true },
        });

        if (existing && existing.status !== 'DRAFT' && existing.status !== 'REJECTED') {
            await transaction.projectActivity.create({
                data: {
                    tenantId: context.tenantId,
                    projectId: project.id,
                    actorMembershipId: context.membershipId,
                    type: 'DAILY_REPORT_UPDATE_REQUIRED',
                    resourceType: 'TASK',
                    resourceId: task.id,
                    summary: `任务“${task.title}”在日报提交后完成，日报 ${dateKey} 待补充`,
                    metadata: { authorMembershipId: owner.membershipId, reportDate: dateKey },
                },
            });
            return;
        }

        const reviewerMembershipId = existing?.reviewerMembershipId ?? await this.pickDailyReportReviewer(
            transaction,
            context.tenantId,
            project,
            owner.membershipId,
        );
        const content = existing ? appendCompletedItem(existing.content, item) : {
            completedItems: [item],
            plannedItems: [],
            blockers: [],
            remarks: null,
        };

        const reportId = existing
            ? existing.id
            : (await transaction.workReport.create({
                data: {
                    tenantId: context.tenantId,
                    authorMembershipId: owner.membershipId,
                    reviewerMembershipId,
                    type: 'DAILY',
                    periodStart,
                    periodEnd: periodStart,
                    content: content as unknown as Prisma.InputJsonValue,
                    createdBy: context.userId,
                    updatedBy: context.userId,
                },
                select: { id: true },
            })).id;

        if (existing) {
            await transaction.workReport.update({
                where: { id: existing.id },
                data: {
                    content: content as unknown as Prisma.InputJsonValue,
                    reviewerMembershipId: reviewerMembershipId ?? existing.reviewerMembershipId,
                    updatedBy: context.userId,
                    version: { increment: 1 },
                },
            });
        }

        await transaction.workReportProject.upsert({
            where: { tenantId_workReportId_projectId: { tenantId: context.tenantId, workReportId: reportId, projectId: project.id } },
            create: { tenantId: context.tenantId, workReportId: reportId, projectId: project.id, createdBy: context.userId },
            update: {},
        });
        await transaction.workReportTask.upsert({
            where: { tenantId_workReportId_taskId: { tenantId: context.tenantId, workReportId: reportId, taskId: task.id } },
            create: { tenantId: context.tenantId, workReportId: reportId, taskId: task.id, createdBy: context.userId },
            update: {},
        });
        await transaction.auditLog.create({
            data: auditData(context, existing ? 'WORK_REPORT_AUTO_UPDATED_FROM_TASK' : 'WORK_REPORT_AUTO_CREATED_FROM_TASK', 'WORK_REPORT', reportId, {
                projectId: project.id,
                taskId: task.id,
                authorMembershipId: owner.membershipId,
                reportDate: dateKey,
            }),
        });
        await transaction.projectActivity.create({
            data: {
                tenantId: context.tenantId,
                projectId: project.id,
                actorMembershipId: context.membershipId,
                type: 'DAILY_REPORT_UPDATED',
                resourceType: 'WORK_REPORT',
                resourceId: reportId,
                summary: `已将任务“${task.title}”带入 ${dateKey} 日报草稿`,
                metadata: { ownerMembershipId: owner.membershipId, reportDate: dateKey },
            },
        });
    }

    private async pickDailyReportReviewer(
        transaction: Prisma.TransactionClient,
        tenantId: string,
        project: ProjectAccessRecord,
        authorMembershipId: string,
    ): Promise<string | null> {
        if (project.ownerMembershipId && project.ownerMembershipId !== authorMembershipId) return project.ownerMembershipId;
        const members = await transaction.projectMember.findMany({
            where: {
                tenantId,
                projectId: project.id,
                membershipId: { not: authorMembershipId },
                deletedAt: null,
                membership: { is: { status: MembershipStatus.ACTIVE, deletedAt: null } },
            },
            select: { membershipId: true, role: true },
        });
        const order: Record<ProjectMemberRole, number> = {
            [ProjectMemberRole.OWNER]: 0,
            [ProjectMemberRole.MANAGER]: 1,
            [ProjectMemberRole.MEMBER]: 2,
        };
        members.sort((left, right) => order[left.role] - order[right.role]);
        return members[0]?.membershipId ?? null;
    }

    private async requireProjectAccess(
        context: RequestTenantContext,
        projectId: string,
        db: TaskDb = this.prisma,
    ): Promise<ProjectAccessRecord> {
        const project = await db.project.findFirst({
            where: {
                id: projectId,
                tenantId: context.tenantId,
                deletedAt: null,
                members: { some: { membershipId: context.membershipId, deletedAt: null } },
            },
            select: {
                id: true,
                status: true,
                ownerMembershipId: true,
                tenant: { select: { timezone: true } },
                members: {
                    where: { membershipId: context.membershipId, deletedAt: null },
                    select: { role: true },
                },
            },
        });
        if (!project) {
            throw new NotFoundException({
                code: 'PROJECT_NOT_FOUND',
                message: '项目不存在或当前成员尚未加入该项目',
            });
        }
        return project;
    }

    private async requireTask(
        context: RequestTenantContext,
        projectId: string,
        taskId: string,
        db: TaskDb = this.prisma,
    ): Promise<TaskRecord> {
        const task = await db.task.findFirst({
            where: { id: taskId, tenantId: context.tenantId, projectId, deletedAt: null },
            select: taskSelect,
        });
        if (!task) throw this.taskNotFound();
        return task;
    }

    private async requireComment(
        context: RequestTenantContext,
        taskId: string,
        commentId: string,
        db: TaskDb = this.prisma,
    ): Promise<TaskCommentResult> {
        return toTaskCommentResult(await this.requireCommentRecord(context, taskId, commentId, db));
    }

    private async requireCommentRecord(
        context: RequestTenantContext,
        taskId: string,
        commentId: string,
        db: TaskDb = this.prisma,
    ): Promise<TaskCommentRecord> {
        const comment = await db.taskComment.findFirst({
            where: { id: commentId, tenantId: context.tenantId, taskId, deletedAt: null },
            select: commentSelect,
        });
        if (!comment) throw new NotFoundException({ code: 'TASK_COMMENT_NOT_FOUND', message: '任务评论不存在' });
        return comment;
    }

    private async requireAttachment(
        context: RequestTenantContext,
        taskId: string,
        attachmentId: string,
        db: TaskDb = this.prisma,
    ): Promise<TaskAttachmentResult> {
        return toTaskAttachmentResult(await this.requireAttachmentRecord(context, taskId, attachmentId, db));
    }

    private async requireAttachmentRecord(
        context: RequestTenantContext,
        taskId: string,
        attachmentId: string,
        db: TaskDb = this.prisma,
    ): Promise<TaskAttachmentRecord> {
        const attachment = await db.taskAttachment.findFirst({
            where: { id: attachmentId, tenantId: context.tenantId, taskId, deletedAt: null },
            select: attachmentSelect,
        });
        if (!attachment) {
            throw new NotFoundException({ code: 'TASK_ATTACHMENT_NOT_FOUND', message: '任务附件不存在' });
        }
        return attachment;
    }

    private async validateProjectAssignees(
        context: RequestTenantContext,
        projectId: string,
        ownerMembershipId: string,
        collaboratorMembershipIds: string[],
        db: TaskDb = this.prisma,
    ): Promise<void> {
        if (collaboratorMembershipIds.includes(ownerMembershipId)) {
            throw new BadRequestException({ code: 'TASK_ASSIGNEE_DUPLICATED', message: '任务负责人不能同时作为协作人' });
        }
        const membershipIds = [ownerMembershipId, ...collaboratorMembershipIds];
        const members = await db.projectMember.findMany({
            where: {
                tenantId: context.tenantId,
                projectId,
                membershipId: { in: membershipIds },
                deletedAt: null,
                membership: {
                    is: { tenantId: context.tenantId, status: MembershipStatus.ACTIVE, deletedAt: null },
                },
            },
            select: { membershipId: true },
        });
        const validIds = new Set(members.map((member) => member.membershipId));
        const invalidMembershipIds = membershipIds.filter((membershipId) => !validIds.has(membershipId));
        if (invalidMembershipIds.length > 0) {
            throw new BadRequestException({
                code: 'TASK_ASSIGNEE_INVALID',
                message: '任务负责人和协作人必须是当前项目的有效成员',
                details: { membershipIds: invalidMembershipIds },
            });
        }
    }

    private async validateTaskParent(
        context: RequestTenantContext,
        projectId: string,
        parentId: string | null,
        taskId?: string,
        db: TaskDb = this.prisma,
    ): Promise<void> {
        const tasks = await db.task.findMany({
            where: { tenantId: context.tenantId, projectId, deletedAt: null },
            select: { id: true, parentId: true },
        });
        const parentById = new Map(tasks.map((task) => [task.id, task.parentId]));
        if (parentId !== null && !parentById.has(parentId)) {
            throw new BadRequestException({ code: 'TASK_PARENT_INVALID', message: '父任务不存在或不属于当前项目' });
        }
        if (!taskId) {
            if (parentId !== null && hierarchyDepth(parentById, parentId) >= MAX_TASK_DEPTH) {
                throw this.taskDepthConflict();
            }
            return;
        }
        if (parentId === taskId) throw this.taskHierarchyCycle();
        let currentId = parentId;
        const visited = new Set<string>();
        while (currentId) {
            if (currentId === taskId || visited.has(currentId)) throw this.taskHierarchyCycle();
            visited.add(currentId);
            currentId = parentById.get(currentId) ?? null;
        }
        const parentDepth = parentId ? hierarchyDepth(parentById, parentId) : 0;
        const subtreeDepth = taskSubtreeDepth(tasks, taskId);
        if (parentDepth + subtreeDepth > MAX_TASK_DEPTH) throw this.taskDepthConflict();
    }

    private assertProjectEditable(project: ProjectAccessRecord): void {
        if (READ_ONLY_PROJECT_STATUSES.has(project.status)) {
            throw new ConflictException({
                code: 'PROJECT_READ_ONLY',
                message: '已完成、已取消或已归档项目不允许新增或修改任务',
            });
        }
    }

    private assertTaskEditable(task: TaskRecord): void {
        if (TERMINAL_TASK_STATUSES.has(task.status)) {
            throw new ConflictException({ code: 'TASK_READ_ONLY', message: '已完成或已取消任务不允许修改资料和执行人' });
        }
    }

    private assertTaskManager(context: RequestTenantContext, project: ProjectAccessRecord, task: TaskRecord): void {
        if (!this.isTaskManager(context, project, task)) {
            throw new ForbiddenException({
                code: 'TASK_MANAGER_REQUIRED',
                message: '需要项目负责人、项目经理或任务负责人身份',
            });
        }
    }

    private assertTaskExecutorOrManager(
        context: RequestTenantContext,
        project: ProjectAccessRecord,
        task: TaskRecord,
    ): void {
        const assigned = task.assignees.some((assignee) => assignee.membershipId === context.membershipId);
        if (!assigned && !this.isProjectManager(project)) {
            throw new ForbiddenException({
                code: 'TASK_EXECUTOR_REQUIRED', message: '只有任务执行人或项目管理者可以变更任务状态',
            });
        }
    }

    private assertCommentManager(
        context: RequestTenantContext,
        project: ProjectAccessRecord,
        task: TaskRecord,
        authorMembershipId: string,
    ): void {
        if (authorMembershipId !== context.membershipId && !this.isTaskManager(context, project, task)) {
            throw new ForbiddenException({
                code: 'TASK_COMMENT_MUTATION_DENIED',
                message: '只有评论作者或任务管理者可以修改或删除评论',
            });
        }
    }

    private isTaskManager(context: RequestTenantContext, project: ProjectAccessRecord, task: TaskRecord): boolean {
        return this.isProjectManager(project)
            || task.assignees.some((assignee) => (
                assignee.assigneeType === TaskAssigneeType.OWNER
                && assignee.membershipId === context.membershipId
            ));
    }

    private isProjectManager(project: ProjectAccessRecord): boolean {
        const role = project.members[0]?.role;
        return role === ProjectMemberRole.OWNER || role === ProjectMemberRole.MANAGER;
    }

    private taskNotFound(): NotFoundException {
        return new NotFoundException({ code: 'TASK_NOT_FOUND', message: '任务不存在或不属于当前项目' });
    }

    private versionConflict(): ConflictException {
        return new ConflictException({ code: 'TASK_VERSION_CONFLICT', message: '数据已被其他操作修改，请刷新后重试' });
    }

    private taskHierarchyCycle(): ConflictException {
        return new ConflictException({ code: 'TASK_HIERARCHY_CYCLE', message: '父子任务关系不能形成循环' });
    }

    private taskDepthConflict(): ConflictException {
        return new ConflictException({
            code: 'TASK_HIERARCHY_DEPTH_EXCEEDED', message: `任务层级最多允许 ${MAX_TASK_DEPTH} 层`,
        });
    }
}

function toTaskResult(task: TaskRecord): TaskResult {
    const assignees = task.assignees.map(toTaskAssigneeResult);
    return {
        id: task.id,
        projectId: task.projectId as string,
        parentId: task.parentId,
        decisionId: task.relationType === 'PROJECT_DECISION' ? task.relationId : null,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        owner: assignees.find((assignee) => assignee.type === TaskAssigneeType.OWNER) ?? null,
        collaborators: assignees.filter((assignee) => assignee.type === TaskAssigneeType.COLLABORATOR),
        subtaskCount: task._count.children,
        commentCount: task._count.comments,
        attachmentCount: task._count.attachments,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        version: task.version,
    };
}

function toTaskAssigneeResult(assignee: TaskRecord['assignees'][number]): TaskAssigneeResult {
    return { ...toTaskMemberResult(assignee.membership), type: assignee.assigneeType };
}

function toTaskMemberResult(member: TaskRecord['assignees'][number]['membership']): TaskMemberResult {
    return {
        membershipId: member.id,
        account: member.account,
        displayName: member.displayName ?? member.user.displayName,
        departmentId: member.departmentId,
    };
}

function toTaskCommentResult(comment: TaskCommentRecord): TaskCommentResult {
    return {
        id: comment.id,
        taskId: comment.taskId,
        content: comment.content,
        author: toTaskMemberResult(comment.authorMembership),
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        version: comment.version,
    };
}

function toTaskAttachmentResult(attachment: TaskAttachmentRecord): TaskAttachmentResult {
    return {
        id: attachment.id,
        taskId: attachment.taskId,
        fileObjectId: attachment.fileObjectId,
        fileName: attachment.fileObject.originalName,
        contentType: attachment.fileObject.mimeType,
        sizeBytes: Number(attachment.fileObject.sizeBytes),
        createdByMembershipId: attachment.createdByMembershipId,
        createdAt: attachment.createdAt,
        version: attachment.version,
    };
}

function toTaskActivityResult(activity: TaskActivityRecord): TaskActivityResult {
    return {
        id: activity.id,
        taskId: activity.taskId,
        action: activity.action,
        actor: activity.actorMembership ? toTaskMemberResult(activity.actorMembership) : null,
        metadata: activity.metadata as Record<string, unknown> | null,
        createdAt: activity.createdAt,
    };
}

function buildAssigneeRows(
    tenantId: string,
    taskId: string,
    ownerMembershipId: string,
    collaboratorMembershipIds: string[],
): Prisma.TaskAssigneeCreateManyInput[] {
    return [
        { tenantId, taskId, membershipId: ownerMembershipId, assigneeType: TaskAssigneeType.OWNER },
        ...collaboratorMembershipIds.map((membershipId) => ({
            tenantId,
            taskId,
            membershipId,
            assigneeType: TaskAssigneeType.COLLABORATOR,
        })),
    ];
}

function uniqueMembershipIds(membershipIds: string[]): string[] {
    return [...new Set(membershipIds)];
}

function hasTaskChanges(input: UpdateTaskDto): boolean {
    return input.title !== undefined
        || input.description !== undefined
        || input.parentId !== undefined
        || input.priority !== undefined
        || input.dueDate !== undefined;
}

function normalizeRequiredText(value: string, code: string, message: string): string {
    const normalized = value.trim();
    if (!normalized) throw new BadRequestException({ code, message });
    return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}

function toNullableDate(value: string | null | undefined): Date | null {
    return value ? new Date(value) : null;
}

function hierarchyDepth(parentById: Map<string, string | null>, taskId: string): number {
    let depth = 0;
    let currentId: string | null = taskId;
    const visited = new Set<string>();
    while (currentId) {
        if (visited.has(currentId)) return MAX_TASK_DEPTH + 1;
        visited.add(currentId);
        depth += 1;
        currentId = parentById.get(currentId) ?? null;
    }
    return depth;
}

function taskSubtreeDepth(tasks: Array<{ id: string; parentId: string | null }>, rootTaskId: string): number {
    const childIdsByParent = new Map<string, string[]>();
    for (const task of tasks) {
        if (!task.parentId) continue;
        const childIds = childIdsByParent.get(task.parentId) ?? [];
        childIds.push(task.id);
        childIdsByParent.set(task.parentId, childIds);
    }
    const calculate = (taskId: string, visited: Set<string>): number => {
        if (visited.has(taskId)) return MAX_TASK_DEPTH + 1;
        const nextVisited = new Set(visited).add(taskId);
        const children = childIdsByParent.get(taskId) ?? [];
        return 1 + Math.max(0, ...children.map((childId) => calculate(childId, nextVisited)));
    };
    return calculate(rootTaskId, new Set());
}

function activityData(
    context: RequestTenantContext,
    taskId: string,
    action: string,
    metadata: Prisma.InputJsonObject,
): Prisma.TaskActivityUncheckedCreateInput {
    return {
        tenantId: context.tenantId,
        taskId,
        action,
        metadata,
        actorMembershipId: context.membershipId,
        createdBy: context.userId,
    };
}

function auditData(
    context: RequestTenantContext,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Prisma.InputJsonObject,
): Prisma.AuditLogUncheckedCreateInput {
    return {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        action,
        outcome: AuditOutcome.SUCCESS,
        resourceType,
        resourceId,
        requestId: context.requestId,
        metadata,
    };
}

function isPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function appendCompletedItem(content: Prisma.JsonValue, item: string): { completedItems: string[]; plannedItems: string[]; blockers: string[]; remarks: string | null } {
    const source = content && typeof content === 'object' && !Array.isArray(content) ? content as Record<string, unknown> : {};
    const completedItems = Array.isArray(source.completedItems) ? source.completedItems.filter((entry): entry is string => typeof entry === 'string') : [];
    const plannedItems = Array.isArray(source.plannedItems) ? source.plannedItems.filter((entry): entry is string => typeof entry === 'string') : [];
    const blockers = Array.isArray(source.blockers) ? source.blockers.filter((entry): entry is string => typeof entry === 'string') : [];
    if (!completedItems.includes(item)) completedItems.push(item);
    return { completedItems, plannedItems, blockers, remarks: typeof source.remarks === 'string' ? source.remarks : null };
}
