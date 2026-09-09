/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AccountSuggestionRequest } from '../models/AccountSuggestionRequest';
import type { AccountSuggestionResponseEnvelope } from '../models/AccountSuggestionResponseEnvelope';
import type { CreateTenantInvitationRequest } from '../models/CreateTenantInvitationRequest';
import type { MemberStatus } from '../models/MemberStatus';
import type { ReplaceTenantMemberRolesRequest } from '../models/ReplaceTenantMemberRolesRequest';
import type { TenantInvitationCreatedResponseEnvelope } from '../models/TenantInvitationCreatedResponseEnvelope';
import type { TenantInvitationListResponseEnvelope } from '../models/TenantInvitationListResponseEnvelope';
import type { TenantInvitationStatus } from '../models/TenantInvitationStatus';
import type { TenantMemberListResponseEnvelope } from '../models/TenantMemberListResponseEnvelope';
import type { TenantMemberResponseEnvelope } from '../models/TenantMemberResponseEnvelope';
import type { TenantResponseEnvelope } from '../models/TenantResponseEnvelope';
import type { UpdateTenantMemberAccountRequest } from '../models/UpdateTenantMemberAccountRequest';
import type { UpdateTenantMemberRequest } from '../models/UpdateTenantMemberRequest';
import type { UpdateTenantRequest } from '../models/UpdateTenantRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class TenantService {
    /**
     * 获取当前租户
     * @returns TenantResponseEnvelope 当前租户
     * @throws ApiError
     */
    public static tenantGetCurrent(): CancelablePromise<TenantResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tenants/current',
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 tenant.read 权限`,
            },
        });
    }
    /**
     * 修改当前租户
     * @returns TenantResponseEnvelope 修改后的租户
     * @throws ApiError
     */
    public static tenantUpdateCurrent({
        requestBody,
    }: {
        requestBody: UpdateTenantRequest,
    }): CancelablePromise<TenantResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/tenants/current',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 tenant.update 权限`,
                409: `版本冲突`,
            },
        });
    }
    /**
     * 查询当前租户成员
     * @returns TenantMemberListResponseEnvelope 当前租户成员列表
     * @throws ApiError
     */
    public static tenantListMembers({
        keyword,
        status,
        roleId,
        limit = 20,
        cursor,
    }: {
        keyword?: string,
        status?: MemberStatus,
        roleId?: string,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<TenantMemberListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tenants/current/members',
            query: {
                'keyword': keyword,
                'status': status,
                'roleId': roleId,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                400: `查询参数校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 member.read 权限`,
            },
        });
    }
    /**
     * 获取当前租户成员详情
     * @returns TenantMemberResponseEnvelope 成员详情
     * @throws ApiError
     */
    public static tenantGetMember({
        membershipId,
    }: {
        membershipId: string,
    }): CancelablePromise<TenantMemberResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tenants/current/members/{membershipId}',
            path: {
                'membershipId': membershipId,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 member.read 权限`,
                404: `当前租户内成员不存在`,
            },
        });
    }
    /**
     * 修改当前租户成员
     * @returns TenantMemberResponseEnvelope 修改后的成员
     * @throws ApiError
     */
    public static tenantUpdateMember({
        membershipId,
        requestBody,
    }: {
        membershipId: string,
        requestBody: UpdateTenantMemberRequest,
    }): CancelablePromise<TenantMemberResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/tenants/current/members/{membershipId}',
            path: {
                'membershipId': membershipId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 member.update 或 department.member.assign 权限`,
                404: `当前租户内成员或部门不存在`,
                409: `最后一名管理员、自操作或版本冲突`,
            },
        });
    }
    /**
     * 移除当前租户成员
     * @returns void
     * @throws ApiError
     */
    public static tenantRemoveMember({
        membershipId,
    }: {
        membershipId: string,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/tenants/current/members/{membershipId}',
            path: {
                'membershipId': membershipId,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 member.remove 权限`,
                404: `当前租户内成员不存在`,
                409: `不能移除自己或最后一名管理员`,
            },
        });
    }
    /**
     * 替换当前租户成员的角色集合
     * @returns TenantMemberResponseEnvelope 更新角色后的成员
     * @throws ApiError
     */
    public static tenantReplaceMemberRoles({
        membershipId,
        requestBody,
    }: {
        membershipId: string,
        requestBody: ReplaceTenantMemberRolesRequest,
    }): CancelablePromise<TenantMemberResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/tenants/current/members/{membershipId}/roles',
            path: {
                'membershipId': membershipId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 role.assign 权限`,
                404: `当前租户内成员或角色不存在`,
                409: `最后一名管理员或版本冲突`,
            },
        });
    }
    /**
     * 根据成员姓名生成当前租户可用账号建议
     * @returns AccountSuggestionResponseEnvelope 账号建议
     * @throws ApiError
     */
    public static tenantSuggestAccount({
        requestBody,
    }: {
        requestBody: AccountSuggestionRequest,
    }): CancelablePromise<AccountSuggestionResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tenants/current/account-suggestions',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * 修改租户成员登录账号并撤销其现有会话
     * @returns TenantMemberResponseEnvelope 修改账号后的成员
     * @throws ApiError
     */
    public static tenantUpdateMemberAccount({
        membershipId,
        requestBody,
    }: {
        membershipId: string,
        requestBody: UpdateTenantMemberAccountRequest,
    }): CancelablePromise<TenantMemberResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/tenants/current/members/{membershipId}/account',
            path: {
                'membershipId': membershipId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `账号已存在或版本冲突`,
            },
        });
    }
    /**
     * 重置租户成员凭证并签发一次性激活令牌
     * @returns TenantInvitationCreatedResponseEnvelope 凭证重置成功；激活令牌只在本次响应返回
     * @throws ApiError
     */
    public static tenantResetMemberCredential({
        membershipId,
    }: {
        membershipId: string,
    }): CancelablePromise<TenantInvitationCreatedResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tenants/current/members/{membershipId}/credential-reset',
            path: {
                'membershipId': membershipId,
            },
            errors: {
                409: `不能重置自己或最后一名有效管理员`,
            },
        });
    }
    /**
     * 查询当前租户成员邀请
     * @returns TenantInvitationListResponseEnvelope 当前租户邀请列表
     * @throws ApiError
     */
    public static tenantInvitationList({
        status,
        limit = 20,
        cursor,
    }: {
        status?: TenantInvitationStatus,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<TenantInvitationListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tenants/current/invitations',
            query: {
                'status': status,
                'limit': limit,
                'cursor': cursor,
            },
        });
    }
    /**
     * 邀请成员加入当前租户
     * @returns TenantInvitationCreatedResponseEnvelope 邀请已创建；令牌只在本次响应返回
     * @throws ApiError
     */
    public static tenantInvitationCreate({
        requestBody,
    }: {
        requestBody: CreateTenantInvitationRequest,
    }): CancelablePromise<TenantInvitationCreatedResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tenants/current/invitations',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `用户已是成员或已存在有效邀请`,
            },
        });
    }
    /**
     * 撤销当前租户成员邀请
     * @returns void
     * @throws ApiError
     */
    public static tenantInvitationRevoke({
        invitationId,
    }: {
        invitationId: string,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/tenants/current/invitations/{invitationId}',
            path: {
                'invitationId': invitationId,
            },
        });
    }
}
