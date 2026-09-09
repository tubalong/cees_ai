/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssignTenantMemberDepartmentRequest } from '../models/AssignTenantMemberDepartmentRequest';
import type { CreateDepartmentRequest } from '../models/CreateDepartmentRequest';
import type { DepartmentResponseEnvelope } from '../models/DepartmentResponseEnvelope';
import type { DepartmentStatus } from '../models/DepartmentStatus';
import type { DepartmentTreeResponseEnvelope } from '../models/DepartmentTreeResponseEnvelope';
import type { MemberStatus } from '../models/MemberStatus';
import type { OrganizationImportRequest } from '../models/OrganizationImportRequest';
import type { OrganizationImportResultResponseEnvelope } from '../models/OrganizationImportResultResponseEnvelope';
import type { OrganizationImportValidationResponseEnvelope } from '../models/OrganizationImportValidationResponseEnvelope';
import type { TenantMemberListResponseEnvelope } from '../models/TenantMemberListResponseEnvelope';
import type { TenantMemberResponseEnvelope } from '../models/TenantMemberResponseEnvelope';
import type { UpdateDepartmentRequest } from '../models/UpdateDepartmentRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class OrganizationService {
    /**
     * 查询当前租户部门树
     * @returns DepartmentTreeResponseEnvelope 当前租户部门树
     * @throws ApiError
     */
    public static departmentListTree({
        status,
    }: {
        status?: DepartmentStatus,
    }): CancelablePromise<DepartmentTreeResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tenants/current/departments',
            query: {
                'status': status,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 department.read 权限`,
            },
        });
    }
    /**
     * 创建当前租户部门
     * @returns DepartmentResponseEnvelope 已创建部门
     * @throws ApiError
     */
    public static departmentCreate({
        requestBody,
    }: {
        requestBody: CreateDepartmentRequest,
    }): CancelablePromise<DepartmentResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tenants/current/departments',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段或部门层级无效`,
                401: `登录状态无效或已过期`,
                403: `缺少 department.create 权限`,
                404: `父部门不存在`,
                409: `同级部门名称冲突`,
            },
        });
    }
    /**
     * 校验组织架构和成员批量导入数据
     * 不写入正式业务数据，返回部门复用或创建预览、成员有效角色及逐项校验问题。
     * @returns OrganizationImportValidationResponseEnvelope 批量导入校验结果；业务数据无效时 valid 为 false
     * @throws ApiError
     */
    public static organizationImportValidate({
        requestBody,
    }: {
        requestBody: OrganizationImportRequest,
    }): CancelablePromise<OrganizationImportValidationResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tenants/current/organization-imports/validate',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求结构、数组数量或字段格式无效`,
                401: `登录状态无效或已过期`,
                403: `缺少 department.create、member.invite 或 role.assign 权限`,
            },
        });
    }
    /**
     * 确认导入组织架构和成员
     * 在可串行化事务中重新校验并创建部门、待激活成员、角色关系和一次性激活凭证。
     * @returns OrganizationImportResultResponseEnvelope 已完成批量导入；激活令牌只在本次响应返回
     * @throws ApiError
     */
    public static organizationImportConfirm({
        requestBody,
    }: {
        requestBody: OrganizationImportRequest,
    }): CancelablePromise<OrganizationImportResultResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tenants/current/organization-imports/confirm',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `批量数据校验失败，details 返回逐项问题`,
                401: `登录状态无效或已过期`,
                403: `缺少 department.create、member.invite 或 role.assign 权限，或尝试批量分配租户管理员角色`,
                409: `并发导入导致部门或账号冲突`,
            },
        });
    }
    /**
     * 获取当前租户部门详情
     * @returns DepartmentResponseEnvelope 部门详情
     * @throws ApiError
     */
    public static departmentGet({
        departmentId,
    }: {
        departmentId: string,
    }): CancelablePromise<DepartmentResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tenants/current/departments/{departmentId}',
            path: {
                'departmentId': departmentId,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 department.read 权限`,
                404: `当前租户内部门不存在`,
            },
        });
    }
    /**
     * 修改当前租户部门
     * @returns DepartmentResponseEnvelope 修改后的部门
     * @throws ApiError
     */
    public static departmentUpdate({
        departmentId,
        requestBody,
    }: {
        departmentId: string,
        requestBody: UpdateDepartmentRequest,
    }): CancelablePromise<DepartmentResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/tenants/current/departments/{departmentId}',
            path: {
                'departmentId': departmentId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段、父子关系或部门层级无效`,
                401: `登录状态无效或已过期`,
                403: `缺少 department.update 权限`,
                404: `当前部门或父部门不存在`,
                409: `版本或同级部门名称冲突`,
            },
        });
    }
    /**
     * 删除当前租户部门
     * @returns void
     * @throws ApiError
     */
    public static departmentDelete({
        departmentId,
        version,
    }: {
        departmentId: string,
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/tenants/current/departments/{departmentId}',
            path: {
                'departmentId': departmentId,
            },
            query: {
                'version': version,
            },
            errors: {
                400: `版本参数无效`,
                401: `登录状态无效或已过期`,
                403: `缺少 department.delete 权限`,
                404: `当前租户内部门不存在`,
                409: `版本冲突或部门仍有子部门、成员`,
            },
        });
    }
    /**
     * 查询当前租户部门成员
     * @returns TenantMemberListResponseEnvelope 当前部门成员列表
     * @throws ApiError
     */
    public static departmentListMembers({
        departmentId,
        keyword,
        status,
        limit = 20,
        cursor,
    }: {
        departmentId: string,
        keyword?: string,
        status?: MemberStatus,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<TenantMemberListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tenants/current/departments/{departmentId}/members',
            path: {
                'departmentId': departmentId,
            },
            query: {
                'keyword': keyword,
                'status': status,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                400: `查询参数校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 department.read 或 member.read 权限`,
                404: `当前租户内部门不存在`,
            },
        });
    }
    /**
     * 调整当前租户成员部门
     * @returns TenantMemberResponseEnvelope 调整部门后的成员
     * @throws ApiError
     */
    public static departmentAssignMember({
        membershipId,
        requestBody,
    }: {
        membershipId: string,
        requestBody: AssignTenantMemberDepartmentRequest,
    }): CancelablePromise<TenantMemberResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/tenants/current/members/{membershipId}/department',
            path: {
                'membershipId': membershipId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败或目标部门已停用`,
                401: `登录状态无效或已过期`,
                403: `缺少 department.member.assign 权限`,
                404: `当前租户内成员或部门不存在`,
                409: `成员版本冲突`,
            },
        });
    }
}
