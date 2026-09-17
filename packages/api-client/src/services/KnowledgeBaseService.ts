/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreateKnowledgeBaseMemberRequest } from '../models/CreateKnowledgeBaseMemberRequest';
import type { CreateKnowledgeBaseRequest } from '../models/CreateKnowledgeBaseRequest';
import type { CreateKnowledgeDocumentRequest } from '../models/CreateKnowledgeDocumentRequest';
import type { CreateKnowledgeDocumentVersionRequest } from '../models/CreateKnowledgeDocumentVersionRequest';
import type { KnowledgeBaseListResponseEnvelope } from '../models/KnowledgeBaseListResponseEnvelope';
import type { KnowledgeBaseMemberListResponseEnvelope } from '../models/KnowledgeBaseMemberListResponseEnvelope';
import type { KnowledgeBaseMemberPermission } from '../models/KnowledgeBaseMemberPermission';
import type { KnowledgeBaseMemberResponseEnvelope } from '../models/KnowledgeBaseMemberResponseEnvelope';
import type { KnowledgeBaseResponseEnvelope } from '../models/KnowledgeBaseResponseEnvelope';
import type { KnowledgeDocumentListResponseEnvelope } from '../models/KnowledgeDocumentListResponseEnvelope';
import type { KnowledgeDocumentResponseEnvelope } from '../models/KnowledgeDocumentResponseEnvelope';
import type { KnowledgeQueryRequest } from '../models/KnowledgeQueryRequest';
import type { KnowledgeQueryResponseEnvelope } from '../models/KnowledgeQueryResponseEnvelope';
import type { UpdateKnowledgeBaseMemberRequest } from '../models/UpdateKnowledgeBaseMemberRequest';
import type { UpdateKnowledgeBaseRequest } from '../models/UpdateKnowledgeBaseRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class KnowledgeBaseService {
    /**
     * 查询当前成员可访问的知识库
     * 普通成员只能看到自己加入的知识库，拥有 knowledge_base.manage_all 权限的成员可看到当前租户全部知识库。
     * @returns KnowledgeBaseListResponseEnvelope 知识库列表
     * @throws ApiError
     */
    public static listKnowledgeBases({
        keyword,
        limit = 20,
        cursor,
        permission,
    }: {
        /**
         * 按知识库名称或说明模糊搜索
         */
        keyword?: string,
        /**
         * 每页数量，默认 20，最大 100
         */
        limit?: number,
        /**
         * 上一页返回的知识库 ID
         */
        cursor?: string,
        /**
         * 只返回当前用户达到该成员权限的知识库（转存目标库选择）；省略时按可见范围返回
         */
        permission?: KnowledgeBaseMemberPermission,
    }): CancelablePromise<KnowledgeBaseListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/knowledge-bases',
            query: {
                'keyword': keyword,
                'limit': limit,
                'cursor': cursor,
                'permission': permission,
            },
            errors: {
                400: `分页游标无效或请求参数校验失败`,
                401: `登录状态无效或缺少有效租户成员身份`,
            },
        });
    }
    /**
     * 创建知识库
     * @returns KnowledgeBaseResponseEnvelope 知识库已创建，创建者自动成为 MANAGER
     * @throws ApiError
     */
    public static createKnowledgeBase({
        requestBody,
    }: {
        requestBody: CreateKnowledgeBaseRequest,
    }): CancelablePromise<KnowledgeBaseResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/knowledge-bases',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或缺少有效租户成员身份`,
                403: `缺少 knowledge_base.create 权限`,
            },
        });
    }
    /**
     * 获取知识库详情
     * @returns KnowledgeBaseResponseEnvelope 知识库详情
     * @throws ApiError
     */
    public static getKnowledgeBase({
        knowledgeBaseId,
    }: {
        /**
         * 知识库 ID
         */
        knowledgeBaseId: string,
    }): CancelablePromise<KnowledgeBaseResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/knowledge-bases/{knowledgeBaseId}',
            path: {
                'knowledgeBaseId': knowledgeBaseId,
            },
            errors: {
                401: `登录状态无效或缺少有效租户成员身份`,
                403: `缺少 knowledge_base.read 权限`,
                404: `知识库不存在或当前成员无权访问`,
            },
        });
    }
    /**
     * 修改知识库
     * 必须提交当前 version；修改成功后版本号递增。
     * @returns KnowledgeBaseResponseEnvelope 知识库已修改
     * @throws ApiError
     */
    public static updateKnowledgeBase({
        knowledgeBaseId,
        requestBody,
    }: {
        /**
         * 知识库 ID
         */
        knowledgeBaseId: string,
        requestBody: UpdateKnowledgeBaseRequest,
    }): CancelablePromise<KnowledgeBaseResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/knowledge-bases/{knowledgeBaseId}',
            path: {
                'knowledgeBaseId': knowledgeBaseId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败或没有可修改字段`,
                401: `登录状态无效或缺少有效租户成员身份`,
                403: `缺少知识库 MANAGER 权限`,
                404: `知识库不存在或当前成员无权访问`,
                409: `version 与服务端当前版本不一致`,
            },
        });
    }
    /**
     * 删除知识库
     * 软删除知识库，必须提交当前 version。
     * @returns void
     * @throws ApiError
     */
    public static deleteKnowledgeBase({
        knowledgeBaseId,
        version,
    }: {
        /**
         * 知识库 ID
         */
        knowledgeBaseId: string,
        /**
         * 当前知识库版本
         */
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/knowledge-bases/{knowledgeBaseId}',
            path: {
                'knowledgeBaseId': knowledgeBaseId,
            },
            query: {
                'version': version,
            },
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或缺少有效租户成员身份`,
                403: `缺少知识库 MANAGER 权限`,
                404: `知识库不存在或当前成员无权访问`,
                409: `version 与服务端当前版本不一致`,
            },
        });
    }
    /**
     * 基于知识库内容回答提问
     * 检索知识库内当前成员可见的文档内容，由 ai-service 基于证据生成带引用的答案。
     * 检索无结果时直接返回 insufficientEvidence=true 不调用模型；
     * 答案只引用真实检索到的 chunk，不允许模型编造文档、页码或链接。
     *
     * @returns KnowledgeQueryResponseEnvelope 基于知识库证据的答案与引用列表
     * @throws ApiError
     */
    public static queryKnowledgeBase({
        knowledgeBaseId,
        requestBody,
    }: {
        /**
         * 知识库 ID
         */
        knowledgeBaseId: string,
        requestBody: KnowledgeQueryRequest,
    }): CancelablePromise<KnowledgeQueryResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/knowledge-bases/{knowledgeBaseId}/query',
            path: {
                'knowledgeBaseId': knowledgeBaseId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或缺少有效租户成员身份`,
                403: `缺少 knowledge_base.query 权限或不是该知识库成员`,
                404: `知识库不存在或当前成员无权访问`,
                503: `AI 服务暂不可用，可稍后重试`,
            },
        });
    }
    /**
     * 查询知识库成员
     * @returns KnowledgeBaseMemberListResponseEnvelope 知识库成员列表
     * @throws ApiError
     */
    public static listKnowledgeBaseMembers({
        knowledgeBaseId,
        cursor,
    }: {
        /**
         * 知识库 ID
         */
        knowledgeBaseId: string,
        /**
         * 上一页返回的成员关系 ID
         */
        cursor?: string,
    }): CancelablePromise<KnowledgeBaseMemberListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/knowledge-bases/{knowledgeBaseId}/members',
            path: {
                'knowledgeBaseId': knowledgeBaseId,
            },
            query: {
                'cursor': cursor,
            },
            errors: {
                400: `分页游标无效`,
                401: `登录状态无效或缺少有效租户成员身份`,
                403: `缺少 knowledge_base.read 权限或知识库 MANAGER 权限`,
                404: `知识库不存在或当前成员无权访问`,
            },
        });
    }
    /**
     * 添加知识库成员
     * membershipId 必须属于当前租户且对应的用户处于 ACTIVE 状态。
     * @returns KnowledgeBaseMemberResponseEnvelope 知识库成员已添加
     * @throws ApiError
     */
    public static addKnowledgeBaseMember({
        knowledgeBaseId,
        requestBody,
    }: {
        /**
         * 知识库 ID
         */
        knowledgeBaseId: string,
        requestBody: CreateKnowledgeBaseMemberRequest,
    }): CancelablePromise<KnowledgeBaseMemberResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/knowledge-bases/{knowledgeBaseId}/members',
            path: {
                'knowledgeBaseId': knowledgeBaseId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或缺少有效租户成员身份`,
                403: `缺少 knowledge_base.read 权限或知识库 MANAGER 权限`,
                404: `知识库或目标成员不存在`,
                409: `目标成员已经加入知识库`,
            },
        });
    }
    /**
     * 查询知识库文档
     * 返回知识库内未删除文档的分页列表，包含处理状态；普通成员只能查看自己加入的知识库。
     * @returns KnowledgeDocumentListResponseEnvelope 知识库文档列表
     * @throws ApiError
     */
    public static listKnowledgeDocuments({
        knowledgeBaseId,
        keyword,
        limit = 20,
        cursor,
    }: {
        /**
         * 知识库 ID
         */
        knowledgeBaseId: string,
        /**
         * 按文档名称模糊搜索
         */
        keyword?: string,
        /**
         * 每页数量，默认 20，最大 100
         */
        limit?: number,
        /**
         * 上一页返回的文档 ID
         */
        cursor?: string,
    }): CancelablePromise<KnowledgeDocumentListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/knowledge-bases/{knowledgeBaseId}/documents',
            path: {
                'knowledgeBaseId': knowledgeBaseId,
            },
            query: {
                'keyword': keyword,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                400: `分页游标无效或请求参数校验失败`,
                401: `登录状态无效或缺少有效租户成员身份`,
                403: `缺少 knowledge_base.read 权限`,
                404: `知识库不存在或当前成员无权访问`,
            },
        });
    }
    /**
     * 上传知识库文档
     * 关联一个已上传的文件对象并创建文档，文档进入 PENDING 状态后由后台任务解析并建立索引。可见范围为 DEPARTMENT 时必须提供 departmentId，为 PROJECT 时必须提供 projectId。
     * @returns KnowledgeDocumentResponseEnvelope 文档已创建，等待后台解析与索引
     * @throws ApiError
     */
    public static createKnowledgeDocument({
        knowledgeBaseId,
        requestBody,
    }: {
        /**
         * 知识库 ID
         */
        knowledgeBaseId: string,
        requestBody: CreateKnowledgeDocumentRequest,
    }): CancelablePromise<KnowledgeDocumentResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/knowledge-bases/{knowledgeBaseId}/documents',
            path: {
                'knowledgeBaseId': knowledgeBaseId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败或可见范围与部门、项目字段不一致`,
                401: `登录状态无效或缺少有效租户成员身份`,
                403: `缺少 knowledge_base.read 权限或知识库 EDITOR 权限`,
                404: `知识库不存在或文件对象不属于当前租户`,
                409: `文件对象已被其他文档使用或已删除`,
            },
        });
    }
    /**
     * 上传文档新版本
     * 关联新的文件对象并创建文档新版本，文档重新进入 PENDING 状态并重建索引。
     * @returns KnowledgeDocumentResponseEnvelope 新版本已创建，文档重新进入处理队列
     * @throws ApiError
     */
    public static createKnowledgeDocumentVersion({
        knowledgeBaseId,
        documentId,
        requestBody,
    }: {
        /**
         * 知识库 ID
         */
        knowledgeBaseId: string,
        /**
         * 文档 ID
         */
        documentId: string,
        requestBody: CreateKnowledgeDocumentVersionRequest,
    }): CancelablePromise<KnowledgeDocumentResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/knowledge-bases/{knowledgeBaseId}/documents/{documentId}/versions',
            path: {
                'knowledgeBaseId': knowledgeBaseId,
                'documentId': documentId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败或可见范围与部门、项目字段不一致`,
                401: `登录状态无效或缺少有效租户成员身份`,
                403: `缺少 knowledge_base.read 权限或知识库 EDITOR 权限`,
                404: `知识库、文档不存在或文件对象不属于当前租户`,
                409: `文件对象已被其他文档使用或已删除`,
            },
        });
    }
    /**
     * 重试文档处理
     * 将处理失败的文档重新放入 PENDING 队列，重置重试计数与失败原因。
     * @returns KnowledgeDocumentResponseEnvelope 文档已重新进入处理队列
     * @throws ApiError
     */
    public static retryKnowledgeDocument({
        knowledgeBaseId,
        documentId,
    }: {
        /**
         * 知识库 ID
         */
        knowledgeBaseId: string,
        /**
         * 文档 ID
         */
        documentId: string,
    }): CancelablePromise<KnowledgeDocumentResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/knowledge-bases/{knowledgeBaseId}/documents/{documentId}/retry',
            path: {
                'knowledgeBaseId': knowledgeBaseId,
                'documentId': documentId,
            },
            errors: {
                401: `登录状态无效或缺少有效租户成员身份`,
                403: `缺少 knowledge_base.read 权限或知识库 EDITOR 权限`,
                404: `知识库或文档不存在`,
                409: `文档当前状态不允许重试`,
            },
        });
    }
    /**
     * 修改知识库成员权限
     * 知识库创建者必须始终保留 MANAGER 权限。
     * @returns KnowledgeBaseMemberResponseEnvelope 知识库成员权限已修改
     * @throws ApiError
     */
    public static updateKnowledgeBaseMember({
        knowledgeBaseId,
        membershipId,
        requestBody,
    }: {
        /**
         * 知识库 ID
         */
        knowledgeBaseId: string,
        /**
         * 租户成员 ID
         */
        membershipId: string,
        requestBody: UpdateKnowledgeBaseMemberRequest,
    }): CancelablePromise<KnowledgeBaseMemberResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/knowledge-bases/{knowledgeBaseId}/members/{membershipId}',
            path: {
                'knowledgeBaseId': knowledgeBaseId,
                'membershipId': membershipId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或缺少有效租户成员身份`,
                403: `缺少 knowledge_base.read 权限或知识库 MANAGER 权限`,
                404: `知识库或成员不存在`,
                409: `不允许降低知识库创建者权限`,
            },
        });
    }
    /**
     * 移除知识库成员
     * 知识库创建者不能被移除；不能移除最后一名 MANAGER。
     * @returns void
     * @throws ApiError
     */
    public static removeKnowledgeBaseMember({
        knowledgeBaseId,
        membershipId,
    }: {
        /**
         * 知识库 ID
         */
        knowledgeBaseId: string,
        /**
         * 租户成员 ID
         */
        membershipId: string,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/knowledge-bases/{knowledgeBaseId}/members/{membershipId}',
            path: {
                'knowledgeBaseId': knowledgeBaseId,
                'membershipId': membershipId,
            },
            errors: {
                401: `登录状态无效或缺少有效租户成员身份`,
                403: `缺少 knowledge_base.read 权限或知识库 MANAGER 权限`,
                404: `知识库或成员不存在`,
                409: `不允许移除创建者或最后一名 MANAGER`,
            },
        });
    }
}
