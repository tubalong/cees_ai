/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreateResourceAclRequest } from '../models/CreateResourceAclRequest';
import type { ResourceAclListResponseEnvelope } from '../models/ResourceAclListResponseEnvelope';
import type { ResourceAclResponseEnvelope } from '../models/ResourceAclResponseEnvelope';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AclService {
    /**
     * 查询资源 ACL
     * @returns ResourceAclListResponseEnvelope 资源 ACL 列表
     * @throws ApiError
     */
    public static aclList({
        resourceId,
    }: {
        resourceId: string,
    }): CancelablePromise<ResourceAclListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/resources/{resourceId}/acl',
            path: {
                'resourceId': resourceId,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 document.share 权限`,
                404: `资源不存在或不在授权范围内`,
            },
        });
    }
    /**
     * 为资源创建 ACL 授权
     * @returns ResourceAclResponseEnvelope 已创建 ACL 授权
     * @throws ApiError
     */
    public static aclCreate({
        resourceId,
        requestBody,
    }: {
        resourceId: string,
        requestBody: CreateResourceAclRequest,
    }): CancelablePromise<ResourceAclResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/resources/{resourceId}/acl',
            path: {
                'resourceId': resourceId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段或权限编码无效`,
                401: `登录状态无效或已过期`,
                403: `缺少 document.share 权限`,
                404: `资源或授权主体不存在`,
                409: `相同主体的 ACL 已存在`,
            },
        });
    }
    /**
     * 撤销资源 ACL 授权
     * @returns void
     * @throws ApiError
     */
    public static aclDelete({
        resourceId,
        aclEntryId,
        version,
    }: {
        resourceId: string,
        aclEntryId: string,
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/resources/{resourceId}/acl/{aclEntryId}',
            path: {
                'resourceId': resourceId,
                'aclEntryId': aclEntryId,
            },
            query: {
                'version': version,
            },
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 document.share 权限`,
                404: `资源或 ACL 不存在或不在授权范围内`,
                409: `数据版本冲突`,
            },
        });
    }
}
