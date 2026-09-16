/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreateFinanceExpenseCategoryRequest } from '../models/CreateFinanceExpenseCategoryRequest';
import type { CreateFinanceExpenseReportRequest } from '../models/CreateFinanceExpenseReportRequest';
import type { FinanceExpenseCategoryListResponseEnvelope } from '../models/FinanceExpenseCategoryListResponseEnvelope';
import type { FinanceExpenseCategoryResponseEnvelope } from '../models/FinanceExpenseCategoryResponseEnvelope';
import type { FinanceExpenseReportListResponseEnvelope } from '../models/FinanceExpenseReportListResponseEnvelope';
import type { FinanceExpenseReportResponseEnvelope } from '../models/FinanceExpenseReportResponseEnvelope';
import type { FinanceExpenseStatus } from '../models/FinanceExpenseStatus';
import type { ReviewFinanceExpenseReportRequest } from '../models/ReviewFinanceExpenseReportRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class FinanceService {
    /**
     * 查询报销类别
     * @returns FinanceExpenseCategoryListResponseEnvelope 报销类别列表
     * @throws ApiError
     */
    public static listFinanceExpenseCategories(): CancelablePromise<FinanceExpenseCategoryListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/finance/expense-categories',
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 finance.expense.read 权限`,
            },
        });
    }
    /**
     * 创建报销类别
     * @returns FinanceExpenseCategoryResponseEnvelope 报销类别已创建
     * @throws ApiError
     */
    public static createFinanceExpenseCategory({
        requestBody,
    }: {
        requestBody: CreateFinanceExpenseCategoryRequest,
    }): CancelablePromise<FinanceExpenseCategoryResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/finance/expense-categories',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 finance.expense.manage_all 权限`,
                409: `报销类别编码已存在`,
            },
        });
    }
    /**
     * 查询报销单
     * @returns FinanceExpenseReportListResponseEnvelope 报销单列表
     * @throws ApiError
     */
    public static listFinanceExpenseReports({
        status,
        limit = 20,
        cursor,
    }: {
        status?: FinanceExpenseStatus,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<FinanceExpenseReportListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/finance/expense-reports',
            query: {
                'status': status,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 finance.expense.read 权限或数据范围不足`,
            },
        });
    }
    /**
     * 创建报销单
     * @returns FinanceExpenseReportResponseEnvelope 报销单已创建
     * @throws ApiError
     */
    public static createFinanceExpenseReport({
        requestBody,
    }: {
        requestBody: CreateFinanceExpenseReportRequest,
    }): CancelablePromise<FinanceExpenseReportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/finance/expense-reports',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 finance.expense.request 权限`,
            },
        });
    }
    /**
     * 审批报销单
     * @returns FinanceExpenseReportResponseEnvelope 审批后的报销单
     * @throws ApiError
     */
    public static reviewFinanceExpenseReport({
        reportId,
        requestBody,
    }: {
        /**
         * 报销单 ID
         */
        reportId: string,
        requestBody: ReviewFinanceExpenseReportRequest,
    }): CancelablePromise<FinanceExpenseReportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/finance/expense-reports/{reportId}/review',
            path: {
                'reportId': reportId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 finance.expense.approve 权限或数据范围不足`,
                404: `报销单不存在`,
                409: `报销单状态或版本冲突`,
            },
        });
    }
}
