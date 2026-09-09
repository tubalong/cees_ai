/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UpdateUserProfileRequest } from '../models/UpdateUserProfileRequest';
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
}
