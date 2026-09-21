/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DashboardHomepageResponseEnvelope } from '../models/DashboardHomepageResponseEnvelope';
import type { DashboardOverviewResponseEnvelope } from '../models/DashboardOverviewResponseEnvelope';
import type { DashboardSnapshotRebuildResponseEnvelope } from '../models/DashboardSnapshotRebuildResponseEnvelope';
import type { DashboardTaskStatisticsResponseEnvelope } from '../models/DashboardTaskStatisticsResponseEnvelope';
import type { DashboardTodoListResponseEnvelope } from '../models/DashboardTodoListResponseEnvelope';
import type { DashboardTrendsResponseEnvelope } from '../models/DashboardTrendsResponseEnvelope';
import type { DashboardUpcomingMeetingListResponseEnvelope } from '../models/DashboardUpcomingMeetingListResponseEnvelope';
import type { RebuildDashboardSnapshotRequest } from '../models/RebuildDashboardSnapshotRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class DashboardService {
    /**
     * 查询当前成员工作台概览
     * @returns DashboardOverviewResponseEnvelope 工作台概览
     * @throws ApiError
     */
    public static dashboardOverview(): CancelablePromise<DashboardOverviewResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/dashboard/overview',
            errors: {
                403: `缺少 dashboard.read 权限`,
            },
        });
    }
    /**
     * 查询当前成员角色化首页
     * @returns DashboardHomepageResponseEnvelope 角色化首页
     * @throws ApiError
     */
    public static dashboardHome(): CancelablePromise<DashboardHomepageResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/dashboard/home',
            errors: {
                403: `缺少 dashboard.read 权限`,
            },
        });
    }
    /**
     * 查询首页指标快照趋势
     * @returns DashboardTrendsResponseEnvelope 指标趋势
     * @throws ApiError
     */
    public static dashboardTrends({
        metrics,
        period,
        from,
        to,
    }: {
        metrics: Array<string>,
        period: 'DAY' | 'MONTH',
        from: string,
        to: string,
    }): CancelablePromise<DashboardTrendsResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/dashboard/trends',
            query: {
                'metrics': metrics,
                'period': period,
                'from': from,
                'to': to,
            },
        });
    }
    /**
     * 重算租户日/月仪表盘快照
     * @returns DashboardSnapshotRebuildResponseEnvelope 快照重算完成
     * @throws ApiError
     */
    public static dashboardSnapshotRebuild({
        requestBody,
    }: {
        requestBody: RebuildDashboardSnapshotRequest,
    }): CancelablePromise<DashboardSnapshotRebuildResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/dashboard/snapshots/rebuild',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * 查询当前成员可见任务统计
     * @returns DashboardTaskStatisticsResponseEnvelope 任务统计
     * @throws ApiError
     */
    public static dashboardTaskStatistics({
        projectId,
        from,
        to,
    }: {
        projectId?: string,
        from?: string,
        to?: string,
    }): CancelablePromise<DashboardTaskStatisticsResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/dashboard/task-statistics',
            query: {
                'projectId': projectId,
                'from': from,
                'to': to,
            },
            errors: {
                400: `时间范围无效`,
                403: `缺少 dashboard.read 权限`,
            },
        });
    }
    /**
     * 查询当前成员工作台待办
     * @returns DashboardTodoListResponseEnvelope 工作台待办
     * @throws ApiError
     */
    public static dashboardTodos({
        taskLimit = 5,
        reportLimit = 5,
        meetingLimit = 5,
    }: {
        taskLimit?: number,
        reportLimit?: number,
        meetingLimit?: number,
    }): CancelablePromise<DashboardTodoListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/dashboard/todos',
            query: {
                'taskLimit': taskLimit,
                'reportLimit': reportLimit,
                'meetingLimit': meetingLimit,
            },
            errors: {
                403: `缺少 dashboard.read 权限`,
            },
        });
    }
    /**
     * 查询当前成员近期会议
     * @returns DashboardUpcomingMeetingListResponseEnvelope 近期会议列表
     * @throws ApiError
     */
    public static dashboardUpcomingMeetings({
        limit = 20,
    }: {
        limit?: number,
    }): CancelablePromise<DashboardUpcomingMeetingListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/dashboard/upcoming-meetings',
            query: {
                'limit': limit,
            },
            errors: {
                403: `缺少 dashboard.read 权限`,
            },
        });
    }
}
