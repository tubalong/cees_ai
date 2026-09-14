/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreateKnowledgeBaseMemberRequest } from '../models/CreateKnowledgeBaseMemberRequest';
import type { CreateKnowledgeBaseRequest } from '../models/CreateKnowledgeBaseRequest';
import type { KnowledgeBaseListResponseEnvelope } from '../models/KnowledgeBaseListResponseEnvelope';
import type { KnowledgeBaseMemberListResponseEnvelope } from '../models/KnowledgeBaseMemberListResponseEnvelope';
import type { KnowledgeBaseMemberResponseEnvelope } from '../models/KnowledgeBaseMemberResponseEnvelope';
import type { KnowledgeBaseResponseEnvelope } from '../models/KnowledgeBaseResponseEnvelope';
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
    }): CancelablePromise<KnowledgeBaseListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/knowledge-bases',
            query: {
                'keyword': keyword,
                'limit': limit,
                'cursor': cursor,
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
                403: `缺少 knowledge_base.member.manage 权限或知识库 MANAGER 权限`,
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
                403: `缺少 knowledge_base.member.manage 权限或知识库 MANAGER 权限`,
                404: `知识库或目标成员不存在`,
                409: `目标成员已经加入知识库`,
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
                403: `缺少 knowledge_base.member.manage 权限或知识库 MANAGER 权限`,
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
                403: `缺少 knowledge_base.member.manage 权限或知识库 MANAGER 权限`,
                404: `知识库或成员不存在`,
                409: `不允许移除创建者或最后一名 MANAGER`,
            },
        });
    }
}
