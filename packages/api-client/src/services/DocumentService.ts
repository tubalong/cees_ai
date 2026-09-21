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
    /**
     * 导出授权范围内文档为 DOCX
     * 由生成时落库的结构化 DocumentSpec 经 ai-service 确定性渲染为 DOCX 文件， 不调用 LLM；复用 document.read 权限，导出是文档资源的另一种交付视图而非独立资源。
     * @returns binary DOCX 文档文件
     * @throws ApiError
     */
    public static documentExportDocx({
        documentId,
    }: {
        documentId: string,
    }): CancelablePromise<Blob> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/documents/{documentId}/export',
            path: {
                'documentId': documentId,
            },
            errors: {
                400: `文档没有可导出的生成规格`,
                401: `登录状态无效或已过期`,
                403: `缺少 document.read 权限`,
                404: `文档不存在或不在授权范围内`,
                503: `AI 服务不可用`,
            },
        });
    }
    /**
     * 导出授权范围内文档为 PDF
     * 由生成时落库的结构化 DocumentSpec 经 ai-service 确定性渲染为 PDF 文件 （内嵌 CJK 字体），不调用 LLM；复用 document.read 权限。
     * @returns binary PDF 文档文件
     * @throws ApiError
     */
    public static documentExportPdf({
        documentId,
        template = 'editorial-modern',
    }: {
        documentId: string,
        template?: 'business-standard' | 'editorial-modern' | 'executive-dark',
    }): CancelablePromise<Blob> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/documents/{documentId}/export/pdf',
            path: {
                'documentId': documentId,
            },
            query: {
                'template': template,
            },
            errors: {
                400: `文档没有可导出的生成规格`,
                401: `登录状态无效或已过期`,
                403: `缺少 document.read 权限`,
                404: `文档不存在或不在授权范围内`,
                503: `AI 服务不可用`,
            },
        });
    }
    /**
     * 导出授权范围内文档为 PPTX
     * 由生成时落库的结构化 DocumentSpec 按「一节一页」映射后经 ai-service 确定性渲染为 PPTX 文件，不调用 LLM；复用 document.read 权限。
     * @returns binary PPTX 演示文稿文件
     * @throws ApiError
     */
    public static documentExportPptx({
        documentId,
        template = 'editorial-modern',
    }: {
        documentId: string,
        template?: 'business-standard' | 'editorial-modern' | 'executive-dark',
    }): CancelablePromise<Blob> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/documents/{documentId}/export/pptx',
            path: {
                'documentId': documentId,
            },
            query: {
                'template': template,
            },
            errors: {
                400: `文档没有可导出的生成规格`,
                401: `登录状态无效或已过期`,
                403: `缺少 document.read 权限`,
                404: `文档不存在或不在授权范围内`,
                503: `AI 服务不可用`,
            },
        });
    }
}
