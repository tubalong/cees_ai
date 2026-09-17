/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreateLegalContractRequest } from '../models/CreateLegalContractRequest';
import type { LegalContractActionRequest } from '../models/LegalContractActionRequest';
import type { LegalContractListResponseEnvelope } from '../models/LegalContractListResponseEnvelope';
import type { LegalContractResponseEnvelope } from '../models/LegalContractResponseEnvelope';
import type { LegalContractStatus } from '../models/LegalContractStatus';
import type { LegalContractSummaryResponseEnvelope } from '../models/LegalContractSummaryResponseEnvelope';
import type { LegalContractType } from '../models/LegalContractType';
import type { RenewLegalContractRequest } from '../models/RenewLegalContractRequest';
import type { TerminateLegalContractRequest } from '../models/TerminateLegalContractRequest';
import type { UpdateLegalContractRequest } from '../models/UpdateLegalContractRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class LegalService {
    /**
     * 查询合同台账
     * @returns LegalContractListResponseEnvelope 合同台账列表
     * @throws ApiError
     */
    public static listLegalContracts({
        keyword,
        status,
        type,
        ownerMembershipId,
        departmentId,
        projectId,
        currency,
        endDateFrom,
        endDateTo,
        expiringWithinDays,
        limit = 20,
        cursor,
    }: {
        keyword?: string,
        status?: LegalContractStatus,
        type?: LegalContractType,
        ownerMembershipId?: string,
        departmentId?: string,
        projectId?: string,
        currency?: string,
        endDateFrom?: string,
        endDateTo?: string,
        /**
         * 仅返回截至当前租户日期未来指定天数内到期的 ACTIVE 或 PENDING_RENEWAL 合同
         */
        expiringWithinDays?: number,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<LegalContractListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/legal/contracts',
            query: {
                'keyword': keyword,
                'status': status,
                'type': type,
                'ownerMembershipId': ownerMembershipId,
                'departmentId': departmentId,
                'projectId': projectId,
                'currency': currency,
                'endDateFrom': endDateFrom,
                'endDateTo': endDateTo,
                'expiringWithinDays': expiringWithinDays,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 legal.contract.read 权限或数据范围不足`,
            },
        });
    }
    /**
     * 创建合同台账
     * @returns LegalContractResponseEnvelope 合同台账已创建
     * @throws ApiError
     */
    public static createLegalContract({
        requestBody,
    }: {
        requestBody: CreateLegalContractRequest,
    }): CancelablePromise<LegalContractResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/legal/contracts',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 legal.contract.create 权限`,
                409: `当前租户合同编号已存在`,
            },
        });
    }
    /**
     * 查询合同详情
     * @returns LegalContractResponseEnvelope 合同详情
     * @throws ApiError
     */
    public static getLegalContract({
        contractId,
    }: {
        /**
         * 合同 ID
         */
        contractId: string,
    }): CancelablePromise<LegalContractResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/legal/contracts/{contractId}',
            path: {
                'contractId': contractId,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 legal.contract.read 权限或数据范围不足`,
                404: `合同不存在或不属于当前租户`,
            },
        });
    }
    /**
     * 修改合同台账
     * @returns LegalContractResponseEnvelope 修改后的合同台账
     * @throws ApiError
     */
    public static updateLegalContract({
        contractId,
        requestBody,
    }: {
        /**
         * 合同 ID
         */
        contractId: string,
        requestBody: UpdateLegalContractRequest,
    }): CancelablePromise<LegalContractResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/legal/contracts/{contractId}',
            path: {
                'contractId': contractId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 legal.contract.update 权限或数据范围不足`,
                404: `合同不存在或不属于当前租户`,
                409: `合同编号、合同状态、乐观锁版本冲突，或非草稿合同提交仅草稿可改字段（编号、名称、对方、类型、金额、币种和日期字段）`,
            },
        });
    }
    /**
     * 删除合同台账
     * @returns void
     * @throws ApiError
     */
    public static deleteLegalContract({
        contractId,
        version,
    }: {
        /**
         * 合同 ID
         */
        contractId: string,
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/legal/contracts/{contractId}',
            path: {
                'contractId': contractId,
            },
            query: {
                'version': version,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 legal.contract.delete 权限或数据范围不足`,
                404: `合同不存在或不属于当前租户`,
                409: `仅草稿合同可删除，或乐观锁版本冲突`,
            },
        });
    }
    /**
     * 激活草稿合同
     * @returns LegalContractResponseEnvelope 已激活的合同
     * @throws ApiError
     */
    public static activateLegalContract({
        contractId,
        requestBody,
    }: {
        contractId: string,
        requestBody: LegalContractActionRequest,
    }): CancelablePromise<LegalContractResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/legal/contracts/{contractId}/activate',
            path: {
                'contractId': contractId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `合同缺少签署日期或关联资源校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 legal.contract.update 权限或数据范围不足`,
                404: `合同不存在或不属于当前租户`,
                409: `合同状态或乐观锁版本冲突`,
            },
        });
    }
    /**
     * 标记合同待续签
     * @returns LegalContractResponseEnvelope 已标记待续签的合同
     * @throws ApiError
     */
    public static markLegalContractPendingRenewal({
        contractId,
        requestBody,
    }: {
        contractId: string,
        requestBody: LegalContractActionRequest,
    }): CancelablePromise<LegalContractResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/legal/contracts/{contractId}/mark-pending-renewal',
            path: {
                'contractId': contractId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 legal.contract.update 权限或数据范围不足`,
                404: `合同不存在或不属于当前租户`,
                409: `合同状态或乐观锁版本冲突`,
            },
        });
    }
    /**
     * 续签合同并恢复生效
     * @returns LegalContractResponseEnvelope 已续签的合同
     * @throws ApiError
     */
    public static renewLegalContract({
        contractId,
        requestBody,
    }: {
        contractId: string,
        requestBody: RenewLegalContractRequest,
    }): CancelablePromise<LegalContractResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/legal/contracts/{contractId}/renew',
            path: {
                'contractId': contractId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `新到期日期或请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 legal.contract.update 权限或数据范围不足`,
                404: `合同不存在或不属于当前租户`,
                409: `合同状态或乐观锁版本冲突`,
            },
        });
    }
    /**
     * 提前终止合同
     * @returns LegalContractResponseEnvelope 已终止的合同
     * @throws ApiError
     */
    public static terminateLegalContract({
        contractId,
        requestBody,
    }: {
        contractId: string,
        requestBody: TerminateLegalContractRequest,
    }): CancelablePromise<LegalContractResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/legal/contracts/{contractId}/terminate',
            path: {
                'contractId': contractId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `终止日期或原因校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 legal.contract.update 权限或数据范围不足`,
                404: `合同不存在或不属于当前租户`,
                409: `合同状态或乐观锁版本冲突`,
            },
        });
    }
    /**
     * 归档已到期或已终止合同
     * @returns LegalContractResponseEnvelope 已归档的合同
     * @throws ApiError
     */
    public static archiveLegalContract({
        contractId,
        requestBody,
    }: {
        contractId: string,
        requestBody: LegalContractActionRequest,
    }): CancelablePromise<LegalContractResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/legal/contracts/{contractId}/archive',
            path: {
                'contractId': contractId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 legal.contract.update 权限或数据范围不足`,
                404: `合同不存在或不属于当前租户`,
                409: `合同状态或乐观锁版本冲突`,
            },
        });
    }
    /**
     * 查询合同台账汇总
     * @returns LegalContractSummaryResponseEnvelope 当前数据范围内的合同汇总
     * @throws ApiError
     */
    public static getLegalContractSummary({
        asOf,
        expiringWithinDays = 30,
    }: {
        /**
         * 统计基准日期；未传时使用当前租户日期
         */
        asOf?: string,
        expiringWithinDays?: number,
    }): CancelablePromise<LegalContractSummaryResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/legal/reports/contract-summary',
            query: {
                'asOf': asOf,
                'expiringWithinDays': expiringWithinDays,
            },
            errors: {
                400: `统计日期或到期窗口校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 legal.contract.read 权限或数据范围不足`,
            },
        });
    }
}
