/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssignmentPolicyListResponseEnvelope } from '../models/AssignmentPolicyListResponseEnvelope';
import type { AssignmentPolicyResolveRequest } from '../models/AssignmentPolicyResolveRequest';
import type { AssignmentPolicyResolveResponseEnvelope } from '../models/AssignmentPolicyResolveResponseEnvelope';
import type { AssignmentPolicyResponseEnvelope } from '../models/AssignmentPolicyResponseEnvelope';
import type { CreateAssignmentPolicyRequest } from '../models/CreateAssignmentPolicyRequest';
import type { UpdateAssignmentPolicyRequest } from '../models/UpdateAssignmentPolicyRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AssignmentService {
    /**
     * 查询分配策略
     * @returns AssignmentPolicyListResponseEnvelope 分配策略列表
     * @throws ApiError
     */
    public static listAssignmentPolicies({
        domain,
        projectId,
        limit = 20,
        cursor,
    }: {
        domain?: string,
        projectId?: string,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<AssignmentPolicyListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/assignment/policies',
            query: {
                'domain': domain,
                'projectId': projectId,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 assignment.policy.read 权限`,
            },
        });
    }
    /**
     * 创建分配策略
     * @returns AssignmentPolicyResponseEnvelope 分配策略已创建
     * @throws ApiError
     */
    public static createAssignmentPolicy({
        requestBody,
    }: {
        requestBody: CreateAssignmentPolicyRequest,
    }): CancelablePromise<AssignmentPolicyResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/assignment/policies',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 assignment.policy.manage 权限`,
                409: `同一领域下已存在同层策略`,
            },
        });
    }
    /**
     * 查询分配策略详情
     * @returns AssignmentPolicyResponseEnvelope 分配策略详情
     * @throws ApiError
     */
    public static getAssignmentPolicy({
        policyId,
    }: {
        /**
         * 分配策略 ID
         */
        policyId: string,
    }): CancelablePromise<AssignmentPolicyResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/assignment/policies/{policyId}',
            path: {
                'policyId': policyId,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 assignment.policy.read 权限`,
                404: `分配策略不存在或不属于当前租户`,
            },
        });
    }
    /**
     * 修改分配策略
     * @returns AssignmentPolicyResponseEnvelope 修改后的分配策略
     * @throws ApiError
     */
    public static updateAssignmentPolicy({
        policyId,
        requestBody,
    }: {
        /**
         * 分配策略 ID
         */
        policyId: string,
        requestBody: UpdateAssignmentPolicyRequest,
    }): CancelablePromise<AssignmentPolicyResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/assignment/policies/{policyId}',
            path: {
                'policyId': policyId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 assignment.policy.manage 权限`,
                404: `分配策略不存在或不属于当前租户`,
                409: `乐观锁版本冲突`,
            },
        });
    }
    /**
     * 删除分配策略
     * @returns void
     * @throws ApiError
     */
    public static deleteAssignmentPolicy({
        policyId,
        version,
    }: {
        /**
         * 分配策略 ID
         */
        policyId: string,
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/assignment/policies/{policyId}',
            path: {
                'policyId': policyId,
            },
            query: {
                'version': version,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 assignment.policy.manage 权限`,
                404: `分配策略不存在或不属于当前租户`,
                409: `乐观锁版本冲突`,
            },
        });
    }
    /**
     * 预览分配策略命中结果
     * @returns AssignmentPolicyResolveResponseEnvelope 策略解析结果
     * @throws ApiError
     */
    public static resolveAssignmentPolicy({
        requestBody,
    }: {
        requestBody: AssignmentPolicyResolveRequest,
    }): CancelablePromise<AssignmentPolicyResolveResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/assignment/policies/resolve',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败或可用时间窗口无效（ASSIGNMENT_AVAILABILITY_WINDOW_INVALID）`,
                401: `登录状态无效或已过期`,
                403: `缺少 assignment.policy.read 权限`,
            },
        });
    }
}
