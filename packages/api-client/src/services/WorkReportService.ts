/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreateDailyWorkReportRequest } from '../models/CreateDailyWorkReportRequest';
import type { CreateWeeklyWorkReportRequest } from '../models/CreateWeeklyWorkReportRequest';
import type { ReviewWorkReportRequest } from '../models/ReviewWorkReportRequest';
import type { UpdateWorkReportRequest } from '../models/UpdateWorkReportRequest';
import type { WorkReportListResponseEnvelope } from '../models/WorkReportListResponseEnvelope';
import type { WorkReportResponseEnvelope } from '../models/WorkReportResponseEnvelope';
import type { WorkReportStatisticsResponseEnvelope } from '../models/WorkReportStatisticsResponseEnvelope';
import type { WorkReportStatus } from '../models/WorkReportStatus';
import type { WorkReportType } from '../models/WorkReportType';
import type { WorkReportVersionRequest } from '../models/WorkReportVersionRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class WorkReportService {
    /**
     * 查询当前成员可见的日报和周报
     * @returns WorkReportListResponseEnvelope 日报和周报列表
     * @throws ApiError
     */
    public static workReportList({
        type,
        status,
        authorMembershipId,
        reviewerMembershipId,
        periodFrom,
        periodTo,
        limit = 20,
        cursor,
    }: {
        type?: WorkReportType,
        status?: WorkReportStatus,
        authorMembershipId?: string,
        reviewerMembershipId?: string,
        periodFrom?: string,
        periodTo?: string,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<WorkReportListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/work-reports',
            query: {
                'type': type,
                'status': status,
                'authorMembershipId': authorMembershipId,
                'reviewerMembershipId': reviewerMembershipId,
                'periodFrom': periodFrom,
                'periodTo': periodTo,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                403: `缺少 work_report.read 权限`,
            },
        });
    }
    /**
     * 创建日报
     * @returns WorkReportResponseEnvelope 日报已创建
     * @throws ApiError
     */
    public static workReportDailyCreate({
        requestBody,
    }: {
        requestBody: CreateDailyWorkReportRequest,
    }): CancelablePromise<WorkReportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/work-reports/daily',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `报告日期或关联资源无效`,
                409: `当前周期已存在有效报告`,
            },
        });
    }
    /**
     * 创建周报
     * @returns WorkReportResponseEnvelope 周报已创建
     * @throws ApiError
     */
    public static workReportWeeklyCreate({
        requestBody,
    }: {
        requestBody: CreateWeeklyWorkReportRequest,
    }): CancelablePromise<WorkReportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/work-reports/weekly',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `周报日期或关联资源无效`,
                409: `当前周期已存在有效报告`,
            },
        });
    }
    /**
     * 查询日报和周报状态统计
     * @returns WorkReportStatisticsResponseEnvelope 日报和周报状态统计
     * @throws ApiError
     */
    public static workReportStatistics({
        type,
        periodFrom,
        periodTo,
    }: {
        type?: WorkReportType,
        periodFrom?: string,
        periodTo?: string,
    }): CancelablePromise<WorkReportStatisticsResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/work-reports/statistics',
            query: {
                'type': type,
                'periodFrom': periodFrom,
                'periodTo': periodTo,
            },
        });
    }
    /**
     * 查询日报或周报详情
     * @returns WorkReportResponseEnvelope 日报或周报详情
     * @throws ApiError
     */
    public static workReportGet({
        workReportId,
    }: {
        workReportId: string,
    }): CancelablePromise<WorkReportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/work-reports/{workReportId}',
            path: {
                'workReportId': workReportId,
            },
            errors: {
                404: `报告不存在或当前成员不可见`,
            },
        });
    }
    /**
     * 修改草稿或驳回报告
     * @returns WorkReportResponseEnvelope 报告已修改
     * @throws ApiError
     */
    public static workReportUpdate({
        workReportId,
        requestBody,
    }: {
        workReportId: string,
        requestBody: UpdateWorkReportRequest,
    }): CancelablePromise<WorkReportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/work-reports/{workReportId}',
            path: {
                'workReportId': workReportId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `报告状态或版本冲突`,
            },
        });
    }
    /**
     * 删除草稿或驳回报告
     * @returns void
     * @throws ApiError
     */
    public static workReportDelete({
        workReportId,
        version,
    }: {
        workReportId: string,
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/work-reports/{workReportId}',
            path: {
                'workReportId': workReportId,
            },
            query: {
                'version': version,
            },
            errors: {
                409: `报告状态或版本冲突`,
            },
        });
    }
    /**
     * 提交日报或周报
     * @returns WorkReportResponseEnvelope 报告已提交
     * @throws ApiError
     */
    public static workReportSubmit({
        workReportId,
        requestBody,
    }: {
        workReportId: string,
        requestBody: WorkReportVersionRequest,
    }): CancelablePromise<WorkReportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/work-reports/{workReportId}/submit',
            path: {
                'workReportId': workReportId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * 撤回已提交报告
     * @returns WorkReportResponseEnvelope 报告已撤回
     * @throws ApiError
     */
    public static workReportWithdraw({
        workReportId,
        requestBody,
    }: {
        workReportId: string,
        requestBody: WorkReportVersionRequest,
    }): CancelablePromise<WorkReportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/work-reports/{workReportId}/withdraw',
            path: {
                'workReportId': workReportId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * 审核日报或周报
     * @returns WorkReportResponseEnvelope 报告审核完成
     * @throws ApiError
     */
    public static workReportReview({
        workReportId,
        requestBody,
    }: {
        workReportId: string,
        requestBody: ReviewWorkReportRequest,
    }): CancelablePromise<WorkReportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/work-reports/{workReportId}/review',
            path: {
                'workReportId': workReportId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                403: `当前成员不是指定审核人或租户管理员`,
            },
        });
    }
}
