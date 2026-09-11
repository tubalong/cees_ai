import { MeetingResponseStatus, MeetingStatus, ProjectStatus, TaskPriority, TaskStatus, WorkReportStatus, WorkReportType } from '@prisma/client';

export interface DashboardProjectMetrics {
    total: number;
    planning: number;
    active: number;
    paused: number;
    completed: number;
    cancelled: number;
    archived: number;
}

export interface DashboardTaskMetrics {
    total: number;
    todo: number;
    inProgress: number;
    blocked: number;
    done: number;
    cancelled: number;
    overdue: number;
    completionRate: number;
}

export interface DashboardReportMetrics {
    total: number;
    draft: number;
    submitted: number;
    approved: number;
    rejected: number;
    pendingReview: number;
    dailyReportPending: boolean;
}

export interface DashboardMeetingMetrics {
    upcoming: number;
    today: number;
    pendingResponse: number;
}

export interface DashboardNotificationMetrics {
    unreadCount: number;
}

export interface DashboardOverviewResult {
    project: DashboardProjectMetrics;
    task: DashboardTaskMetrics;
    report: DashboardReportMetrics;
    meeting: DashboardMeetingMetrics;
    notification: DashboardNotificationMetrics;
    generatedAt: Date;
}

export interface DashboardTaskStatisticsResult extends DashboardTaskMetrics { }

export interface DashboardTaskTodo {
    id: string;
    projectId: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate: Date | null;
}

export interface DashboardReportTodo {
    id: string;
    type: WorkReportType;
    periodStart: Date;
    status: WorkReportStatus;
}

export interface DashboardMeetingTodo {
    id: string;
    title: string;
    startsAt: Date;
    status: MeetingStatus;
    responseStatus: MeetingResponseStatus | null;
}

export interface DashboardTodoListResult {
    tasks: DashboardTaskTodo[];
    reports: DashboardReportTodo[];
    meetings: DashboardMeetingTodo[];
    unreadNotificationCount: number;
}

export interface DashboardUpcomingMeetingResult {
    id: string;
    title: string;
    startsAt: Date;
    durationMinutes: number;
    status: MeetingStatus;
    projectId: string | null;
    responseStatus: MeetingResponseStatus | null;
}

export interface DashboardUpcomingMeetingListResult {
    items: DashboardUpcomingMeetingResult[];
}

export type DashboardProjectStatus = ProjectStatus;
