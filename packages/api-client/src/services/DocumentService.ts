/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreateDocumentRequest } from '../models/CreateDocumentRequest';
import type { DocumentListResponseEnvelope } from '../models/DocumentListResponseEnvelope';
import type { DocumentResponseEnvelope } from '../models/DocumentResponseEnvelope';
import type { DocumentVisibility } from '../models/DocumentVisibility';
import type { UpdateDocumentRequest } from '../models/UpdateDocumentRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class DocumentService {
    /**
     * 查询当前成员可读取的文档
     * @returns DocumentListResponseEnvelope 授权范围内文档列表
     * @throws ApiError
     */
    public static documentList({
        keyword,
        visibility,
        limit = 20,
        cursor,
    }: {
        keyword?: string,
        visibility?: DocumentVisibility,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<DocumentListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/documents',
            query: {
                'keyword': keyword,
                'visibility': visibility,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                400: `查询参数或分页游标无效`,
                401: `登录状态无效或已过期`,
                403: `缺少 document.read 权限`,
            },
        });
    }
    /**
     * 创建受控文档
     * @returns DocumentResponseEnvelope 已创建文档
     * @throws ApiError
     */
    public static documentCreate({
        requestBody,
    }: {
        requestBody: CreateDocumentRequest,
    }): CancelablePromise<DocumentResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/documents',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 document.create 权限`,
            },
        });
    }
    /**
     * 获取授权范围内文档详情
     * @returns DocumentResponseEnvelope 文档详情
     * @throws ApiError
     */
    public static documentGet({
        documentId,
    }: {
        documentId: string,
    }): CancelablePromise<DocumentResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/documents/{documentId}',
            path: {
                'documentId': documentId,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 document.read 权限`,
                404: `文档不存在或不在授权范围内`,
            },
        });
    }
    /**
     * 修改授权范围内文档
     * @returns DocumentResponseEnvelope 修改后的文档
     * @throws ApiError
     */
    public static documentUpdate({
        documentId,
        requestBody,
    }: {
        documentId: string,
        requestBody: UpdateDocumentRequest,
    }): CancelablePromise<DocumentResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/documents/{documentId}',
            path: {
                'documentId': documentId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 document.update 权限`,
                404: `文档不存在或不在授权范围内`,
                409: `数据版本冲突`,
            },
        });
    }
    /**
     * 删除授权范围内文档
     * @returns void
     * @throws ApiError
     */
    public static documentDelete({
        documentId,
        version,
    }: {
        documentId: string,
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/documents/{documentId}',
            path: {
                'documentId': documentId,
            },
            query: {
                'version': version,
            },
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 document.delete 权限`,
                404: `文档不存在或不在授权范围内`,
                409: `数据版本冲突`,
            },
        });
    }
}
