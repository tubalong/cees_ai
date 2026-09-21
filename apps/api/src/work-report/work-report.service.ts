import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditOutcome, MembershipStatus, Prisma, WorkReportStatus, WorkReportType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RequestTenantContext, TenantContext } from '../tenant/tenant-context';
import { CreateDailyWorkReportDto, CreateWeeklyWorkReportDto, ListWorkReportsQueryDto, ReviewWorkReportDto, UpdateWorkReportDto, WorkReportStatisticsQueryDto, WorkReportContentDto } from './dto';
import { lockWorkReportForUpdate } from './work-report-transaction-lock';
import { WorkReportContentResult, WorkReportListResult, WorkReportResult, WorkReportStatisticsResult } from './work-report.types';

const memberIdentitySelect = {
    id: true, account: true, displayName: true, departmentId: true,
    user: { select: { displayName: true } },
} satisfies Prisma.TenantMembershipSelect;

const workReportSelect = {
    id: true, type: true, periodStart: true, periodEnd: true, content: true, status: true,
    reviewerMembershipId: true, submittedAt: true, reviewedAt: true, reviewComment: true,
    createdAt: true, updatedAt: true, version: true,
    authorMembership: { select: memberIdentitySelect },
    reviewerMembership: { select: memberIdentitySelect },
    projects: { select: { projectId: true }, orderBy: { projectId: 'asc' as const } },
    tasks: { select: { taskId: true }, orderBy: { taskId: 'asc' as const } },
} satisfies Prisma.WorkReportSelect;

type WorkReportRecord = Prisma.WorkReportGetPayload<{ select: typeof workReportSelect }>;
type WorkReportDb = PrismaService | Prisma.TransactionClient;

@Injectable()
export class WorkReportService {
    constructor(private readonly prisma: PrismaService, private readonly tenantContext: TenantContext) { }

    async list(query: ListWorkReportsQueryDto): Promise<WorkReportListResult> {
        const context = this.tenantContext.require();
        const where = this.visibleWhere(context, {
            type: query.type,
            status: query.status,
            authorMembershipId: query.authorMembershipId,
            reviewerMembershipId: query.reviewerMembershipId,
            ...(query.projectId ? { projects: { some: { projectId: query.projectId } } } : {}),
            periodStart: this.periodRange(query.periodFrom, query.periodTo),
        });
        if (query.cursor) {
            const cursor = await this.prisma.workReport.findFirst({ where: { ...where, id: query.cursor }, select: { id: true } });
            if (!cursor) throw new BadRequestException({ code: 'PAGINATION_CURSOR_INVALID', message: '分页游标无效' });
        }
        const records = await this.prisma.workReport.findMany({
            where,
            orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
            select: workReportSelect,
        });
        const hasNextPage = records.length > query.limit;
        const page = hasNextPage ? records.slice(0, query.limit) : records;
        return { items: page.map(toWorkReportResult), nextCursor: hasNextPage ? page.at(-1)?.id ?? null : null };
    }

    async get(id: string): Promise<WorkReportResult> {
        const context = this.tenantContext.require();
        const record = await this.prisma.workReport.findFirst({ where: this.visibleWhere(context, { id }), select: workReportSelect });
        if (!record) throw this.notFound();
        return toWorkReportResult(record);
    }

    async createDaily(input: CreateDailyWorkReportDto): Promise<WorkReportResult> {
        return this.create(WorkReportType.DAILY, input.reportDate, input);
    }

    async createWeekly(input: CreateWeeklyWorkReportDto): Promise<WorkReportResult> {
        return this.create(WorkReportType.WEEKLY, input.weekStartDate, input);
    }

    private async create(type: WorkReportType, startValue: string, input: { reviewerMembershipId: string; content: WorkReportContentDto; projectIds: string[]; taskIds: string[] }): Promise<WorkReportResult> {
        const context = this.tenantContext.require();
        const periodStart = parseDate(startValue);
        const periodEnd = type === WorkReportType.DAILY ? periodStart : addDays(periodStart, 6);
        if (type === WorkReportType.WEEKLY && periodStart.getUTCDay() !== 1) {
            throw new BadRequestException({ code: 'WORK_REPORT_WEEK_START_INVALID', message: '周报开始日期必须是周一' });
        }
        const content = normalizeContent(input.content);
        try {
            return await this.prisma.$transaction(async (transaction) => {
                await this.requireReviewer(context, input.reviewerMembershipId, transaction);
                await this.validateLinks(context, input.projectIds, input.taskIds, transaction);
                const report = await transaction.workReport.create({
                    data: {
                        tenantId: context.tenantId,
                        authorMembershipId: context.membershipId,
                        reviewerMembershipId: input.reviewerMembershipId,
                        type, periodStart, periodEnd, content: content as unknown as Prisma.InputJsonValue,
                        createdBy: context.userId, updatedBy: context.userId,
                        projects: { create: input.projectIds.map((projectId) => ({ tenantId: context.tenantId, projectId, createdBy: context.userId })) },
                        tasks: { create: input.taskIds.map((taskId) => ({ tenantId: context.tenantId, taskId, createdBy: context.userId })) },
                    }, select: { id: true },
                });
                await transaction.auditLog.create({ data: auditData(context, 'WORK_REPORT_CREATED', report.id, { type, periodStart: startValue }) });
                return toWorkReportResult(await transaction.workReport.findUniqueOrThrow({ where: { id: report.id }, select: workReportSelect }));
            });
        } catch (error) {
            if (isPrismaError(error, 'P2002')) throw new ConflictException({ code: 'WORK_REPORT_PERIOD_EXISTS', message: '当前周期已存在有效报告' });
            throw error;
        }
    }

    async update(id: string, input: UpdateWorkReportDto): Promise<WorkReportResult> {
        const context = this.tenantContext.require();
        return this.prisma.$transaction(async (transaction) => {
            await lockWorkReportForUpdate(transaction, context.tenantId, id);
            const report = await this.requireAuthorReport(context, id, transaction);
            this.requireEditable(report.status);
            this.requireVersion(report.version, input.version);
            await this.requireReviewer(context, input.reviewerMembershipId, transaction);
            await this.validateLinks(context, input.projectIds, input.taskIds, transaction);
            await transaction.workReport.updateMany({
                where: { id, tenantId: context.tenantId, deletedAt: null, version: input.version },
                data: { reviewerMembershipId: input.reviewerMembershipId, content: normalizeContent(input.content) as unknown as Prisma.InputJsonValue, updatedBy: context.userId, version: { increment: 1 } },
            }).then((result) => { if (result.count !== 1) throw this.versionConflict(); });
            await transaction.workReportProject.deleteMany({ where: { tenantId: context.tenantId, workReportId: id } });
            await transaction.workReportTask.deleteMany({ where: { tenantId: context.tenantId, workReportId: id } });
            if (input.projectIds.length) await transaction.workReportProject.createMany({ data: input.projectIds.map((projectId) => ({ tenantId: context.tenantId, workReportId: id, projectId, createdBy: context.userId })) });
            if (input.taskIds.length) await transaction.workReportTask.createMany({ data: input.taskIds.map((taskId) => ({ tenantId: context.tenantId, workReportId: id, taskId, createdBy: context.userId })) });
            await transaction.auditLog.create({ data: auditData(context, 'WORK_REPORT_UPDATED', id, { version: input.version }) });
            return toWorkReportResult(await transaction.workReport.findUniqueOrThrow({ where: { id }, select: workReportSelect }));
        });
    }

    async delete(id: string, version: number): Promise<void> {
        const context = this.tenantContext.require();
        await this.prisma.$transaction(async (transaction) => {
            await lockWorkReportForUpdate(transaction, context.tenantId, id);
            const report = await this.requireAuthorReport(context, id, transaction);
            this.requireEditable(report.status);
            this.requireVersion(report.version, version);
            const result = await transaction.workReport.updateMany({ where: { id, tenantId: context.tenantId, deletedAt: null, version }, data: { deletedAt: new Date(), updatedBy: context.userId, version: { increment: 1 } } });
            if (result.count !== 1) throw this.versionConflict();
            await transaction.auditLog.create({ data: auditData(context, 'WORK_REPORT_DELETED', id, { version }) });
        });
    }

    async submit(id: string, version: number): Promise<WorkReportResult> {
        const context = this.tenantContext.require();
        return this.transition(id, version, 'submit', context);
    }

    async withdraw(id: string, version: number): Promise<WorkReportResult> {
        const context = this.tenantContext.require();
        return this.transition(id, version, 'withdraw', context);
    }

    private async transition(id: string, version: number, action: 'submit' | 'withdraw', context: RequestTenantContext): Promise<WorkReportResult> {
        return this.prisma.$transaction(async (transaction) => {
            await lockWorkReportForUpdate(transaction, context.tenantId, id);
            const report = await this.requireAuthorReport(context, id, transaction);
            this.requireVersion(report.version, version);
            const target = action === 'submit' ? WorkReportStatus.SUBMITTED : WorkReportStatus.DRAFT;
            const allowed: WorkReportStatus[] = action === 'submit' ? [WorkReportStatus.DRAFT, WorkReportStatus.REJECTED] : [WorkReportStatus.SUBMITTED];
            if (!allowed.includes(report.status)) throw new ConflictException({ code: 'WORK_REPORT_STATUS_CONFLICT', message: action === 'submit' ? '只有草稿或已驳回报告可提交' : '只有已提交的报告可撤回' });
            if (action === 'submit') await this.requireReviewer(context, report.reviewerMembershipId, transaction);
            const result = await transaction.workReport.updateMany({ where: { id, tenantId: context.tenantId, deletedAt: null, version }, data: { status: target, submittedAt: action === 'submit' ? new Date() : null, reviewedAt: action === 'submit' ? null : report.reviewedAt, reviewComment: action === 'submit' ? null : report.reviewComment, updatedBy: context.userId, version: { increment: 1 } } });
            if (result.count !== 1) throw this.versionConflict();
            await transaction.auditLog.create({ data: auditData(context, action === 'submit' ? 'WORK_REPORT_SUBMITTED' : 'WORK_REPORT_WITHDRAWN', id, { version }) });
            if (report.projects.length > 0) {
                await transaction.projectActivity.createMany({
                    data: report.projects.map(({ projectId }) => ({
                        tenantId: context.tenantId,
                        projectId,
                        actorMembershipId: context.membershipId,
                        type: action === 'submit' ? 'WORK_REPORT_SUBMITTED' : 'WORK_REPORT_WITHDRAWN',
                        resourceType: 'WORK_REPORT',
                        resourceId: id,
                        summary: action === 'submit' ? `${report.type === WorkReportType.DAILY ? '日报' : '周报'}已提交` : `${report.type === WorkReportType.DAILY ? '日报' : '周报'}已撤回`,
                        metadata: { authorMembershipId: context.membershipId, periodStart: report.periodStart.toISOString().slice(0, 10) },
                    })),
                });
            }
            return toWorkReportResult(await transaction.workReport.findUniqueOrThrow({ where: { id }, select: workReportSelect }));
        });
    }

    async review(id: string, input: ReviewWorkReportDto): Promise<WorkReportResult> {
        const context = this.tenantContext.require();
        if (input.decision !== 'APPROVED' && input.decision !== 'REJECTED') throw new BadRequestException({ code: 'WORK_REPORT_REVIEW_DECISION_INVALID', message: '审核决定无效' });
        if (input.decision === 'REJECTED' && !input.comment?.trim()) throw new BadRequestException({ code: 'WORK_REPORT_REVIEW_COMMENT_REQUIRED', message: '驳回时必须填写审核意见' });
        return this.prisma.$transaction(async (transaction) => {
            await lockWorkReportForUpdate(transaction, context.tenantId, id);
            const report = await this.requireVisibleReport(context, id, transaction);
            if (report.status !== WorkReportStatus.SUBMITTED) throw new ConflictException({ code: 'WORK_REPORT_STATUS_CONFLICT', message: '只有已提交的报告才可审核' });
            if (report.reviewerMembershipId !== context.membershipId && !this.hasPermission(context, 'work_report.manage_all')) throw new ForbiddenException({ code: 'WORK_REPORT_REVIEW_FORBIDDEN', message: '只有指定审核人或租户管理员可审核该报告' });
            this.requireVersion(report.version, input.version);
            const status = input.decision === 'APPROVED' ? WorkReportStatus.APPROVED : WorkReportStatus.REJECTED;
            const result = await transaction.workReport.updateMany({ where: { id, tenantId: context.tenantId, deletedAt: null, version: input.version }, data: { status, reviewedAt: new Date(), reviewComment: input.comment?.trim() || null, updatedBy: context.userId, version: { increment: 1 } } });
            if (result.count !== 1) throw this.versionConflict();
            await transaction.auditLog.create({ data: auditData(context, input.decision === 'APPROVED' ? 'WORK_REPORT_APPROVED' : 'WORK_REPORT_REJECTED', id, { version: input.version }) });
            return toWorkReportResult(await transaction.workReport.findUniqueOrThrow({ where: { id }, select: workReportSelect }));
        });
    }

    async statistics(query: WorkReportStatisticsQueryDto): Promise<WorkReportStatisticsResult> {
        const context = this.tenantContext.require();
        const records = await this.prisma.workReport.findMany({ where: this.visibleWhere(context, { type: query.type, periodStart: this.periodRange(query.periodFrom, query.periodTo) }), select: { status: true } });
        return records.reduce<WorkReportStatisticsResult>((result, record) => {
            result.total += 1;
            if (record.status === WorkReportStatus.DRAFT) result.draft += 1;
            if (record.status === WorkReportStatus.SUBMITTED) result.submitted += 1;
            if (record.status === WorkReportStatus.APPROVED) result.approved += 1;
            if (record.status === WorkReportStatus.REJECTED) result.rejected += 1;
            return result;
        }, { total: 0, draft: 0, submitted: 0, approved: 0, rejected: 0 });
    }

    private visibleWhere(context: RequestTenantContext, additional: Prisma.WorkReportWhereInput = {}): Prisma.WorkReportWhereInput {
        const scope = this.hasPermission(context, 'work_report.manage_all') ? {} : { OR: [{ authorMembershipId: context.membershipId }, { reviewerMembershipId: context.membershipId, status: { not: WorkReportStatus.DRAFT } }] };
        return { tenantId: context.tenantId, deletedAt: null, AND: [scope, additional] };
    }

    private async requireVisibleReport(context: RequestTenantContext, id: string, db: WorkReportDb): Promise<WorkReportRecord> {
        const report = await db.workReport.findFirst({ where: this.visibleWhere(context, { id }), select: workReportSelect });
        if (!report) throw this.notFound();
        return report;
    }

    private async requireAuthorReport(context: RequestTenantContext, id: string, db: WorkReportDb): Promise<WorkReportRecord> {
        const report = await db.workReport.findFirst({ where: { tenantId: context.tenantId, id, authorMembershipId: context.membershipId, deletedAt: null }, select: workReportSelect });
        if (!report) throw this.notFound();
        return report;
    }

    private async requireReviewer(context: RequestTenantContext, membershipId: string | null, db: WorkReportDb): Promise<void> {
        if (!membershipId || membershipId === context.membershipId) throw new BadRequestException({ code: 'WORK_REPORT_REVIEWER_INVALID', message: '审核人必须是当前租户中除作者外的有效成员' });
        const member = await db.tenantMembership.findFirst({ where: { id: membershipId, tenantId: context.tenantId, status: MembershipStatus.ACTIVE }, select: { id: true } });
        if (!member) throw new BadRequestException({ code: 'WORK_REPORT_REVIEWER_INVALID', message: '审核人不是当前租户的有效成员' });
    }

    private async validateLinks(context: RequestTenantContext, projectIds: string[], taskIds: string[], db: WorkReportDb): Promise<void> {
        const projects = await db.project.findMany({ where: { tenantId: context.tenantId, id: { in: projectIds }, deletedAt: null }, select: { id: true, members: { where: { membershipId: context.membershipId, deletedAt: null }, select: { id: true } } } });
        if (projects.length !== projectIds.length) throw new BadRequestException({ code: 'WORK_REPORT_PROJECT_INVALID', message: '一个或多个关联项目不存在' });
        if (projects.some((project) => project.members.length === 0)) throw new ForbiddenException({ code: 'WORK_REPORT_PROJECT_FORBIDDEN', message: '报告只能关联作者参与的项目' });
        const tasks = await db.task.findMany({ where: { tenantId: context.tenantId, id: { in: taskIds }, deletedAt: null }, select: { id: true, projectId: true } });
        if (tasks.length !== taskIds.length) throw new BadRequestException({ code: 'WORK_REPORT_TASK_INVALID', message: '一个或多个关联任务不存在' });
        const projectSet = new Set(projectIds);
        if (tasks.some((task) => !task.projectId || !projectSet.has(task.projectId))) throw new BadRequestException({ code: 'WORK_REPORT_TASK_PROJECT_MISMATCH', message: '每个关联任务必须属于关联项目' });
    }

    private periodRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
        if (!from && !to) return undefined;
        const gte = from ? parseDate(from) : undefined;
        const lte = to ? parseDate(to) : undefined;
        if (gte && lte && gte > lte) throw new BadRequestException({ code: 'WORK_REPORT_DATE_RANGE_INVALID', message: '报告日期范围无效' });
        return { gte, lte };
    }

    private requireEditable(status: WorkReportStatus): void {
        if (status !== WorkReportStatus.DRAFT && status !== WorkReportStatus.REJECTED) throw new ConflictException({ code: 'WORK_REPORT_NOT_EDITABLE', message: '只有草稿或已驳回报告可修改或删除' });
    }
    private requireVersion(actual: number, expected: number): void { if (actual !== expected) throw this.versionConflict(); }
    private versionConflict(): ConflictException { return new ConflictException({ code: 'WORK_REPORT_VERSION_CONFLICT', message: '报告已被其他请求修改' }); }
    private notFound(): NotFoundException { return new NotFoundException({ code: 'WORK_REPORT_NOT_FOUND', message: '报告不存在或当前成员不可见' }); }
    private hasPermission(context: RequestTenantContext, permission: string): boolean { return context.permissions.includes(permission); }
}

function parseDate(value: string): Date {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime())) throw new BadRequestException({ code: 'WORK_REPORT_DATE_INVALID', message: '报告日期必须使用 YYYY-MM-DD 格式' });
    return date;
}
function addDays(date: Date, days: number): Date { const result = new Date(date); result.setUTCDate(result.getUTCDate() + days); return result; }
function normalizeContent(content: WorkReportContentDto): WorkReportContentResult {
    return { completedItems: content.completedItems.map((item) => item.trim()), plannedItems: content.plannedItems.map((item) => item.trim()), blockers: content.blockers.map((item) => item.trim()), remarks: content.remarks?.trim() || null };
}
function toWorkReportResult(record: WorkReportRecord): WorkReportResult {
    return {
        id: record.id, type: record.type, periodStart: record.periodStart, periodEnd: record.periodEnd,
        content: record.content as unknown as WorkReportContentResult, status: record.status,
        author: { membershipId: record.authorMembership.id, account: record.authorMembership.account, displayName: record.authorMembership.displayName ?? record.authorMembership.user.displayName, departmentId: record.authorMembership.departmentId },
        reviewer: record.reviewerMembership ? { membershipId: record.reviewerMembership.id, account: record.reviewerMembership.account, displayName: record.reviewerMembership.displayName ?? record.reviewerMembership.user.displayName, departmentId: record.reviewerMembership.departmentId } : null,
        projectIds: record.projects.map((project) => project.projectId), taskIds: record.tasks.map((task) => task.taskId),
        submittedAt: record.submittedAt, reviewedAt: record.reviewedAt, reviewComment: record.reviewComment,
        createdAt: record.createdAt, updatedAt: record.updatedAt, version: record.version,
    };
}
function auditData(context: RequestTenantContext, action: string, resourceId: string, metadata: Prisma.InputJsonObject): Prisma.AuditLogUncheckedCreateInput {
    return { tenantId: context.tenantId, actorUserId: context.userId, actorMembershipId: context.membershipId, action, outcome: AuditOutcome.SUCCESS, resourceType: 'WORK_REPORT', resourceId, requestId: context.requestId, metadata };
}
function isPrismaError(error: unknown, code: string): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code; }
