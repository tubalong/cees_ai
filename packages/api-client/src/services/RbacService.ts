/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreateRoleRequest } from '../models/CreateRoleRequest';
import type { PermissionListResponseEnvelope } from '../models/PermissionListResponseEnvelope';
import type { ReplaceRolePermissionsRequest } from '../models/ReplaceRolePermissionsRequest';
import type { RoleListResponseEnvelope } from '../models/RoleListResponseEnvelope';
import type { RoleResponseEnvelope } from '../models/RoleResponseEnvelope';
import type { UpdateRoleRequest } from '../models/UpdateRoleRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class RbacService {
    /**
     * 获取平台预置权限目录
     * @returns PermissionListResponseEnvelope 权限目录
     * @throws ApiError
     */
    public static rbacListPermissions(): CancelablePromise<PermissionListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/permissions',
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 role.read 权限`,
            },
        });
    }
    /**
     * 获取当前租户角色列表
     * @returns RoleListResponseEnvelope 当前租户角色列表
     * @throws ApiError
     */
    public static rbacListRoles({
        keyword,
        limit = 20,
        cursor,
    }: {
        keyword?: string,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<RoleListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/roles',
            query: {
                'keyword': keyword,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 role.read 权限`,
            },
        });
    }
    /**
     * 创建当前租户角色
     * @returns RoleResponseEnvelope 已创建角色
     * @throws ApiError
     */
    public static rbacCreateRole({
        requestBody,
    }: {
        requestBody: CreateRoleRequest,
    }): CancelablePromise<RoleResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/roles',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 role.create 权限`,
                409: `角色编码已存在`,
            },
        });
    }
    /**
     * 获取当前租户角色详情
     * @returns RoleResponseEnvelope 角色详情
     * @throws ApiError
     */
    public static rbacGetRole({
        roleId,
    }: {
        roleId: string,
    }): CancelablePromise<RoleResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/roles/{roleId}',
            path: {
                'roleId': roleId,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 role.read 权限`,
                404: `当前租户内角色不存在`,
            },
        });
    }
    /**
     * 修改当前租户角色
     * @returns RoleResponseEnvelope 修改后的角色
     * @throws ApiError
     */
    public static rbacUpdateRole({
        roleId,
        requestBody,
    }: {
        roleId: string,
        requestBody: UpdateRoleRequest,
    }): CancelablePromise<RoleResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/roles/{roleId}',
            path: {
                'roleId': roleId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 role.update 权限`,
                404: `当前租户内角色不存在`,
                409: `系统角色不可修改或版本冲突`,
            },
        });
    }
    /**
     * 删除当前租户角色
     * @returns void
     * @throws ApiError
     */
    public static rbacDeleteRole({
        roleId,
        version,
    }: {
        roleId: string,
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/roles/{roleId}',
            path: {
                'roleId': roleId,
            },
            query: {
                'version': version,
            },
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 role.delete 权限`,
                404: `当前租户内角色不存在`,
                409: `系统角色、角色正在使用或版本冲突`,
            },
        });
    }
    /**
     * 替换当前租户角色权限集合
     * @returns RoleResponseEnvelope 权限替换后的角色
     * @throws ApiError
     */
    public static rbacReplaceRolePermissions({
        roleId,
        requestBody,
    }: {
        roleId: string,
        requestBody: ReplaceRolePermissionsRequest,
    }): CancelablePromise<RoleResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/roles/{roleId}/permissions',
            path: {
                'roleId': roleId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 role.update 权限`,
                404: `当前租户内角色或权限不存在`,
                409: `系统角色不可修改或版本冲突`,
            },
        });
    }
}
