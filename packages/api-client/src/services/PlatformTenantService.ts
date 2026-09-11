/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssignPlatformTenantAdministratorRequest } from '../models/AssignPlatformTenantAdministratorRequest';
import type { CreatePlatformTenantRequest } from '../models/CreatePlatformTenantRequest';
import type { PlatformTenantAdministratorAssignmentResponseEnvelope } from '../models/PlatformTenantAdministratorAssignmentResponseEnvelope';
import type { PlatformTenantAdministratorListResponseEnvelope } from '../models/PlatformTenantAdministratorListResponseEnvelope';
import type { PlatformTenantListResponseEnvelope } from '../models/PlatformTenantListResponseEnvelope';
import type { PlatformTenantProvisioningResponseEnvelope } from '../models/PlatformTenantProvisioningResponseEnvelope';
import type { PlatformTenantResponseEnvelope } from '../models/PlatformTenantResponseEnvelope';
import type { SuspendPlatformTenantRequest } from '../models/SuspendPlatformTenantRequest';
import type { TenantInvitationCreatedResponseEnvelope } from '../models/TenantInvitationCreatedResponseEnvelope';
import type { TenantStatus } from '../models/TenantStatus';
import type { UpdatePlatformTenantRequest } from '../models/UpdatePlatformTenantRequest';
import type { VersionRequest } from '../models/VersionRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class PlatformTenantService {
    /**
     * 查询平台租户列表
     * @returns PlatformTenantListResponseEnvelope 平台租户列表
     * @throws ApiError
     */
    public static platformTenantList({
        keyword,
        status,
        limit = 20,
        cursor,
    }: {
        keyword?: string,
        status?: TenantStatus,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<PlatformTenantListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/platform/tenants',
            query: {
                'keyword': keyword,
                'status': status,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                403: `缺少平台租户读取权限`,
            },
        });
    }
    /**
     * 创建租户并设置首位租户管理员
     * @returns PlatformTenantProvisioningResponseEnvelope 租户创建并完成初始化
     * @throws ApiError
     */
    public static platformTenantCreate({
        requestBody,
    }: {
        requestBody: CreatePlatformTenantRequest,
    }): CancelablePromise<PlatformTenantProvisioningResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/platform/tenants',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `租户编码或管理员关系冲突`,
            },
        });
    }
    /**
     * 获取平台租户详情
     * @returns PlatformTenantResponseEnvelope 平台租户详情
     * @throws ApiError
     */
    public static platformTenantGet({
        tenantId,
    }: {
        tenantId: string,
    }): CancelablePromise<PlatformTenantResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/platform/tenants/{tenantId}',
            path: {
                'tenantId': tenantId,
            },
            errors: {
                404: `租户不存在`,
            },
        });
    }
    /**
     * 修改平台租户资料
     * @returns PlatformTenantResponseEnvelope 修改后的平台租户
     * @throws ApiError
     */
    public static platformTenantUpdate({
        tenantId,
        requestBody,
    }: {
        tenantId: string,
        requestBody: UpdatePlatformTenantRequest,
    }): CancelablePromise<PlatformTenantResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/platform/tenants/{tenantId}',
            path: {
                'tenantId': tenantId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `乐观锁版本冲突`,
            },
        });
    }
    /**
     * 停用租户并撤销全部租户会话
     * @returns PlatformTenantResponseEnvelope 已停用的租户
     * @throws ApiError
     */
    public static platformTenantSuspend({
        tenantId,
        requestBody,
    }: {
        tenantId: string,
        requestBody: SuspendPlatformTenantRequest,
    }): CancelablePromise<PlatformTenantResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/platform/tenants/{tenantId}/suspend',
            path: {
                'tenantId': tenantId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * 恢复租户
     * @returns PlatformTenantResponseEnvelope 已恢复的租户
     * @throws ApiError
     */
    public static platformTenantRestore({
        tenantId,
        requestBody,
    }: {
        tenantId: string,
        requestBody: VersionRequest,
    }): CancelablePromise<PlatformTenantResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/platform/tenants/{tenantId}/restore',
            path: {
                'tenantId': tenantId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `租户尚无有效管理员或版本冲突`,
            },
        });
    }
    /**
     * 查询租户管理员
     * @returns PlatformTenantAdministratorListResponseEnvelope 租户管理员列表
     * @throws ApiError
     */
    public static platformTenantListAdministrators({
        tenantId,
    }: {
        tenantId: string,
    }): CancelablePromise<PlatformTenantAdministratorListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/platform/tenants/{tenantId}/administrators',
            path: {
                'tenantId': tenantId,
            },
        });
    }
    /**
     * 设置租户管理员
     * @returns PlatformTenantAdministratorAssignmentResponseEnvelope 已设置管理员或创建管理员邀请
     * @throws ApiError
     */
    public static platformTenantAssignAdministrator({
        tenantId,
        requestBody,
    }: {
        tenantId: string,
        requestBody: AssignPlatformTenantAdministratorRequest,
    }): CancelablePromise<PlatformTenantAdministratorAssignmentResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/platform/tenants/{tenantId}/administrators',
            path: {
                'tenantId': tenantId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * 取消租户管理员角色
     * @returns void
     * @throws ApiError
     */
    public static platformTenantRemoveAdministrator({
        tenantId,
        membershipId,
    }: {
        tenantId: string,
        membershipId: string,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/platform/tenants/{tenantId}/administrators/{membershipId}',
            path: {
                'tenantId': tenantId,
                'membershipId': membershipId,
            },
            errors: {
                409: `不能移除最后一名有效租户管理员`,
            },
        });
    }
    /**
     * 重置租户管理员凭证并签发一次性激活令牌
     * @returns TenantInvitationCreatedResponseEnvelope 凭证已重置；激活令牌只在本次响应返回
     * @throws ApiError
     */
    public static platformTenantResetAdministratorCredential({
        tenantId,
        membershipId,
    }: {
        tenantId: string,
        membershipId: string,
    }): CancelablePromise<TenantInvitationCreatedResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/platform/tenants/{tenantId}/administrators/{membershipId}/credential-reset',
            path: {
                'tenantId': tenantId,
                'membershipId': membershipId,
            },
            errors: {
                404: `租户或租户管理员不存在`,
            },
        });
    }
}
