/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApplyDingTalkMappingRequest } from '../models/ApplyDingTalkMappingRequest';
import type { CreateDingTalkIntegrationRequest } from '../models/CreateDingTalkIntegrationRequest';
import type { DingTalkDepartmentListResponseEnvelope } from '../models/DingTalkDepartmentListResponseEnvelope';
import type { DingTalkIntegrationResponseEnvelope } from '../models/DingTalkIntegrationResponseEnvelope';
import type { DingTalkMappingPreviewResponseEnvelope } from '../models/DingTalkMappingPreviewResponseEnvelope';
import type { DingTalkMappingResponseEnvelope } from '../models/DingTalkMappingResponseEnvelope';
import type { DingTalkSyncJobListResponseEnvelope } from '../models/DingTalkSyncJobListResponseEnvelope';
import type { DingTalkSyncJobResponseEnvelope } from '../models/DingTalkSyncJobResponseEnvelope';
import type { DingTalkUserListResponseEnvelope } from '../models/DingTalkUserListResponseEnvelope';
import type { ImportDingTalkVisibleOrganizationSnapshotRequest } from '../models/ImportDingTalkVisibleOrganizationSnapshotRequest';
import type { PreviewDingTalkMappingRequest } from '../models/PreviewDingTalkMappingRequest';
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
     * 导入当前授权账号通过 DWS/MCP 获取的可见组织快照
     * 仅 CEES 当前租户的 tenant_admin 可调用。服务端不检查授权账号是否为钉钉管理员，
     * 只将快照视为当前钉钉账号可见范围并执行幂等合并；未出现在快照中的既有镜像不会被标记删除或离职。
     *
     * @returns DingTalkSyncJobResponseEnvelope 可见组织快照已合并
     * @throws ApiError
     */
    public static importDingTalkVisibleOrganizationSnapshot({
        requestBody,
    }: {
        requestBody: ImportDingTalkVisibleOrganizationSnapshotRequest,
    }): CancelablePromise<DingTalkSyncJobResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/dingtalk/organization/snapshot',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `快照字段、部门层级或人员引用无效`,
                401: `登录状态无效或已过期`,
                403: `当前用户不是 CEES 租户管理员或缺少 dingtalk.organization.sync 权限`,
                409: `当前已有同步任务或快照所属钉钉企业与当前绑定冲突`,
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
     * 预览钉钉组织映射
     * 按部门层级和人员姓名/部门生成安全映射方案，不修改正式租户数据。
     * @returns DingTalkMappingPreviewResponseEnvelope 映射预览
     * @throws ApiError
     */
    public static previewDingTalkOrganizationMapping({
        requestBody,
    }: {
        requestBody?: PreviewDingTalkMappingRequest,
    }): CancelablePromise<DingTalkMappingPreviewResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/dingtalk/organization/mapping/preview',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 dingtalk.organization.mapping.preview 权限`,
                404: `当前租户尚未绑定钉钉企业`,
            },
        });
    }
    /**
     * 应用钉钉组织映射
     * 应用自动匹配、人工冲突处理和缺失部门/成员创建；新成员激活凭证仅在本次响应返回。
     * @returns DingTalkMappingResponseEnvelope 映射已应用
     * @throws ApiError
     */
    public static applyDingTalkOrganizationMapping({
        requestBody,
    }: {
        requestBody: ApplyDingTalkMappingRequest,
    }): CancelablePromise<DingTalkMappingResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/dingtalk/organization/mapping/apply',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `映射参数无效或仍有未解决冲突`,
                401: `登录状态无效或已过期`,
                403: `缺少 dingtalk.organization.mapping.manage 权限`,
                404: `当前租户、部门或成员不存在`,
                409: `映射或账号已被其他请求修改`,
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
