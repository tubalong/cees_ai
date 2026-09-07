/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MemberStatus } from '../models/MemberStatus';
import type { ReplaceTenantMemberRolesRequest } from '../models/ReplaceTenantMemberRolesRequest';
import type { TenantMemberListResponseEnvelope } from '../models/TenantMemberListResponseEnvelope';
import type { TenantMemberResponseEnvelope } from '../models/TenantMemberResponseEnvelope';
import type { TenantResponseEnvelope } from '../models/TenantResponseEnvelope';
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
                403: `缺少 member.update 权限`,
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
}
