/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PlatformLoginRequest } from '../models/PlatformLoginRequest';
import type { PlatformLoginResponseEnvelope } from '../models/PlatformLoginResponseEnvelope';
import type { PlatformMeResponseEnvelope } from '../models/PlatformMeResponseEnvelope';
import type { RefreshTokenRequest } from '../models/RefreshTokenRequest';
import type { TokenPairResponseEnvelope } from '../models/TokenPairResponseEnvelope';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class PlatformAuthService {
    /**
     * 平台管理员登录
     * @returns PlatformLoginResponseEnvelope 平台管理员登录成功
     * @throws ApiError
     */
    public static platformAuthLogin({
        requestBody,
    }: {
        requestBody: PlatformLoginRequest,
    }): CancelablePromise<PlatformLoginResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/platform/auth/login',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录凭证无效或平台管理员不可用`,
            },
        });
    }
    /**
     * 轮换平台管理员令牌
     * @returns TokenPairResponseEnvelope 平台管理员令牌轮换成功
     * @throws ApiError
     */
    public static platformAuthRefresh({
        requestBody,
    }: {
        requestBody: RefreshTokenRequest,
    }): CancelablePromise<TokenPairResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/platform/auth/refresh',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                401: `Refresh Token 无效、过期或已被使用`,
            },
        });
    }
    /**
     * 撤销当前平台管理员会话
     * @returns void
     * @throws ApiError
     */
    public static platformAuthLogout(): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/platform/auth/logout',
            errors: {
                401: `平台登录状态无效或已过期`,
            },
        });
    }
    /**
     * 获取当前平台管理员身份
     * @returns PlatformMeResponseEnvelope 当前平台管理员身份和权限
     * @throws ApiError
     */
    public static platformAuthMe(): CancelablePromise<PlatformMeResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/platform/auth/me',
            errors: {
                401: `平台登录状态无效或已过期`,
            },
        });
    }
}
