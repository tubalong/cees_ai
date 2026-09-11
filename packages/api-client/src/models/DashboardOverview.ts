/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DashboardMeetingMetrics } from './DashboardMeetingMetrics';
import type { DashboardNotificationMetrics } from './DashboardNotificationMetrics';
import type { DashboardProjectMetrics } from './DashboardProjectMetrics';
import type { DashboardReportMetrics } from './DashboardReportMetrics';
import type { DashboardTaskMetrics } from './DashboardTaskMetrics';
export type DashboardOverview = {
    project: DashboardProjectMetrics;
    task: DashboardTaskMetrics;
    report: DashboardReportMetrics;
    meeting: DashboardMeetingMetrics;
    notification: DashboardNotificationMetrics;
    generatedAt: string;
};

