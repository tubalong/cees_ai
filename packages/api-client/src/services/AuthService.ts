/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { LoginRequest } from '../models/LoginRequest';
import type { LoginResponseEnvelope } from '../models/LoginResponseEnvelope';
import type { MeResponseEnvelope } from '../models/MeResponseEnvelope';
import type { RefreshTokenRequest } from '../models/RefreshTokenRequest';
import type { TokenPairResponseEnvelope } from '../models/TokenPairResponseEnvelope';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AuthService {
    /**
     * 使用租户编码、邮箱和密码登录
     * @returns LoginResponseEnvelope 登录成功
     * @throws ApiError
     */
    public static authLogin({
        requestBody,
    }: {
        requestBody: LoginRequest,
    }): CancelablePromise<LoginResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/auth/login',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录凭证无效或账户不可用`,
            },
        });
    }
    /**
     * 使用 Refresh Token 轮换访问令牌和刷新令牌
     * @returns TokenPairResponseEnvelope 令牌轮换成功
     * @throws ApiError
     */
    public static authRefresh({
        requestBody,
    }: {
        requestBody: RefreshTokenRequest,
    }): CancelablePromise<TokenPairResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/auth/refresh',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `Refresh Token 无效、过期或已被使用`,
            },
        });
    }
    /**
     * 撤销当前登录会话
     * @returns void
     * @throws ApiError
     */
    public static authLogout(): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/auth/logout',
            errors: {
                401: `Access Token 无效或 Session 已失效`,
            },
        });
    }
    /**
     * 获取当前用户、租户、角色和权限
     * @returns MeResponseEnvelope 当前认证上下文
     * @throws ApiError
     */
    public static authMe(): CancelablePromise<MeResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/auth/me',
            errors: {
                401: `Access Token 无效或 Session 已失效`,
            },
        });
    }
}
