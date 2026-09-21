import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
    AuditOutcome,
    MembershipStatus,
    Prisma,
    ProjectMemberRole,
    ProjectStatus,
    TaskStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { calendarYear, DEFAULT_TENANT_TIMEZONE } from '../common/tenant-time';
import { PrismaService } from '../database/prisma.service';
import { RequestTenantContext, TenantContext } from '../tenant/tenant-context';
import { lockProjectForUpdate } from './project-transaction-lock';
import {
    AddProjectMemberDto,
    CompleteProjectDto,
    CreateProjectDto,
    ListProjectsQueryDto,
    ProjectReasonDto,
    ProjectVersionDto,
    TransferProjectOwnerDto,
    UpdateProjectDto,
    UpdateProjectMemberDto,
} from './dto';
import { ProjectListResult, ProjectMemberListResult, ProjectMemberResult, ProjectResult } from './project.types';

const memberSelect = {
    id: true,
    membershipId: true,
    role: true,
    joinedAt: true,
    version: true,
    membership: {
        select: {
            id: true,
            account: true,
            displayName: true,
            departmentId: true,
            user: { select: { displayName: true } },
        },
    },
} satisfies Prisma.ProjectMemberSelect;

const projectSelect = {
    id: true,
    tenantId: true,
    code: true,
    normalizedCode: true,
    departmentId: true,
    ownerMembershipId: true,
    ownerMembership: {
        select: {
            id: true,
            account: true,
            displayName: true,
            departmentId: true,
            user: { select: { displayName: true } },
        },
    },
    name: true,
    description: true,
    status: true,
    startedAt: true,
    completedAt: true,
    closedAt: true,
    completedByMembershipId: true,
    completionSummary: true,
    createdAt: true,
    updatedAt: true,
    version: true,
    members: {
        where: { deletedAt: null },
        select: memberSelect,
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }, { id: 'asc' }],
    },
    _count: { select: { members: { where: { deletedAt: null } } } },
} satisfies Prisma.ProjectSelect;

type ProjectRecord = Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;
type ProjectMemberRecord = Prisma.ProjectMemberGetPayload<{ select: typeof memberSelect }>;
type ProjectDb = PrismaService | Prisma.TransactionClient;

interface TransitionOptions {
    from: ProjectStatus[];
    to: ProjectStatus;
    action: string;
    ownerOnly?: boolean;
    reason?: string | null;
    completionSummary?: string | null;
    requireFinishedTasks?: boolean;
}

const READ_ONLY_STATUSES = new Set<ProjectStatus>([
    ProjectStatus.COMPLETED,
    ProjectStatus.CANCELLED,
    ProjectStatus.ARCHIVED,
]);

@Injectable()
export class ProjectService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
    ) { }

    async listProjects(query: ListProjectsQueryDto): Promise<ProjectListResult> {
        const context = this.tenantContext.require();
        const keyword = query.keyword?.trim();
        const projects = await this.prisma.project.findMany({
            where: {
                tenantId: context.tenantId,
                deletedAt: null,
                status: query.status ?? (query.includeArchived ? undefined : { not: ProjectStatus.ARCHIVED }),
                departmentId: query.departmentId,
                ownerMembershipId: query.ownerMembershipId,
                members: this.canManageAll(context)
                    ? undefined
                    : { some: { membershipId: context.membershipId, deletedAt: null } },
                OR: keyword
                    ? [
                        { code: { contains: keyword, mode: 'insensitive' } },
                        { name: { contains: keyword, mode: 'insensitive' } },
                    ]
                    : undefined,
            },
            select: projectSelect,
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        const hasNextPage = projects.length > query.limit;
        const page = hasNextPage ? projects.slice(0, query.limit) : projects;
        const taskCounts = await this.getTaskCounts(context.tenantId, page.map((project) => project.id));
        return {
            items: page.map((project) => toProjectResult(project, context.membershipId, taskCounts.get(project.id) ?? 0)),
            nextCursor: hasNextPage ? page[page.length - 1]?.id ?? null : null,
        };
    }

    async getProject(projectId: string): Promise<ProjectResult> {
        const context = this.tenantContext.require();
        const project = await this.requireProject(context, projectId);
        const taskCount = await this.prisma.task.count({
            where: { tenantId: context.tenantId, projectId, deletedAt: null },
        });
        return toProjectResult(project, context.membershipId, taskCount);
    }

    async createProject(input: CreateProjectDto): Promise<ProjectResult> {
        const context = this.tenantContext.require();
        const ownerMembershipId = input.ownerMembershipId ?? context.membershipId;
        if (ownerMembershipId !== context.membershipId && !this.canManageAll(context)) {
            throw new ForbiddenException({ code: 'PROJECT_OWNER_ASSIGN_DENIED', message: '只有项目全局管理员可以指定其他负责人' });
        }
        const memberMembershipIds = [...new Set(input.memberMembershipIds ?? [])]
            .filter((membershipId) => membershipId !== ownerMembershipId);
        if (memberMembershipIds.length > 0 && !context.permissions.includes('project.member.manage')) {
            throw new ForbiddenException({
                code: 'PROJECT_MEMBER_MANAGE_DENIED',
                message: '创建项目时指定初始成员需要 project.member.manage 权限',
            });
        }
        await Promise.all([
            this.requireActiveMembership(context.tenantId, ownerMembershipId),
            this.requireDepartment(context.tenantId, input.departmentId),
        ]);
        await Promise.all(memberMembershipIds.map((membershipId) =>
            this.requireActiveMembership(context.tenantId, membershipId)));
        const name = normalizeRequiredText(input.name);
        let projectId: string;
        try {
            projectId = await this.prisma.$transaction(async (transaction) => {
                const code = await this.allocateProjectCode(context.tenantId, transaction);
                const project = await transaction.project.create({
                    data: {
                        tenantId: context.tenantId,
                        code,
                        normalizedCode: code.toLocaleLowerCase(),
                        departmentId: input.departmentId ?? null,
                        ownerMembershipId,
                        name,
                        description: normalizeOptionalText(input.description),
                        createdBy: context.userId,
                        updatedBy: context.userId,
                    },
                    select: { id: true },
                });
                await transaction.projectMember.createMany({
                    data: [ownerMembershipId, ...memberMembershipIds].map((membershipId) => ({
                        tenantId: context.tenantId,
                        projectId: project.id,
                        membershipId,
                        role: membershipId === ownerMembershipId ? ProjectMemberRole.OWNER : ProjectMemberRole.MEMBER,
                        createdBy: context.userId,
                        updatedBy: context.userId,
                    })),
                });
                await transaction.auditLog.create({
                    data: auditData(context, 'PROJECT_CREATED', project.id, {
                        code,
                        name,
                        ownerMembershipId,
                        departmentId: input.departmentId ?? null,
                        memberMembershipIds,
                    }),
                });
                return project.id;
            });
        } catch (error) {
            if (isPrismaError(error, 'P2002')) throw this.codeConflict();
            throw error;
        }
        return this.getProject(projectId);
    }

    async updateProject(projectId: string, input: UpdateProjectDto): Promise<ProjectResult> {
        const context = this.tenantContext.require();
        if (!hasProjectChanges(input)) {
            throw new BadRequestException({ code: 'PROJECT_UPDATE_EMPTY', message: '至少提供一个需要修改的字段' });
        }
        await this.prisma.$transaction(async (transaction) => {
            await lockProjectForUpdate(transaction, context.tenantId, projectId);
            const project = await this.requireProject(context, projectId, transaction);
            this.assertManager(context, project);
            this.assertEditable(project);
            await this.requireDepartment(context.tenantId, input.departmentId, transaction);
            const data: Prisma.ProjectUncheckedUpdateManyInput = {
                version: { increment: 1 },
                updatedBy: context.userId,
            };
            if (input.name !== undefined) data.name = normalizeRequiredText(input.name);
            if (input.description !== undefined) data.description = normalizeOptionalText(input.description);
            if (input.departmentId !== undefined) data.departmentId = input.departmentId;
            const updated = await transaction.project.updateMany({
                where: { id: projectId, tenantId: context.tenantId, version: input.version, deletedAt: null },
                data,
            });
            if (updated.count !== 1) throw this.versionConflict();
            await transaction.auditLog.create({
                data: auditData(context, 'PROJECT_UPDATED', projectId, {
                    before: projectSnapshot(project),
                    version: input.version,
                }),
            });
        });
        return this.getProject(projectId);
    }

    async deleteProject(projectId: string, version: number): Promise<void> {
        const context = this.tenantContext.require();
        const deletedAt = new Date();
        await this.prisma.$transaction(async (transaction) => {
            await lockProjectForUpdate(transaction, context.tenantId, projectId);
            const project = await this.requireProject(context, projectId, transaction);
            this.assertOwner(context, project);
            const taskCount = await transaction.task.count({ where: { tenantId: context.tenantId, projectId } });
            if (taskCount > 0) {
                throw new ConflictException({
                    code: 'PROJECT_HAS_BUSINESS_DATA',
                    message: '项目已有任务，不能删除，请完成或归档项目',
                });
            }
            const deleted = await transaction.project.updateMany({
                where: { id: projectId, tenantId: context.tenantId, version, deletedAt: null },
                data: { deletedAt, updatedBy: context.userId, version: { increment: 1 } },
            });
            if (deleted.count !== 1) throw this.versionConflict();
            await transaction.projectMember.updateMany({
                where: { tenantId: context.tenantId, projectId, deletedAt: null },
                data: { deletedAt, updatedBy: context.userId, version: { increment: 1 } },
            });
            await transaction.auditLog.create({
                data: auditData(context, 'PROJECT_DELETED', projectId, projectSnapshot(project)),
            });
        });
    }

    async listMembers(projectId: string): Promise<ProjectMemberListResult> {
        const context = this.tenantContext.require();
        const project = await this.requireProject(context, projectId);
        return { items: project.members.map(toProjectMemberResult) };
    }

    async addMember(projectId: string, input: AddProjectMemberDto): Promise<ProjectMemberResult> {
        const context = this.tenantContext.require();
        assertEditableMemberRole(input.role);
        let projectMemberId: string;
        try {
            projectMemberId = await this.prisma.$transaction(async (transaction) => {
                await lockProjectForUpdate(transaction, context.tenantId, projectId);
                const project = await this.requireProject(context, projectId, transaction);
                this.assertManager(context, project);
                this.assertEditable(project);
                await this.requireActiveMembership(context.tenantId, input.membershipId, transaction);
                const existing = await transaction.projectMember.findFirst({
                    where: { tenantId: context.tenantId, projectId, membershipId: input.membershipId },
                    select: { id: true, deletedAt: true },
                });
                if (existing && !existing.deletedAt) {
                    throw new ConflictException({ code: 'PROJECT_MEMBER_EXISTS', message: '该租户成员已经在项目中' });
                }
                const member = existing
                    ? await transaction.projectMember.update({
                        where: { id: existing.id },
                        data: {
                            role: input.role,
                            joinedAt: new Date(),
                            deletedAt: null,
                            updatedBy: context.userId,
                            version: { increment: 1 },
                        },
                        select: { id: true },
                    })
                    : await transaction.projectMember.create({
                        data: {
                            tenantId: context.tenantId,
                            projectId,
                            membershipId: input.membershipId,
                            role: input.role,
                            createdBy: context.userId,
                            updatedBy: context.userId,
                        },
                        select: { id: true },
                    });
                await transaction.auditLog.create({
                    data: auditData(context, 'PROJECT_MEMBER_ADDED', projectId, {
                        membershipId: input.membershipId,
                        role: input.role,
                    }),
                });
                return member.id;
            });
        } catch (error) {
            if (isPrismaError(error, 'P2002')) {
                throw new ConflictException({ code: 'PROJECT_MEMBER_EXISTS', message: '该租户成员已经在项目中' });
            }
            throw error;
        }
        return this.requireProjectMemberById(context.tenantId, projectMemberId);
    }

    async updateMember(
        projectId: string,
        membershipId: string,
        input: UpdateProjectMemberDto,
    ): Promise<ProjectMemberResult> {
        const context = this.tenantContext.require();
        assertEditableMemberRole(input.role);
        await this.prisma.$transaction(async (transaction) => {
            await lockProjectForUpdate(transaction, context.tenantId, projectId);
            const project = await this.requireProject(context, projectId, transaction);
            this.assertManager(context, project);
            this.assertEditable(project);
            const member = this.requireMember(project, membershipId);
            if (member.role === ProjectMemberRole.OWNER) throw this.ownerMutationConflict();
            const updated = await transaction.projectMember.updateMany({
                where: {
                    id: member.id,
                    tenantId: context.tenantId,
                    projectId,
                    version: input.version,
                    deletedAt: null,
                },
                data: { role: input.role, updatedBy: context.userId, version: { increment: 1 } },
            });
            if (updated.count !== 1) throw this.versionConflict();
            await transaction.auditLog.create({
                data: auditData(context, 'PROJECT_MEMBER_ROLE_CHANGED', projectId, {
                    membershipId,
                    fromRole: member.role,
                    toRole: input.role,
                }),
            });
        });
        return this.requireProjectMember(context.tenantId, projectId, membershipId);
    }

    async removeMember(projectId: string, membershipId: string, version: number): Promise<void> {
        const context = this.tenantContext.require();
        await this.prisma.$transaction(async (transaction) => {
            await lockProjectForUpdate(transaction, context.tenantId, projectId);
            const project = await this.requireProject(context, projectId, transaction);
            this.assertManager(context, project);
            this.assertEditable(project);
            const member = this.requireMember(project, membershipId);
            if (member.role === ProjectMemberRole.OWNER) throw this.ownerMutationConflict();
            const activeAssignment = await transaction.taskAssignee.findFirst({
                where: {
                    tenantId: context.tenantId,
                    membershipId,
                    task: {
                        projectId,
                        deletedAt: null,
                        status: { notIn: [TaskStatus.DONE, TaskStatus.CANCELLED] },
                    },
                },
                select: { taskId: true },
            });
            if (activeAssignment) {
                throw new ConflictException({
                    code: 'PROJECT_MEMBER_HAS_ACTIVE_TASKS',
                    message: '该成员仍负责或协作未完成任务，请先调整任务执行人',
                    details: { taskId: activeAssignment.taskId },
                });
            }
            const removed = await transaction.projectMember.updateMany({
                where: { id: member.id, tenantId: context.tenantId, projectId, version, deletedAt: null },
                data: { deletedAt: new Date(), updatedBy: context.userId, version: { increment: 1 } },
            });
            if (removed.count !== 1) throw this.versionConflict();
            await transaction.auditLog.create({
                data: auditData(context, 'PROJECT_MEMBER_REMOVED', projectId, { membershipId, role: member.role }),
            });
        });
    }

    async transferOwner(projectId: string, input: TransferProjectOwnerDto): Promise<ProjectResult> {
        const context = this.tenantContext.require();
        await this.prisma.$transaction(async (transaction) => {
            await lockProjectForUpdate(transaction, context.tenantId, projectId);
            const project = await this.requireProject(context, projectId, transaction);
            this.assertOwner(context, project);
            this.assertEditable(project);
            if (project.ownerMembershipId === input.membershipId) {
                throw new ConflictException({ code: 'PROJECT_OWNER_UNCHANGED', message: '目标成员已经是项目负责人' });
            }
            await this.requireActiveMembership(context.tenantId, input.membershipId, transaction);
            const target = this.requireMember(project, input.membershipId);
            const updated = await transaction.project.updateMany({
                where: { id: projectId, tenantId: context.tenantId, version: input.version, deletedAt: null },
                data: { ownerMembershipId: input.membershipId, updatedBy: context.userId, version: { increment: 1 } },
            });
            if (updated.count !== 1) throw this.versionConflict();
            if (project.ownerMembershipId) {
                await transaction.projectMember.updateMany({
                    where: {
                        tenantId: context.tenantId,
                        projectId,
                        membershipId: project.ownerMembershipId,
                        deletedAt: null,
                    },
                    data: { role: ProjectMemberRole.MANAGER, updatedBy: context.userId, version: { increment: 1 } },
                });
            }
            await transaction.projectMember.update({
                where: { id: target.id },
                data: { role: ProjectMemberRole.OWNER, updatedBy: context.userId, version: { increment: 1 } },
            });
            await transaction.auditLog.create({
                data: auditData(context, 'PROJECT_OWNER_TRANSFERRED', projectId, {
                    fromMembershipId: project.ownerMembershipId,
                    toMembershipId: input.membershipId,
                }),
            });
        });
        return this.getProject(projectId);
    }

    start(projectId: string, input: ProjectVersionDto): Promise<ProjectResult> {
        return this.transition(projectId, input.version, {
            from: [ProjectStatus.PLANNING], to: ProjectStatus.ACTIVE, action: 'PROJECT_STARTED',
        });
    }

    pause(projectId: string, input: ProjectVersionDto): Promise<ProjectResult> {
        return this.transition(projectId, input.version, {
            from: [ProjectStatus.ACTIVE], to: ProjectStatus.PAUSED, action: 'PROJECT_PAUSED',
        });
    }

    resume(projectId: string, input: ProjectVersionDto): Promise<ProjectResult> {
        return this.transition(projectId, input.version, {
            from: [ProjectStatus.PAUSED], to: ProjectStatus.ACTIVE, action: 'PROJECT_RESUMED',
        });
    }

    complete(projectId: string, input: CompleteProjectDto): Promise<ProjectResult> {
        return this.transition(projectId, input.version, {
            from: [ProjectStatus.ACTIVE],
            to: ProjectStatus.COMPLETED,
            action: 'PROJECT_COMPLETED',
            ownerOnly: true,
            completionSummary: normalizeOptionalText(input.completionSummary),
            requireFinishedTasks: true,
        });
    }

    reopen(projectId: string, input: ProjectReasonDto): Promise<ProjectResult> {
        return this.transition(projectId, input.version, {
            from: [ProjectStatus.COMPLETED],
            to: ProjectStatus.ACTIVE,
            action: 'PROJECT_REOPENED',
            ownerOnly: true,
            reason: normalizeRequiredText(input.reason),
        });
    }

    cancel(projectId: string, input: ProjectReasonDto): Promise<ProjectResult> {
        return this.transition(projectId, input.version, {
            from: [ProjectStatus.PLANNING, ProjectStatus.ACTIVE, ProjectStatus.PAUSED],
            to: ProjectStatus.CANCELLED,
            action: 'PROJECT_CANCELLED',
            reason: normalizeRequiredText(input.reason),
        });
    }

    archive(projectId: string, input: ProjectVersionDto): Promise<ProjectResult> {
        return this.transition(projectId, input.version, {
            from: [ProjectStatus.COMPLETED], to: ProjectStatus.ARCHIVED, action: 'PROJECT_ARCHIVED', ownerOnly: true,
        });
    }

    restore(projectId: string, input: ProjectVersionDto): Promise<ProjectResult> {
        return this.transition(projectId, input.version, {
            from: [ProjectStatus.ARCHIVED], to: ProjectStatus.COMPLETED, action: 'PROJECT_RESTORED', ownerOnly: true,
        });
    }

    private async transition(projectId: string, version: number, options: TransitionOptions): Promise<ProjectResult> {
        const context = this.tenantContext.require();
        await this.prisma.$transaction(async (transaction) => {
            await lockProjectForUpdate(transaction, context.tenantId, projectId);
            const project = await this.requireProject(context, projectId, transaction);
            if (options.ownerOnly) this.assertOwner(context, project);
            else this.assertManager(context, project);
            if (!options.from.includes(project.status)) {
                throw new ConflictException({
                    code: 'PROJECT_STATUS_TRANSITION_INVALID',
                    message: `项目不能从 ${project.status} 变更为 ${options.to}`,
                });
            }
            if (options.requireFinishedTasks) {
                const unfinishedTaskCount = await transaction.task.count({
                    where: {
                        tenantId: context.tenantId,
                        projectId,
                        deletedAt: null,
                        status: { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED] },
                    },
                });
                if (unfinishedTaskCount > 0) {
                    throw new ConflictException({
                        code: 'PROJECT_HAS_UNFINISHED_TASKS',
                        message: '项目仍有未完成任务，不能标记为已完成',
                        details: { unfinishedTaskCount },
                    });
                }
            }
            const data: Prisma.ProjectUncheckedUpdateManyInput = {
                status: options.to,
                updatedBy: context.userId,
                version: { increment: 1 },
            };
            if (options.to === ProjectStatus.ACTIVE && project.status === ProjectStatus.PLANNING && !project.startedAt) {
                data.startedAt = new Date();
            }
            if (options.to === ProjectStatus.COMPLETED && project.status !== ProjectStatus.ARCHIVED) {
                data.completedAt = new Date();
                data.completedByMembershipId = context.membershipId;
                data.completionSummary = options.completionSummary ?? null;
            }
            if (options.to === ProjectStatus.CANCELLED || options.to === ProjectStatus.ARCHIVED) {
                data.closedAt = new Date();
            }
            if (project.status === ProjectStatus.COMPLETED && options.to === ProjectStatus.ACTIVE) {
                data.completedAt = null;
                data.completedByMembershipId = null;
                data.completionSummary = null;
                data.closedAt = null;
            }
            if (project.status === ProjectStatus.ARCHIVED && options.to === ProjectStatus.COMPLETED) {
                data.closedAt = null;
            }
            const updated = await transaction.project.updateMany({
                where: {
                    id: projectId,
                    tenantId: context.tenantId,
                    version,
                    status: project.status,
                    deletedAt: null,
                },
                data,
            });
            if (updated.count !== 1) throw this.versionConflict();
            await transaction.projectStatusHistory.create({
                data: {
                    tenantId: context.tenantId,
                    projectId,
                    fromStatus: project.status,
                    toStatus: options.to,
                    reason: options.reason ?? options.completionSummary ?? null,
                    changedByMembershipId: context.membershipId,
                },
            });
            await transaction.projectActivity.create({
                data: {
                    tenantId: context.tenantId,
                    projectId,
                    actorMembershipId: context.membershipId,
                    type: 'PROJECT_STATUS_CHANGED',
                    resourceType: 'PROJECT',
                    resourceId: projectId,
                    summary: `项目状态由 ${project.status} 变更为 ${options.to}`,
                    metadata: { fromStatus: project.status, toStatus: options.to, reason: options.reason ?? options.completionSummary ?? null },
                },
            });
            await transaction.auditLog.create({
                data: auditData(context, options.action, projectId, {
                    fromStatus: project.status,
                    toStatus: options.to,
                    reason: options.reason ?? null,
                }),
            });
        });
        return this.getProject(projectId);
    }

    private async requireProject(
        context: RequestTenantContext,
        projectId: string,
        db: ProjectDb = this.prisma,
    ): Promise<ProjectRecord> {
        const project = await db.project.findFirst({
            where: { id: projectId, tenantId: context.tenantId, deletedAt: null },
            select: projectSelect,
        });
        const isMember = project?.members.some((member) => member.membershipId === context.membershipId) ?? false;
        if (!project || (!this.canManageAll(context) && !isMember)) throw this.projectNotFound();
        return project;
    }

    private assertManager(context: RequestTenantContext, project: ProjectRecord): void {
        if (this.canManageAll(context)) return;
        const role = project.members.find((member) => member.membershipId === context.membershipId)?.role;
        if (role !== ProjectMemberRole.OWNER && role !== ProjectMemberRole.MANAGER) {
            throw new ForbiddenException({ code: 'PROJECT_ROLE_DENIED', message: '需要项目负责人或项目经理角色' });
        }
    }

    private assertOwner(context: RequestTenantContext, project: ProjectRecord): void {
        if (this.canManageAll(context) || project.ownerMembershipId === context.membershipId) return;
        throw new ForbiddenException({ code: 'PROJECT_OWNER_REQUIRED', message: '该操作仅允许项目负责人执行' });
    }

    private assertEditable(project: ProjectRecord): void {
        if (READ_ONLY_STATUSES.has(project.status)) {
            throw new ConflictException({ code: 'PROJECT_READ_ONLY', message: '项目当前状态不允许修改项目资料或成员' });
        }
    }

    private requireMember(project: ProjectRecord, membershipId: string): ProjectMemberRecord {
        const member = project.members.find((item) => item.membershipId === membershipId);
        if (!member) {
            throw new ConflictException({ code: 'PROJECT_MEMBER_REQUIRED', message: '目标租户成员尚未加入该项目' });
        }
        return member;
    }

    private async requireActiveMembership(
        tenantId: string,
        membershipId: string,
        db: ProjectDb = this.prisma,
    ): Promise<void> {
        const membership = await db.tenantMembership.findFirst({
            where: { id: membershipId, tenantId, status: MembershipStatus.ACTIVE, deletedAt: null },
            select: { id: true },
        });
        if (!membership) {
            throw new BadRequestException({ code: 'PROJECT_MEMBERSHIP_INVALID', message: '目标成员不是当前租户的有效成员' });
        }
    }

    private async requireDepartment(
        tenantId: string,
        departmentId: string | null | undefined,
        db: ProjectDb = this.prisma,
    ): Promise<void> {
        if (departmentId === undefined || departmentId === null) return;
        const department = await db.department.findFirst({
            where: { id: departmentId, tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!department) {
            throw new BadRequestException({ code: 'PROJECT_DEPARTMENT_INVALID', message: '项目归属部门不属于当前租户' });
        }
    }

    private async requireProjectMember(
        tenantId: string,
        projectId: string,
        membershipId: string,
        db: ProjectDb = this.prisma,
    ): Promise<ProjectMemberResult> {
        const member = await db.projectMember.findFirst({
            where: { tenantId, projectId, membershipId, deletedAt: null },
            select: memberSelect,
        });
        if (!member) throw this.projectNotFound();
        return toProjectMemberResult(member);
    }

    private async requireProjectMemberById(
        tenantId: string,
        projectMemberId: string,
        db: ProjectDb = this.prisma,
    ): Promise<ProjectMemberResult> {
        const member = await db.projectMember.findFirst({
            where: { id: projectMemberId, tenantId, deletedAt: null },
            select: memberSelect,
        });
        if (!member) throw this.projectNotFound();
        return toProjectMemberResult(member);
    }

    private async getTaskCounts(tenantId: string, projectIds: string[]): Promise<Map<string, number>> {
        if (projectIds.length === 0) return new Map();
        const counts = await this.prisma.task.groupBy({
            by: ['projectId'],
            where: { tenantId, projectId: { in: projectIds }, deletedAt: null },
            _count: { _all: true },
        });
        return new Map(counts.flatMap((item) => item.projectId ? [[item.projectId, item._count._all]] : []));
    }

    private canManageAll(context: RequestTenantContext): boolean {
        return context.permissions.includes('project.manage_all');
    }

    /**
     * 按“租户 + 租户时区年份”分配下一个项目编码 `PRJ-<年>-<序号>`。
     *
     * 取号与项目写入在同一事务内完成，`ON CONFLICT DO UPDATE` 持有流水号行锁，
     * 并发创建不会重号；序号只增不减，软删除的项目不回收编号。
     */
    private async allocateProjectCode(tenantId: string, transaction: Prisma.TransactionClient): Promise<string> {
        const tenant = await transaction.tenant.findFirst({
            where: { id: tenantId, deletedAt: null },
            select: { timezone: true },
        });
        const year = calendarYear(tenant?.timezone || DEFAULT_TENANT_TIMEZONE, new Date());
        const rows = await transaction.$queryRaw<Array<{ last_number: number | bigint }>>(Prisma.sql`
            INSERT INTO "project_code_sequences" ("id", "tenant_id", "year", "last_number", "created_at", "updated_at")
            VALUES (CAST(${randomUUID()} AS uuid), CAST(${tenantId} AS uuid), ${year}, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT ("tenant_id", "year")
            DO UPDATE SET
                "last_number" = "project_code_sequences"."last_number" + 1,
                "updated_at" = CURRENT_TIMESTAMP
            RETURNING "last_number"
        `);
        const lastNumber = Number(rows[0]?.last_number ?? 0);
        if (lastNumber < 1) throw new Error('项目编码取号失败');
        return `PRJ-${year}-${lastNumber}`;
    }

    private projectNotFound(): NotFoundException {
        return new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: '项目不存在或当前成员无权访问' });
    }

    private codeConflict(): ConflictException {
        return new ConflictException({ code: 'PROJECT_CODE_CONFLICT', message: '当前租户内项目编码已存在' });
    }

    private versionConflict(): ConflictException {
        return new ConflictException({ code: 'PROJECT_VERSION_CONFLICT', message: '数据已被其他操作修改，请刷新后重试' });
    }

    private ownerMutationConflict(): ConflictException {
        return new ConflictException({ code: 'PROJECT_OWNER_MUTATION_DENIED', message: '负责人只能通过负责人转移接口变更' });
    }
}

function toProjectResult(project: ProjectRecord, currentMembershipId: string, taskCount: number): ProjectResult {
    const ownerMember = project.members.find((member) => member.membershipId === project.ownerMembershipId);
    const owner = ownerMember
        ? toProjectMemberResult(ownerMember)
        : project.ownerMembership
            ? {
                id: project.ownerMembership.id,
                membershipId: project.ownerMembership.id,
                account: project.ownerMembership.account,
                displayName: project.ownerMembership.displayName ?? project.ownerMembership.user.displayName,
                departmentId: project.ownerMembership.departmentId,
                role: ProjectMemberRole.OWNER,
                joinedAt: project.createdAt,
                version: 1,
            }
            : null;
    return {
        id: project.id,
        code: project.code,
        name: project.name,
        description: project.description,
        status: project.status,
        departmentId: project.departmentId,
        owner,
        currentMemberRole: project.members.find((member) => member.membershipId === currentMembershipId)?.role ?? null,
        startedAt: project.startedAt,
        completedAt: project.completedAt,
        closedAt: project.closedAt,
        completedByMembershipId: project.completedByMembershipId,
        completionSummary: project.completionSummary,
        memberCount: project._count.members,
        taskCount,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        version: project.version,
    };
}

function toProjectMemberResult(member: ProjectMemberRecord): ProjectMemberResult {
    return {
        id: member.id,
        membershipId: member.membershipId,
        account: member.membership.account,
        displayName: member.membership.displayName ?? member.membership.user.displayName,
        departmentId: member.membership.departmentId,
        role: member.role,
        joinedAt: member.joinedAt,
        version: member.version,
    };
}

function hasProjectChanges(input: UpdateProjectDto): boolean {
    return input.name !== undefined
        || input.description !== undefined
        || input.departmentId !== undefined;
}

function assertEditableMemberRole(role: ProjectMemberRole): void {
    if (role === ProjectMemberRole.OWNER) {
        throw new BadRequestException({
            code: 'PROJECT_OWNER_MUTATION_DENIED',
            message: '负责人只能通过负责人转移接口变更',
        });
    }
}

function normalizeRequiredText(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}

function normalizeOptionalText(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}

function auditData(
    context: RequestTenantContext,
    action: string,
    resourceId: string,
    metadata: Prisma.InputJsonObject,
): Prisma.AuditLogUncheckedCreateInput {
    return {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        action,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'PROJECT',
        resourceId,
        requestId: context.requestId,
        metadata,
    };
}

function projectSnapshot(project: ProjectRecord): Prisma.InputJsonObject {
    return {
        code: project.code,
        name: project.name,
        description: project.description,
        departmentId: project.departmentId,
        ownerMembershipId: project.ownerMembershipId,
        status: project.status,
        startedAt: project.startedAt?.toISOString() ?? null,
        completedAt: project.completedAt?.toISOString() ?? null,
        closedAt: project.closedAt?.toISOString() ?? null,
        version: project.version,
    };
}

function isPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
