/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DashboardMeetingTodo } from './DashboardMeetingTodo';
import type { DashboardReportTodo } from './DashboardReportTodo';
import type { DashboardTaskTodo } from './DashboardTaskTodo';
export type DashboardTodoList = {
    tasks: Array<DashboardTaskTodo>;
    reports: Array<DashboardReportTodo>;
    meetings: Array<DashboardMeetingTodo>;
    unreadNotificationCount: number;
};

