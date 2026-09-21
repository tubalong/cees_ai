import { BadRequestException } from '@nestjs/common';
import { MeetingResponseStatus, MeetingStatus, ProjectStatus, TaskStatus, WorkReportStatus, WorkReportType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { DataScopeResolverService } from '../rbac/data-scope-resolver.service';
import { TenantContext } from '../tenant/tenant-context';
import { DashboardService } from './dashboard.service';

const TENANT_ID = '30000000-0000-0000-0000-000000000001';
const USER_ID = '30000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '30000000-0000-0000-0000-000000000003';
const PROJECT_ID = '30000000-0000-0000-0000-000000000004';
const TASK_ID = '30000000-0000-0000-0000-000000000005';
const MEETING_ID = '30000000-0000-0000-0000-000000000006';
const REPORT_ID = '30000000-0000-0000-0000-000000000007';
const NOW = new Date('2026-09-11T08:00:00.000Z');

describe('DashboardService', () => {
    afterEach(() => jest.useRealTimers());

    it('aggregates only data visible to the current member', async () => {
        useFixedNow();
        const prisma = createPrismaMock();
        prisma.project.findMany.mockResolvedValue([
            { status: ProjectStatus.ACTIVE },
            { status: ProjectStatus.COMPLETED },
        ]);
        prisma.task.findMany.mockResolvedValue([
            { status: TaskStatus.TODO, dueDate: new Date('2026-09-10T00:00:00.000Z') },
            { status: TaskStatus.DONE, dueDate: new Date('2026-09-08T00:00:00.000Z') },
            { status: TaskStatus.CANCELLED, dueDate: new Date('2026-09-07T00:00:00.000Z') },
        ]);
        prisma.workReport.findMany.mockResolvedValue([
            { status: WorkReportStatus.SUBMITTED, type: WorkReportType.DAILY, periodStart: new Date('2026-09-10T00:00:00.000Z'), authorMembershipId: MEMBERSHIP_ID, reviewerMembershipId: MEMBERSHIP_ID },
            { status: WorkReportStatus.APPROVED, type: WorkReportType.WEEKLY, periodStart: new Date('2026-09-07T00:00:00.000Z'), authorMembershipId: 'other', reviewerMembershipId: null },
        ]);
        prisma.meeting.findMany.mockResolvedValue([
            { status: MeetingStatus.SCHEDULED, startsAt: new Date('2026-09-11T10:00:00.000Z'), participants: [{ responseStatus: MeetingResponseStatus.INVITED }] },
            { status: MeetingStatus.SCHEDULED, startsAt: new Date('2026-09-12T10:00:00.000Z'), participants: [{ responseStatus: MeetingResponseStatus.ACCEPTED }] },
        ]);
        prisma.notificationRecipient.count.mockResolvedValue(4);
        const service = createService(prisma);

        await expect(service.overview()).resolves.toEqual({
            project: { total: 2, planning: 0, active: 1, paused: 0, completed: 1, cancelled: 0, archived: 0 },
            task: { total: 2, todo: 1, inProgress: 0, blocked: 0, done: 1, cancelled: 1, overdue: 1, completionRate: 0.5 },
            report: { total: 2, draft: 0, submitted: 1, approved: 1, rejected: 0, pendingReview: 1, dailyReportPending: false },
            meeting: { upcoming: 2, today: 1, pendingResponse: 1 },
            notification: { unreadCount: 4 },
            generatedAt: NOW,
        });
        expect(prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tenantId: TENANT_ID, OR: expect.any(Array) }),
        }));
        expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tenantId: TENANT_ID, OR: expect.any(Array) }),
        }));
        expect(prisma.notificationRecipient.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT_ID, userId: USER_ID }) }));
    });

    it('returns empty domain metrics when the member lacks domain read permissions', async () => {
        const prisma = createPrismaMock();
        prisma.notificationRecipient.count.mockResolvedValue(0);
        const service = createService(prisma, ['dashboard.read']);

        const result = await service.overview();

        expect(result.project.total).toBe(0);
        expect(result.task.total).toBe(0);
        expect(result.report.total).toBe(0);
        expect(result.meeting.upcoming).toBe(0);
        expect(prisma.project.findMany).not.toHaveBeenCalled();
        expect(prisma.task.findMany).not.toHaveBeenCalled();
        expect(prisma.workReport.findMany).not.toHaveBeenCalled();
        expect(prisma.meeting.findMany).not.toHaveBeenCalled();
        expect(prisma.notificationRecipient.count).not.toHaveBeenCalled();
    });

    it('rejects an inverted task statistics date range', async () => {
        const prisma = createPrismaMock();
        const service = createService(prisma);

        await expect(service.taskStatistics({ from: '2026-09-12T00:00:00.000Z', to: '2026-09-11T00:00:00.000Z' }))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.task.findMany).not.toHaveBeenCalled();
    });

    it('filters task statistics by visible project and creation range', async () => {
        const prisma = createPrismaMock();
        prisma.task.findMany.mockResolvedValue([]);
        const service = createService(prisma);

        await service.taskStatistics({ projectId: PROJECT_ID, from: '2026-09-01T00:00:00.000Z', to: '2026-09-11T00:00:00.000Z' });

        expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                tenantId: TENANT_ID,
                projectId: PROJECT_ID,
                createdAt: { gte: new Date('2026-09-01T00:00:00.000Z'), lte: new Date('2026-09-11T00:00:00.000Z') },
            }),
        }));
    });

    it('returns task, review and meeting todos with unread notifications', async () => {
        useFixedNow();
        const prisma = createPrismaMock();
        prisma.task.findMany.mockResolvedValue([{ id: TASK_ID, projectId: PROJECT_ID, title: '处理阻塞任务', status: TaskStatus.BLOCKED, priority: 'HIGH', dueDate: null }]);
        prisma.workReport.findMany.mockResolvedValue([{ id: REPORT_ID, type: WorkReportType.DAILY, periodStart: new Date('2026-09-10T00:00:00.000Z'), status: WorkReportStatus.SUBMITTED }]);
        prisma.meeting.findMany.mockResolvedValue([{ id: MEETING_ID, title: '项目会议', startsAt: new Date('2026-09-11T10:00:00.000Z'), status: MeetingStatus.SCHEDULED, participants: [{ responseStatus: MeetingResponseStatus.INVITED }] }]);
        prisma.notificationRecipient.count.mockResolvedValue(2);
        const service = createService(prisma);

        await expect(service.todos({ taskLimit: 3, reportLimit: 3, meetingLimit: 3 })).resolves.toEqual({
            tasks: [{ id: TASK_ID, projectId: PROJECT_ID, title: '处理阻塞任务', status: TaskStatus.BLOCKED, priority: 'HIGH', dueDate: null }],
            reports: [{ id: REPORT_ID, type: WorkReportType.DAILY, periodStart: new Date('2026-09-10T00:00:00.000Z'), status: WorkReportStatus.SUBMITTED }],
            meetings: [{ id: MEETING_ID, title: '项目会议', startsAt: new Date('2026-09-11T10:00:00.000Z'), status: MeetingStatus.SCHEDULED, responseStatus: MeetingResponseStatus.INVITED }],
            unreadNotificationCount: 2,
        });
        expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
        expect(prisma.workReport.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3, where: expect.objectContaining({ reviewerMembershipId: MEMBERSHIP_ID }) }));
    });

    it('returns upcoming meetings in ascending start order', async () => {
        useFixedNow();
        const prisma = createPrismaMock();
        prisma.meeting.findMany.mockResolvedValue([{ id: MEETING_ID, title: '近期会议', startsAt: new Date('2026-09-12T10:00:00.000Z'), durationMinutes: 60, status: MeetingStatus.DRAFT, projectId: null, participants: [] }]);
        const service = createService(prisma);

        await expect(service.upcomingMeetings({ limit: 10 })).resolves.toEqual({
            items: [{ id: MEETING_ID, title: '近期会议', startsAt: new Date('2026-09-12T10:00:00.000Z'), durationMinutes: 60, status: MeetingStatus.DRAFT, projectId: null, responseStatus: null }],
        });
        expect(prisma.meeting.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }] }));
    });

    it('resolves daily report and meeting day boundaries in the tenant time zone', async () => {
        // 2026-09-11T23:30Z 在东八区已经是 9 月 12 日 07:30。
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-09-11T23:30:00.000Z'));
        const prisma = createPrismaMock();
        prisma.project.findMany.mockResolvedValue([]);
        prisma.task.findMany.mockResolvedValue([]);
        prisma.notificationRecipient.count.mockResolvedValue(0);
        prisma.workReport.findMany.mockResolvedValue([
            { status: WorkReportStatus.SUBMITTED, type: WorkReportType.DAILY, periodStart: new Date('2026-09-11T00:00:00.000Z'), authorMembershipId: MEMBERSHIP_ID, reviewerMembershipId: MEMBERSHIP_ID },
        ]);
        prisma.meeting.findMany.mockResolvedValue([
            { status: MeetingStatus.SCHEDULED, startsAt: new Date('2026-09-12T02:00:00.000Z'), participants: [] },
        ]);
        const service = createService(prisma);

        // 东八区：昨天是 09-11，且 09-12T02:00Z 属于本地 09-12，算“今日”。
        prisma.tenant.findFirst.mockResolvedValue({ timezone: 'Asia/Shanghai' });
        const shanghai = await service.overview();
        expect(shanghai.report.dailyReportPending).toBe(false);
        expect(shanghai.meeting.today).toBe(1);

        // UTC：昨天是 09-10，09-12T02:00Z 已经跨出 UTC 当日窗口。
        prisma.tenant.findFirst.mockResolvedValue({ timezone: 'UTC' });
        const utc = await service.overview();
        expect(utc.report.dailyReportPending).toBe(true);
        expect(utc.meeting.today).toBe(0);
    });
});

function useFixedNow(): void {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
}

function createService(prisma: Record<string, any>, permissions: string[] = ['dashboard.read', 'project.read', 'task.read', 'work_report.read', 'meeting.read', 'notification.read']): DashboardService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'request-id',
            roles: [],
            permissions,
        }),
    } as unknown as TenantContext;
    const dataScopeResolver = { resolveFor: jest.fn().mockResolvedValue({ scopes: ['SELF'], tenantWide: false, membershipIds: [MEMBERSHIP_ID], departmentIds: [], projectIds: [] }) };
    return new DashboardService(prisma as unknown as PrismaService, tenantContext, dataScopeResolver as unknown as DataScopeResolverService);
}

function createPrismaMock(): Record<string, any> {
    return {
        project: { findMany: jest.fn() },
        task: { findMany: jest.fn() },
        workReport: { findMany: jest.fn() },
        meeting: { findMany: jest.fn() },
        notificationRecipient: { count: jest.fn() },
        tenant: { findFirst: jest.fn().mockResolvedValue({ timezone: 'Asia/Shanghai' }) },
    };
}
