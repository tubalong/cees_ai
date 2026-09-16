/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreateLegalContractRequest } from '../models/CreateLegalContractRequest';
import type { LegalContractListResponseEnvelope } from '../models/LegalContractListResponseEnvelope';
import type { LegalContractResponseEnvelope } from '../models/LegalContractResponseEnvelope';
import type { LegalContractStatus } from '../models/LegalContractStatus';
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
        limit = 20,
        cursor,
    }: {
        keyword?: string,
        status?: LegalContractStatus,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<LegalContractListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/legal/contracts',
            query: {
                'keyword': keyword,
                'status': status,
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
                409: `乐观锁版本冲突`,
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
                409: `乐观锁版本冲突`,
            },
        });
    }
}
