import { BadRequestException, Injectable } from '@nestjs/common';
import {
    MeetingResponseStatus,
    MeetingStatus,
    Prisma,
    ProjectStatus,
    TaskStatus,
    WorkReportStatus,
} from '@prisma/client';
import { addLocalDays, dateKeyToUtcMidnight, DEFAULT_TENANT_TIMEZONE, shiftLocalDateKey, startOfLocalDay } from '../common/tenant-time';
import { PrismaService } from '../database/prisma.service';
import { DataScopeResolution } from '../rbac/access-control';
import { DataScopeResolverService } from '../rbac/data-scope-resolver.service';
import { RequestTenantContext, TenantContext } from '../tenant/tenant-context';
import { DashboardTaskStatisticsQueryDto, DashboardTodosQueryDto, DashboardUpcomingMeetingsQueryDto } from './dto';
import { calculateTaskMetrics } from './task-metrics';
import {
    DashboardMeetingTodo,
    DashboardOverviewResult,
    DashboardReportTodo,
    DashboardTaskMetrics,
    DashboardTaskTodo,
    DashboardTodoListResult,
    DashboardUpcomingMeetingListResult,
} from './dashboard.types';

const ACTIVE_TASK_STATUSES: TaskStatus[] = [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED];
const OPEN_MEETING_STATUSES: MeetingStatus[] = [MeetingStatus.DRAFT, MeetingStatus.SCHEDULED];

const taskMetricSelect = { status: true, dueDate: true } satisfies Prisma.TaskSelect;
const taskTodoSelect = { id: true, projectId: true, title: true, status: true, priority: true, dueDate: true } satisfies Prisma.TaskSelect;
const reportMetricSelect = { status: true, type: true, periodStart: true, authorMembershipId: true, reviewerMembershipId: true } satisfies Prisma.WorkReportSelect;
const reportTodoSelect = { id: true, type: true, periodStart: true, status: true } satisfies Prisma.WorkReportSelect;
type DashboardMeetingRecord = {
    id: string;
    title: string;
    startsAt: Date;
    status: MeetingStatus;
    durationMinutes: number;
    projectId: string | null;
    participants: Array<{ responseStatus: MeetingResponseStatus }>;
};

@Injectable()
export class DashboardService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
        private readonly dataScopeResolver: DataScopeResolverService,
    ) { }

    async overview(): Promise<DashboardOverviewResult> {
        const context = this.tenantContext.require();
        const now = new Date();
        const scope = await this.dataScopeResolver.resolveFor(context);
        const [timeZone, projects, tasks, reports, meetings, unreadCount] = await Promise.all([
            this.tenantTimeZone(context.tenantId),
            this.can(context, 'project.read')
                ? this.prisma.project.findMany({ where: this.projectWhere(context, scope), select: { status: true } })
                : Promise.resolve([]),
            this.can(context, 'task.read')
                ? this.prisma.task.findMany({ where: this.taskWhere(context, scope), select: taskMetricSelect })
                : Promise.resolve([]),
            this.can(context, 'work_report.read')
                ? this.prisma.workReport.findMany({ where: this.reportWhere(context, scope), select: reportMetricSelect })
                : Promise.resolve([]),
            this.can(context, 'meeting.read')
                ? this.prisma.meeting.findMany({
                    where: { ...this.meetingWhere(context, scope), status: { notIn: [MeetingStatus.COMPLETED, MeetingStatus.CANCELLED] } },
                    select: { status: true, startsAt: true, participants: { where: { membershipId: context.membershipId, deletedAt: null }, select: { responseStatus: true } } },
                })
                : Promise.resolve([]),
            this.can(context, 'notification.read')
                ? this.prisma.notificationRecipient.count({ where: { tenantId: context.tenantId, userId: context.userId, readAt: null, notification: { tenantId: context.tenantId, deletedAt: null } } })
                : Promise.resolve(0),
        ]);
        return {
            project: projectMetrics(projects),
            task: taskMetrics(tasks, now),
            report: reportMetrics(reports, context.membershipId, now, timeZone),
            meeting: meetingMetrics(meetings as DashboardMeetingRecord[], now, timeZone),
            notification: { unreadCount },
            generatedAt: now,
        };
    }

    async taskStatistics(query: DashboardTaskStatisticsQueryDto): Promise<DashboardTaskMetrics> {
        const context = this.tenantContext.require();
        const scope = await this.dataScopeResolver.resolveFor(context);
        const from = query.from ? new Date(query.from) : undefined;
        const to = query.to ? new Date(query.to) : undefined;
        if (from && to && from > to) throw new BadRequestException({ code: 'DASHBOARD_DATE_RANGE_INVALID', message: '看板时间范围无效' });
        const tasks = await this.prisma.task.findMany({
            where: {
                ...this.taskWhere(context, scope),
                projectId: query.projectId,
                createdAt: from || to ? { gte: from, lte: to } : undefined,
            },
            select: taskMetricSelect,
        });
        return taskMetrics(tasks, new Date());
    }

    async todos(query: DashboardTodosQueryDto): Promise<DashboardTodoListResult> {
        const context = this.tenantContext.require();
        const now = new Date();
        const scope = await this.dataScopeResolver.resolveFor(context);
        const [tasks, reports, meetings, unreadNotificationCount] = await Promise.all([
            this.can(context, 'task.read')
                ? this.prisma.task.findMany({
                    where: { ...this.taskWhere(context, scope), status: { in: ACTIVE_TASK_STATUSES } },
                    select: taskTodoSelect,
                    orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
                    take: query.taskLimit,
                })
                : Promise.resolve([]),
            this.can(context, 'work_report.read')
                ? this.prisma.workReport.findMany({
                    where: { ...this.reportWhere(context, scope), reviewerMembershipId: context.membershipId, status: WorkReportStatus.SUBMITTED },
                    select: reportTodoSelect,
                    orderBy: [{ submittedAt: 'asc' }, { periodStart: 'asc' }],
                    take: query.reportLimit,
                })
                : Promise.resolve([]),
            this.can(context, 'meeting.read')
                ? this.prisma.meeting.findMany({
                    where: { ...this.meetingWhere(context, scope), status: { in: OPEN_MEETING_STATUSES }, startsAt: { gte: now } },
                    select: { id: true, title: true, startsAt: true, status: true, participants: { where: { membershipId: context.membershipId, deletedAt: null }, select: { responseStatus: true } } },
                    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
                    take: query.meetingLimit,
                })
                : Promise.resolve([]),
            this.can(context, 'notification.read')
                ? this.prisma.notificationRecipient.count({ where: { tenantId: context.tenantId, userId: context.userId, readAt: null, notification: { tenantId: context.tenantId, deletedAt: null } } })
                : Promise.resolve(0),
        ]);
        return {
            tasks: tasks as DashboardTaskTodo[],
            reports: reports as DashboardReportTodo[],
            meetings: (meetings as DashboardMeetingRecord[]).map((meeting) => ({
                id: meeting.id,
                title: meeting.title,
                startsAt: meeting.startsAt,
                status: meeting.status,
                responseStatus: meeting.participants[0]?.responseStatus ?? null,
            })) as DashboardMeetingTodo[],
            unreadNotificationCount,
        };
    }

    async upcomingMeetings(query: DashboardUpcomingMeetingsQueryDto): Promise<DashboardUpcomingMeetingListResult> {
        const context = this.tenantContext.require();
        const scope = await this.dataScopeResolver.resolveFor(context);
        const meetings = await this.prisma.meeting.findMany({
            where: { ...this.meetingWhere(context, scope), status: { in: OPEN_MEETING_STATUSES }, startsAt: { gte: new Date() } },
            select: { id: true, title: true, startsAt: true, durationMinutes: true, status: true, projectId: true, participants: { where: { membershipId: context.membershipId, deletedAt: null }, select: { responseStatus: true } } },
            orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
            take: query.limit,
        });
        return {
            items: (meetings as DashboardMeetingRecord[]).map((meeting) => ({
                id: meeting.id,
                title: meeting.title,
                startsAt: meeting.startsAt,
                durationMinutes: meeting.durationMinutes,
                status: meeting.status,
                projectId: meeting.projectId,
                responseStatus: meeting.participants[0]?.responseStatus ?? null,
            })),
        };
    }

    private projectWhere(context: RequestTenantContext, scope: DataScopeResolution): Prisma.ProjectWhereInput {
        return {
            tenantId: context.tenantId,
            deletedAt: null,
            ...(scope.tenantWide ? {} : { OR: this.projectScopeClauses(scope) }),
        };
    }

    private taskWhere(context: RequestTenantContext, scope: DataScopeResolution): Prisma.TaskWhereInput {
        return {
            tenantId: context.tenantId,
            deletedAt: null,
            ...(scope.tenantWide ? {} : {
                OR: [
                    scope.membershipIds.length ? { createdByMembershipId: { in: scope.membershipIds } } : undefined,
                    scope.membershipIds.length ? { assignees: { some: { membershipId: { in: scope.membershipIds } } } } : undefined,
                    { project: { tenantId: context.tenantId, deletedAt: null, OR: this.projectScopeClauses(scope) } },
                ].filter(Boolean) as Prisma.TaskWhereInput[]
            }),
        };
    }

    private reportWhere(context: RequestTenantContext, scope: DataScopeResolution): Prisma.WorkReportWhereInput {
        return {
            tenantId: context.tenantId,
            deletedAt: null,
            ...(scope.tenantWide ? {} : {
                OR: [
                    { authorMembershipId: { in: scope.membershipIds } },
                    { reviewerMembershipId: { in: scope.membershipIds }, status: { not: WorkReportStatus.DRAFT } },
                ]
            }),
        };
    }

    private meetingWhere(context: RequestTenantContext, scope: DataScopeResolution): Prisma.MeetingWhereInput {
        return {
            tenantId: context.tenantId,
            deletedAt: null,
            ...(scope.tenantWide ? {} : {
                OR: [
                    { organizerMembershipId: { in: scope.membershipIds } },
                    { participants: { some: { membershipId: { in: scope.membershipIds }, deletedAt: null } } },
                    scope.departmentIds.length ? { departmentId: { in: scope.departmentIds } } : undefined,
                    scope.projectIds.length ? { projectId: { in: scope.projectIds } } : undefined,
                ].filter(Boolean) as Prisma.MeetingWhereInput[]
            }),
        };
    }

    private projectScopeClauses(scope: DataScopeResolution): Prisma.ProjectWhereInput[] {
        return [
            scope.projectIds.length ? { id: { in: scope.projectIds } } : undefined,
            scope.departmentIds.length ? { departmentId: { in: scope.departmentIds } } : undefined,
            scope.membershipIds.length ? { members: { some: { membershipId: { in: scope.membershipIds }, deletedAt: null } } } : undefined,
        ].filter(Boolean) as Prisma.ProjectWhereInput[];
    }

    private can(context: RequestTenantContext, permission: string): boolean {
        return context.permissions.includes(permission);
    }

    /** 业务日界线按租户时区计算；租户时区缺失时回退到平台默认时区。 */
    private async tenantTimeZone(tenantId: string): Promise<string> {
        const tenant = await this.prisma.tenant.findFirst({
            where: { id: tenantId, deletedAt: null },
            select: { timezone: true },
        });
        return tenant?.timezone ?? DEFAULT_TENANT_TIMEZONE;
    }
}

function projectMetrics(projects: Array<{ status: ProjectStatus }>) {
    return projects.reduce((result, project) => {
        result.total += 1;
        if (project.status === ProjectStatus.PLANNING) result.planning += 1;
        if (project.status === ProjectStatus.ACTIVE) result.active += 1;
        if (project.status === ProjectStatus.PAUSED) result.paused += 1;
        if (project.status === ProjectStatus.COMPLETED) result.completed += 1;
        if (project.status === ProjectStatus.CANCELLED) result.cancelled += 1;
        if (project.status === ProjectStatus.ARCHIVED) result.archived += 1;
        return result;
    }, { total: 0, planning: 0, active: 0, paused: 0, completed: 0, cancelled: 0, archived: 0 });
}

function taskMetrics(tasks: Array<{ status: TaskStatus; dueDate: Date | null }>, now: Date): DashboardTaskMetrics {
    const calculated = calculateTaskMetrics(tasks, now);
    return tasks.reduce((result, task) => {
        if (task.status === TaskStatus.TODO) result.todo += 1;
        if (task.status === TaskStatus.IN_PROGRESS) result.inProgress += 1;
        if (task.status === TaskStatus.BLOCKED) result.blocked += 1;
        if (task.status === TaskStatus.DONE) result.done += 1;
        if (task.status === TaskStatus.CANCELLED) result.cancelled += 1;
        return result;
    }, { ...calculated, todo: 0, inProgress: 0, blocked: 0, done: 0, cancelled: 0 });
}

function reportMetrics(reports: Array<{ status: WorkReportStatus; type: string; periodStart: Date; authorMembershipId: string; reviewerMembershipId: string | null }>, membershipId: string, now: Date, timeZone: string) {
    const previousDay = dateKeyToUtcMidnight(shiftLocalDateKey(timeZone, now, -1)).getTime();
    const dailyReport = reports.find((report) => report.authorMembershipId === membershipId && report.type === 'DAILY' && report.periodStart.getTime() === previousDay);
    return reports.reduce((result, report) => {
        result.total += 1;
        if (report.status === WorkReportStatus.DRAFT) result.draft += 1;
        if (report.status === WorkReportStatus.SUBMITTED) result.submitted += 1;
        if (report.status === WorkReportStatus.APPROVED) result.approved += 1;
        if (report.status === WorkReportStatus.REJECTED) result.rejected += 1;
        if (report.status === WorkReportStatus.SUBMITTED && report.reviewerMembershipId === membershipId) result.pendingReview += 1;
        return result;
    }, { total: 0, draft: 0, submitted: 0, approved: 0, rejected: 0, pendingReview: 0, dailyReportPending: !dailyReport || dailyReport.status === WorkReportStatus.DRAFT || dailyReport.status === WorkReportStatus.REJECTED });
}

function meetingMetrics(meetings: Array<{ status: MeetingStatus; startsAt: Date; participants: Array<{ responseStatus: MeetingResponseStatus }> }>, now: Date, timeZone: string) {
    const todayStart = startOfLocalDay(timeZone, now).getTime();
    const tomorrow = addLocalDays(timeZone, now, 1).getTime();
    return meetings.reduce((result, meeting) => {
        if (meeting.startsAt >= now) result.upcoming += 1;
        if (meeting.startsAt.getTime() >= todayStart && meeting.startsAt.getTime() < tomorrow) result.today += 1;
        if (meeting.startsAt >= now && meeting.participants.some((participant) => participant.responseStatus === MeetingResponseStatus.INVITED || participant.responseStatus === MeetingResponseStatus.TENTATIVE)) result.pendingResponse += 1;
        return result;
    }, { upcoming: 0, today: 0, pendingResponse: 0 });
}
