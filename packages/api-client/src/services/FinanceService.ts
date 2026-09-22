/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreateFinanceExpenseCategoryRequest } from '../models/CreateFinanceExpenseCategoryRequest';
import type { CreateFinanceExpenseReportRequest } from '../models/CreateFinanceExpenseReportRequest';
import type { CreateFinanceLedgerImportRequest } from '../models/CreateFinanceLedgerImportRequest';
import type { FinanceExpenseActionRequest } from '../models/FinanceExpenseActionRequest';
import type { FinanceExpenseCategoryListResponseEnvelope } from '../models/FinanceExpenseCategoryListResponseEnvelope';
import type { FinanceExpenseCategoryResponseEnvelope } from '../models/FinanceExpenseCategoryResponseEnvelope';
import type { FinanceExpenseReportListResponseEnvelope } from '../models/FinanceExpenseReportListResponseEnvelope';
import type { FinanceExpenseReportResponseEnvelope } from '../models/FinanceExpenseReportResponseEnvelope';
import type { FinanceExpenseStatus } from '../models/FinanceExpenseStatus';
import type { FinanceExpenseSummaryResponseEnvelope } from '../models/FinanceExpenseSummaryResponseEnvelope';
import type { FinanceExpenseVersionRequest } from '../models/FinanceExpenseVersionRequest';
import type { FinanceLedgerEntryListResponseEnvelope } from '../models/FinanceLedgerEntryListResponseEnvelope';
import type { FinanceLedgerImportListResponseEnvelope } from '../models/FinanceLedgerImportListResponseEnvelope';
import type { FinanceLedgerImportResponseEnvelope } from '../models/FinanceLedgerImportResponseEnvelope';
import type { FinanceProjectSpendResponseEnvelope } from '../models/FinanceProjectSpendResponseEnvelope';
import type { MarkFinanceExpenseReportPaidRequest } from '../models/MarkFinanceExpenseReportPaidRequest';
import type { ReviewFinanceExpenseReportRequest } from '../models/ReviewFinanceExpenseReportRequest';
import type { UpdateFinanceExpenseCategoryRequest } from '../models/UpdateFinanceExpenseCategoryRequest';
import type { UpdateFinanceExpenseReportRequest } from '../models/UpdateFinanceExpenseReportRequest';
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
     * 查询财务收支台账
     * @returns FinanceLedgerEntryListResponseEnvelope 台账记录
     * @throws ApiError
     */
    public static listFinanceLedgerEntries({
        direction,
        dateFrom,
        dateTo,
        departmentId,
        projectId,
        limit = 20,
        cursor,
    }: {
        direction?: 'INCOME' | 'EXPENSE',
        dateFrom?: string,
        dateTo?: string,
        departmentId?: string,
        projectId?: string,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<FinanceLedgerEntryListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/finance/ledger-entries',
            query: {
                'direction': direction,
                'dateFrom': dateFrom,
                'dateTo': dateTo,
                'departmentId': departmentId,
                'projectId': projectId,
                'limit': limit,
                'cursor': cursor,
            },
        });
    }
    /**
     * 查询财务台账导入历史
     * 按创建时间倒序返回当前租户的导入批次；用于「导入历史」列表与回滚入口。只返回未删除的批次。
     * @returns FinanceLedgerImportListResponseEnvelope 导入批次列表
     * @throws ApiError
     */
    public static listFinanceLedgerImports({
        limit = 20,
        cursor,
    }: {
        limit?: number,
        cursor?: string,
    }): CancelablePromise<FinanceLedgerImportListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/finance/ledger-imports',
            query: {
                'limit': limit,
                'cursor': cursor,
            },
        });
    }
    /**
     * 导入财务收支台账
     * @returns FinanceLedgerImportResponseEnvelope 导入完成
     * @throws ApiError
     */
    public static createFinanceLedgerImport({
        requestBody,
    }: {
        requestBody: CreateFinanceLedgerImportRequest,
    }): CancelablePromise<FinanceLedgerImportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/finance/ledger-imports',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * 查询财务台账导入批次
     * @returns FinanceLedgerImportResponseEnvelope 导入批次
     * @throws ApiError
     */
    public static getFinanceLedgerImport({
        importId,
    }: {
        importId: string,
    }): CancelablePromise<FinanceLedgerImportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/finance/ledger-imports/{importId}',
            path: {
                'importId': importId,
            },
        });
    }
    /**
     * 回滚财务台账导入批次
     * @returns void
     * @throws ApiError
     */
    public static deleteFinanceLedgerImport({
        importId,
    }: {
        importId: string,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/finance/ledger-imports/{importId}',
            path: {
                'importId': importId,
            },
        });
    }
    /**
     * 修改报销类别
     * @returns FinanceExpenseCategoryResponseEnvelope 修改后的报销类别
     * @throws ApiError
     */
    public static updateFinanceExpenseCategory({
        categoryId,
        requestBody,
    }: {
        /**
         * 报销类别 ID
         */
        categoryId: string,
        requestBody: UpdateFinanceExpenseCategoryRequest,
    }): CancelablePromise<FinanceExpenseCategoryResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/finance/expense-categories/{categoryId}',
            path: {
                'categoryId': categoryId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 finance.expense.manage_all 权限`,
                404: `报销类别不存在`,
                409: `编码或版本冲突`,
            },
        });
    }
    /**
     * 删除未使用的报销类别
     * @returns void
     * @throws ApiError
     */
    public static deleteFinanceExpenseCategory({
        categoryId,
        version,
    }: {
        /**
         * 报销类别 ID
         */
        categoryId: string,
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/finance/expense-categories/{categoryId}',
            path: {
                'categoryId': categoryId,
            },
            query: {
                'version': version,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 finance.expense.manage_all 权限`,
                404: `报销类别不存在`,
                409: `类别已被使用或版本冲突`,
            },
        });
    }
    /**
     * 查询报销单
     * @returns FinanceExpenseReportListResponseEnvelope 报销单列表
     * @throws ApiError
     */
    public static listFinanceExpenseReports({
        keyword,
        status,
        requesterMembershipId,
        departmentId,
        projectId,
        categoryId,
        dateFrom,
        dateTo,
        limit = 20,
        cursor,
    }: {
        keyword?: string,
        status?: FinanceExpenseStatus,
        requesterMembershipId?: string,
        departmentId?: string,
        projectId?: string,
        categoryId?: string,
        dateFrom?: string,
        dateTo?: string,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<FinanceExpenseReportListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/finance/expense-reports',
            query: {
                'keyword': keyword,
                'status': status,
                'requesterMembershipId': requesterMembershipId,
                'departmentId': departmentId,
                'projectId': projectId,
                'categoryId': categoryId,
                'dateFrom': dateFrom,
                'dateTo': dateTo,
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
     * 查询报销单详情
     * @returns FinanceExpenseReportResponseEnvelope 报销单详情
     * @throws ApiError
     */
    public static getFinanceExpenseReport({
        reportId,
    }: {
        /**
         * 报销单 ID
         */
        reportId: string,
    }): CancelablePromise<FinanceExpenseReportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/finance/expense-reports/{reportId}',
            path: {
                'reportId': reportId,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 finance.expense.read 权限或数据范围不足`,
                404: `报销单不存在`,
            },
        });
    }
    /**
     * 修改草稿、撤回或被驳回的报销单
     * @returns FinanceExpenseReportResponseEnvelope 修改后的报销单
     * @throws ApiError
     */
    public static updateFinanceExpenseReport({
        reportId,
        requestBody,
    }: {
        /**
         * 报销单 ID
         */
        reportId: string,
        requestBody: UpdateFinanceExpenseReportRequest,
    }): CancelablePromise<FinanceExpenseReportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/finance/expense-reports/{reportId}',
            path: {
                'reportId': reportId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `只能修改自己的可编辑报销单`,
                404: `报销单不存在`,
                409: `状态或版本冲突`,
            },
        });
    }
    /**
     * 删除草稿、撤回或被驳回的报销单
     * @returns void
     * @throws ApiError
     */
    public static deleteFinanceExpenseReport({
        reportId,
        version,
    }: {
        /**
         * 报销单 ID
         */
        reportId: string,
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/finance/expense-reports/{reportId}',
            path: {
                'reportId': reportId,
            },
            query: {
                'version': version,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `只能删除自己的可编辑报销单`,
                404: `报销单不存在`,
                409: `状态或版本冲突`,
            },
        });
    }
    /**
     * 提交报销单审批
     * @returns FinanceExpenseReportResponseEnvelope 已提交的报销单
     * @throws ApiError
     */
    public static submitFinanceExpenseReport({
        reportId,
        requestBody,
    }: {
        reportId: string,
        requestBody: FinanceExpenseVersionRequest,
    }): CancelablePromise<FinanceExpenseReportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/finance/expense-reports/{reportId}/submit',
            path: {
                'reportId': reportId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `报销明细、附件或关联资源校验失败`,
                401: `登录状态无效或已过期`,
                403: `只能提交自己的报销单`,
                404: `报销单不存在`,
                409: `状态或版本冲突`,
            },
        });
    }
    /**
     * 撤回待审批报销单
     * @returns FinanceExpenseReportResponseEnvelope 已撤回的报销单
     * @throws ApiError
     */
    public static withdrawFinanceExpenseReport({
        reportId,
        requestBody,
    }: {
        reportId: string,
        requestBody: FinanceExpenseActionRequest,
    }): CancelablePromise<FinanceExpenseReportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/finance/expense-reports/{reportId}/withdraw',
            path: {
                'reportId': reportId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                401: `登录状态无效或已过期`,
                403: `只能撤回自己的报销单`,
                404: `报销单不存在`,
                409: `状态或版本冲突`,
            },
        });
    }
    /**
     * 管理员取消报销单
     * @returns FinanceExpenseReportResponseEnvelope 已取消的报销单
     * @throws ApiError
     */
    public static cancelFinanceExpenseReport({
        reportId,
        requestBody,
    }: {
        reportId: string,
        requestBody: FinanceExpenseActionRequest,
    }): CancelablePromise<FinanceExpenseReportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/finance/expense-reports/{reportId}/cancel',
            path: {
                'reportId': reportId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 finance.expense.manage_all 权限`,
                404: `报销单不存在`,
                409: `状态或版本冲突`,
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
    /**
     * 确认报销付款
     * @returns FinanceExpenseReportResponseEnvelope 已付款的报销单
     * @throws ApiError
     */
    public static markFinanceExpenseReportPaid({
        reportId,
        requestBody,
    }: {
        reportId: string,
        requestBody: MarkFinanceExpenseReportPaidRequest,
    }): CancelablePromise<FinanceExpenseReportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/finance/expense-reports/{reportId}/mark-paid',
            path: {
                'reportId': reportId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `付款信息校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 finance.expense.manage_all 权限`,
                404: `报销单不存在`,
                409: `状态或版本冲突`,
            },
        });
    }
    /**
     * 查询费用汇总
     * @returns FinanceExpenseSummaryResponseEnvelope 费用状态和类别汇总
     * @throws ApiError
     */
    public static getFinanceExpenseSummary({
        dateFrom,
        dateTo,
        departmentId,
        projectId,
        currency = 'CNY',
    }: {
        dateFrom: string,
        dateTo: string,
        departmentId?: string,
        projectId?: string,
        currency?: string,
    }): CancelablePromise<FinanceExpenseSummaryResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/finance/reports/expense-summary',
            query: {
                'dateFrom': dateFrom,
                'dateTo': dateTo,
                'departmentId': departmentId,
                'projectId': projectId,
                'currency': currency,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 finance.expense.read 权限或数据范围不足`,
            },
        });
    }
    /**
     * 查询项目支出聚合
     * @returns FinanceProjectSpendResponseEnvelope 项目已提交、已批准和已付款金额
     * @throws ApiError
     */
    public static getFinanceProjectSpend({
        projectId,
        dateFrom,
        dateTo,
        currency = 'CNY',
    }: {
        projectId: string,
        dateFrom?: string,
        dateTo?: string,
        currency?: string,
    }): CancelablePromise<FinanceProjectSpendResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/finance/reports/project-spend',
            query: {
                'projectId': projectId,
                'dateFrom': dateFrom,
                'dateTo': dateTo,
                'currency': currency,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 finance.expense.read 权限或项目数据范围不足`,
            },
        });
    }
}
