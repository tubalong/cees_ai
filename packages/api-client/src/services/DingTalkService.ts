/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreateDingTalkIntegrationRequest } from '../models/CreateDingTalkIntegrationRequest';
import type { DingTalkDepartmentListResponseEnvelope } from '../models/DingTalkDepartmentListResponseEnvelope';
import type { DingTalkIntegrationResponseEnvelope } from '../models/DingTalkIntegrationResponseEnvelope';
import type { DingTalkSyncJobListResponseEnvelope } from '../models/DingTalkSyncJobListResponseEnvelope';
import type { DingTalkSyncJobResponseEnvelope } from '../models/DingTalkSyncJobResponseEnvelope';
import type { DingTalkUserListResponseEnvelope } from '../models/DingTalkUserListResponseEnvelope';
import type { UpdateDingTalkIntegrationRequest } from '../models/UpdateDingTalkIntegrationRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class DingTalkService {
    /**
     * 查询当前租户钉钉企业绑定
     * @returns DingTalkIntegrationResponseEnvelope 钉钉企业绑定
     * @throws ApiError
     */
    public static getDingTalkIntegration(): CancelablePromise<DingTalkIntegrationResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/dingtalk/integration',
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 dingtalk.integration.read 权限`,
                404: `当前租户尚未绑定钉钉企业`,
            },
        });
    }
    /**
     * 创建当前租户钉钉企业绑定
     * @returns DingTalkIntegrationResponseEnvelope 钉钉企业绑定已创建
     * @throws ApiError
     */
    public static createDingTalkIntegration({
        requestBody,
    }: {
        requestBody: CreateDingTalkIntegrationRequest,
    }): CancelablePromise<DingTalkIntegrationResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/dingtalk/integration',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 dingtalk.integration.manage 权限`,
                409: `当前租户或钉钉企业已经存在绑定`,
            },
        });
    }
    /**
     * 修改当前租户钉钉企业绑定
     * @returns DingTalkIntegrationResponseEnvelope 钉钉企业绑定已修改
     * @throws ApiError
     */
    public static updateDingTalkIntegration({
        requestBody,
    }: {
        requestBody: UpdateDingTalkIntegrationRequest,
    }): CancelablePromise<DingTalkIntegrationResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/dingtalk/integration',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 dingtalk.integration.manage 权限`,
                404: `当前租户尚未绑定钉钉企业`,
                409: `version 与服务端当前版本不一致`,
            },
        });
    }
    /**
     * 验证当前租户钉钉应用凭证
     * @returns DingTalkIntegrationResponseEnvelope 凭证验证成功
     * @throws ApiError
     */
    public static verifyDingTalkIntegration(): CancelablePromise<DingTalkIntegrationResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/dingtalk/integration/verify',
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 dingtalk.integration.manage 权限`,
                404: `当前租户尚未绑定钉钉企业`,
                502: `钉钉开放平台凭证验证失败`,
            },
        });
    }
    /**
     * 同步钉钉组织架构和人员
     * 全量拉取钉钉部门和人员并保存为当前租户的外部镜像；不会自动创建 CEES 登录账号。
     * @returns DingTalkSyncJobResponseEnvelope 同步完成
     * @throws ApiError
     */
    public static syncDingTalkOrganization(): CancelablePromise<DingTalkSyncJobResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/dingtalk/organization/sync',
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 dingtalk.organization.sync 权限`,
                404: `当前租户尚未绑定钉钉企业`,
                409: `当前集成已有同步任务运行中`,
                502: `钉钉开放平台同步失败`,
            },
        });
    }
    /**
     * 查询钉钉部门镜像
     * @returns DingTalkDepartmentListResponseEnvelope 钉钉部门镜像列表
     * @throws ApiError
     */
    public static listDingTalkDepartments({
        limit = 50,
        cursor,
        includeDeleted = false,
    }: {
        limit?: number,
        cursor?: string,
        /**
         * 是否包含已从钉钉组织中删除的部门
         */
        includeDeleted?: boolean,
    }): CancelablePromise<DingTalkDepartmentListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/dingtalk/organization/departments',
            query: {
                'limit': limit,
                'cursor': cursor,
                'includeDeleted': includeDeleted,
            },
            errors: {
                400: `分页参数无效`,
                401: `登录状态无效或已过期`,
                403: `缺少 dingtalk.organization.read 权限`,
                404: `当前租户尚未绑定钉钉企业`,
            },
        });
    }
    /**
     * 查询钉钉人员镜像
     * @returns DingTalkUserListResponseEnvelope 钉钉人员镜像列表
     * @throws ApiError
     */
    public static listDingTalkUsers({
        limit = 50,
        cursor,
        includeDeleted = false,
    }: {
        limit?: number,
        cursor?: string,
        /**
         * 是否包含已离职或已从钉钉组织中删除的人员
         */
        includeDeleted?: boolean,
    }): CancelablePromise<DingTalkUserListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/dingtalk/organization/users',
            query: {
                'limit': limit,
                'cursor': cursor,
                'includeDeleted': includeDeleted,
            },
            errors: {
                400: `分页参数无效`,
                401: `登录状态无效或已过期`,
                403: `缺少 dingtalk.organization.read 权限`,
                404: `当前租户尚未绑定钉钉企业`,
            },
        });
    }
    /**
     * 查询钉钉同步任务
     * @returns DingTalkSyncJobListResponseEnvelope 钉钉同步任务列表
     * @throws ApiError
     */
    public static listDingTalkSyncJobs({
        limit = 20,
        cursor,
    }: {
        limit?: number,
        cursor?: string,
    }): CancelablePromise<DingTalkSyncJobListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/dingtalk/sync-jobs',
            query: {
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                400: `分页参数无效`,
                401: `登录状态无效或已过期`,
                403: `缺少 dingtalk.integration.read 权限`,
                404: `当前租户尚未绑定钉钉企业`,
            },
        });
    }
}
