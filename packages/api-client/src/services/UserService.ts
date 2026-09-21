/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UpdateUserMemoryRequest } from '../models/UpdateUserMemoryRequest';
import type { UpdateUserProfileRequest } from '../models/UpdateUserProfileRequest';
import type { UserMemoryListResponseEnvelope } from '../models/UserMemoryListResponseEnvelope';
import type { UserMemoryResponseEnvelope } from '../models/UserMemoryResponseEnvelope';
import type { UserProfileResponseEnvelope } from '../models/UserProfileResponseEnvelope';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class UserService {
    /**
     * 获取当前租户内的个人资料
     * @returns UserProfileResponseEnvelope 当前用户在当前租户内的个人资料
     * @throws ApiError
     */
    public static userProfileGetCurrent(): CancelablePromise<UserProfileResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/users/me/profile',
            errors: {
                401: `登录状态无效或已过期`,
            },
        });
    }
    /**
     * 修改当前租户内的个人资料
     * @returns UserProfileResponseEnvelope 修改后的个人资料
     * @throws ApiError
     */
    public static userProfileUpdateCurrent({
        requestBody,
    }: {
        requestBody: UpdateUserProfileRequest,
    }): CancelablePromise<UserProfileResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/users/me/profile',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                409: `个人资料版本冲突`,
            },
        });
    }
    /**
     * 查询当前成员的用户级记忆列表
     * 返回当前成员在该租户内的全部未删除记忆，按创建时间升序（即注入对话上下文的顺序），至多 30 条。
     * 记忆只属于成员本人：AI 仅提议记忆内容，写入与删除一律以本人操作为准。
     *
     * @returns UserMemoryListResponseEnvelope 记忆列表
     * @throws ApiError
     */
    public static listUserMemories(): CancelablePromise<UserMemoryListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/user-memories',
            errors: {
                401: `登录状态或租户成员身份无效`,
            },
        });
    }
    /**
     * 修改当前成员的一条用户级记忆
     * 使用版本进行乐观并发控制；版本不匹配时返回 409。content 与 type 至少提供一个。
     * @returns UserMemoryResponseEnvelope 修改后的记忆
     * @throws ApiError
     */
    public static updateUserMemory({
        memoryId,
        requestBody,
    }: {
        /**
         * 记忆 ID
         */
        memoryId: string,
        requestBody: UpdateUserMemoryRequest,
    }): CancelablePromise<UserMemoryResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/user-memories/{memoryId}',
            path: {
                'memoryId': memoryId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态或租户成员身份无效`,
                404: `记忆不存在或不属于当前成员`,
                409: `记忆版本冲突`,
            },
        });
    }
    /**
     * 删除当前成员的一条用户级记忆
     * 软删除记忆，审计事实保留；版本不匹配时返回 409。
     * @returns void
     * @throws ApiError
     */
    public static deleteUserMemory({
        memoryId,
        version,
    }: {
        /**
         * 记忆 ID
         */
        memoryId: string,
        /**
         * 当前记忆版本
         */
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/user-memories/{memoryId}',
            path: {
                'memoryId': memoryId,
            },
            query: {
                'version': version,
            },
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态或租户成员身份无效`,
                404: `记忆不存在或不属于当前成员`,
                409: `记忆版本冲突`,
            },
        });
    }
}
