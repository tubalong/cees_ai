import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
    AuditOutcome,
    MembershipStatus,
    Prisma,
    ProjectMemberRole,
    ProjectStatus,
    TaskStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RequestTenantContext, TenantContext } from '../tenant/tenant-context';
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
    startsAt: true,
    endsAt: true,
    completedAt: true,
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
        await Promise.all([
            this.requireActiveMembership(context.tenantId, ownerMembershipId),
            this.requireDepartment(context.tenantId, input.departmentId),
        ]);
        const dates = normalizeAndValidateDates(input.startsAt, input.endsAt);
        const code = normalizeCode(input.code);
        let projectId: string;
        try {
            projectId = await this.prisma.$transaction(async (transaction) => {
                const project = await transaction.project.create({
                    data: {
                        tenantId: context.tenantId,
                        code,
                        normalizedCode: code.toLocaleLowerCase(),
                        departmentId: input.departmentId ?? null,
                        ownerMembershipId,
                        name: normalizeRequiredText(input.name),
                        description: normalizeOptionalText(input.description),
                        startsAt: dates.startsAt,
                        endsAt: dates.endsAt,
                        createdBy: context.userId,
                        updatedBy: context.userId,
                    },
                    select: { id: true },
                });
                await transaction.projectMember.create({
                    data: {
                        tenantId: context.tenantId,
                        projectId: project.id,
                        membershipId: ownerMembershipId,
                        role: ProjectMemberRole.OWNER,
                        createdBy: context.userId,
                        updatedBy: context.userId,
                    },
                });
                await transaction.auditLog.create({
                    data: auditData(context, 'PROJECT_CREATED', project.id, {
                        code,
                        name: normalizeRequiredText(input.name),
                        ownerMembershipId,
                        departmentId: input.departmentId ?? null,
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
        const project = await this.requireProject(context, projectId);
        this.assertManager(context, project);
        this.assertEditable(project);
        if (!hasProjectChanges(input)) {
            throw new BadRequestException({ code: 'PROJECT_UPDATE_EMPTY', message: '至少提供一个需要修改的字段' });
        }
        await this.requireDepartment(context.tenantId, input.departmentId);
        const dates = normalizeAndValidateDates(
            input.startsAt === undefined ? project.startsAt : input.startsAt,
            input.endsAt === undefined ? project.endsAt : input.endsAt,
        );
        const data: Prisma.ProjectUncheckedUpdateManyInput = {
            version: { increment: 1 },
            updatedBy: context.userId,
        };
        if (input.code !== undefined) {
            const code = normalizeCode(input.code);
            data.code = code;
            data.normalizedCode = code.toLocaleLowerCase();
        }
        if (input.name !== undefined) data.name = normalizeRequiredText(input.name);
        if (input.description !== undefined) data.description = normalizeOptionalText(input.description);
        if (input.departmentId !== undefined) data.departmentId = input.departmentId;
        if (input.startsAt !== undefined) data.startsAt = dates.startsAt;
        if (input.endsAt !== undefined) data.endsAt = dates.endsAt;

        try {
            await this.prisma.$transaction(async (transaction) => {
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
        } catch (error) {
            if (isPrismaError(error, 'P2002')) throw this.codeConflict();
            throw error;
        }
        return this.getProject(projectId);
    }

    async deleteProject(projectId: string, version: number): Promise<void> {
        const context = this.tenantContext.require();
        const project = await this.requireProject(context, projectId);
        this.assertOwner(context, project);
        const taskCount = await this.prisma.task.count({ where: { tenantId: context.tenantId, projectId } });
        if (taskCount > 0) {
            throw new ConflictException({ code: 'PROJECT_HAS_BUSINESS_DATA', message: '项目已有任务，不能删除，请完成或归档项目' });
        }
        const deletedAt = new Date();
        await this.prisma.$transaction(async (transaction) => {
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
        const project = await this.requireProject(context, projectId);
        this.assertManager(context, project);
        this.assertEditable(project);
        await this.requireActiveMembership(context.tenantId, input.membershipId);
        const existing = await this.prisma.projectMember.findFirst({
            where: { tenantId: context.tenantId, projectId, membershipId: input.membershipId },
            select: { id: true, deletedAt: true },
        });
        if (existing && !existing.deletedAt) {
            throw new ConflictException({ code: 'PROJECT_MEMBER_EXISTS', message: '该租户成员已经在项目中' });
        }
        let projectMemberId: string;
        try {
            projectMemberId = await this.prisma.$transaction(async (transaction) => {
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
        const project = await this.requireProject(context, projectId);
        this.assertManager(context, project);
        this.assertEditable(project);
        const member = this.requireMember(project, membershipId);
        if (member.role === ProjectMemberRole.OWNER) throw this.ownerMutationConflict();
        await this.prisma.$transaction(async (transaction) => {
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
        const project = await this.requireProject(context, projectId);
        this.assertManager(context, project);
        this.assertEditable(project);
        const member = this.requireMember(project, membershipId);
        if (member.role === ProjectMemberRole.OWNER) throw this.ownerMutationConflict();
        await this.prisma.$transaction(async (transaction) => {
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
        const project = await this.requireProject(context, projectId);
        this.assertOwner(context, project);
        this.assertEditable(project);
        if (project.ownerMembershipId === input.membershipId) {
            throw new ConflictException({ code: 'PROJECT_OWNER_UNCHANGED', message: '目标成员已经是项目负责人' });
        }
        await this.requireActiveMembership(context.tenantId, input.membershipId);
        const target = this.requireMember(project, input.membershipId);
        await this.prisma.$transaction(async (transaction) => {
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
        const project = await this.requireProject(context, projectId);
        if (options.ownerOnly) this.assertOwner(context, project);
        else this.assertManager(context, project);
        if (!options.from.includes(project.status)) {
            throw new ConflictException({
                code: 'PROJECT_STATUS_TRANSITION_INVALID',
                message: `项目不能从 ${project.status} 变更为 ${options.to}`,
            });
        }
        await this.prisma.$transaction(async (transaction) => {
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
            if (options.to === ProjectStatus.ACTIVE && project.status === ProjectStatus.PLANNING && !project.startsAt) {
                data.startsAt = new Date();
            }
            if (options.to === ProjectStatus.COMPLETED && project.status !== ProjectStatus.ARCHIVED) {
                data.completedAt = new Date();
                data.completedByMembershipId = context.membershipId;
                data.completionSummary = options.completionSummary ?? null;
            }
            if (project.status === ProjectStatus.COMPLETED && options.to === ProjectStatus.ACTIVE) {
                data.completedAt = null;
                data.completedByMembershipId = null;
                data.completionSummary = null;
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

    private async requireProject(context: RequestTenantContext, projectId: string): Promise<ProjectRecord> {
        const project = await this.prisma.project.findFirst({
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

    private async requireActiveMembership(tenantId: string, membershipId: string): Promise<void> {
        const membership = await this.prisma.tenantMembership.findFirst({
            where: { id: membershipId, tenantId, status: MembershipStatus.ACTIVE, deletedAt: null },
            select: { id: true },
        });
        if (!membership) {
            throw new BadRequestException({ code: 'PROJECT_MEMBERSHIP_INVALID', message: '目标成员不是当前租户的有效成员' });
        }
    }

    private async requireDepartment(tenantId: string, departmentId: string | null | undefined): Promise<void> {
        if (departmentId === undefined || departmentId === null) return;
        const department = await this.prisma.department.findFirst({
            where: { id: departmentId, tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!department) {
            throw new BadRequestException({ code: 'PROJECT_DEPARTMENT_INVALID', message: '项目归属部门不属于当前租户' });
        }
    }

    private async requireProjectMember(tenantId: string, projectId: string, membershipId: string): Promise<ProjectMemberResult> {
        const member = await this.prisma.projectMember.findFirst({
            where: { tenantId, projectId, membershipId, deletedAt: null },
            select: memberSelect,
        });
        if (!member) throw this.projectNotFound();
        return toProjectMemberResult(member);
    }

    private async requireProjectMemberById(tenantId: string, projectMemberId: string): Promise<ProjectMemberResult> {
        const member = await this.prisma.projectMember.findFirst({
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
        startsAt: project.startsAt,
        endsAt: project.endsAt,
        completedAt: project.completedAt,
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
    return input.code !== undefined
        || input.name !== undefined
        || input.description !== undefined
        || input.departmentId !== undefined
        || input.startsAt !== undefined
        || input.endsAt !== undefined;
}

function assertEditableMemberRole(role: ProjectMemberRole): void {
    if (role === ProjectMemberRole.OWNER) {
        throw new BadRequestException({
            code: 'PROJECT_OWNER_MUTATION_DENIED',
            message: '负责人只能通过负责人转移接口变更',
        });
    }
}

function normalizeAndValidateDates(
    startsAt: string | Date | null | undefined,
    endsAt: string | Date | null | undefined,
): { startsAt: Date | null; endsAt: Date | null } {
    const normalizedStartsAt = toNullableDate(startsAt);
    const normalizedEndsAt = toNullableDate(endsAt);
    if (normalizedStartsAt && normalizedEndsAt && normalizedEndsAt < normalizedStartsAt) {
        throw new BadRequestException({ code: 'PROJECT_DATE_RANGE_INVALID', message: '项目结束时间不能早于开始时间' });
    }
    return { startsAt: normalizedStartsAt, endsAt: normalizedEndsAt };
}

function toNullableDate(value: string | Date | null | undefined): Date | null {
    if (value === undefined || value === null) return null;
    return value instanceof Date ? value : new Date(value);
}

function normalizeCode(code: string): string {
    return code.trim();
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
        startsAt: project.startsAt?.toISOString() ?? null,
        endsAt: project.endsAt?.toISOString() ?? null,
        version: project.version,
    };
}

function isPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
