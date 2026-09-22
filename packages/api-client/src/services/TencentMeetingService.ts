/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TencentMeetingAuthorizationResponseEnvelope } from '../models/TencentMeetingAuthorizationResponseEnvelope';
import type { TencentMeetingConnectionResponseEnvelope } from '../models/TencentMeetingConnectionResponseEnvelope';
import type { TencentMeetingConnectorExecutionRequest } from '../models/TencentMeetingConnectorExecutionRequest';
import type { TencentMeetingConnectorExecutionResponseEnvelope } from '../models/TencentMeetingConnectorExecutionResponseEnvelope';
import type { TencentMeetingConnectorToolListResponseEnvelope } from '../models/TencentMeetingConnectorToolListResponseEnvelope';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class TencentMeetingService {
    /**
     * 发起当前成员的腾讯会议 OAuth 授权
     * 服务端为当前 tenantId + membershipId 创建短期、一次性 OAuth State，并返回腾讯会议授权地址。
     * 同一成员再次发起时，服务端使此前未完成的授权尝试失效。返回值不包含应用 Secret、Access Token、Refresh Token 或原始 State。
     *
     * @returns TencentMeetingAuthorizationResponseEnvelope OAuth 授权地址已创建
     * @throws ApiError
     */
    public static startTencentMeetingAuthorization(): CancelablePromise<TencentMeetingAuthorizationResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/connectors/tencent-meeting/authorization',
            errors: {
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
                409: `当前成员已经连接腾讯会议且未要求重新授权`,
                503: `腾讯会议连接器未配置或授权服务暂不可用`,
            },
        });
    }
    /**
     * 解绑当前成员的腾讯会议账号
     * 幂等清除当前 tenantId + membershipId 的腾讯会议授权和服务端 Token。未连接时同样返回 204。
     * 解绑不会删除已经写入 CEES 的业务数据，也不会影响其他租户或成员的独立授权。
     *
     * @returns void
     * @throws ApiError
     */
    public static disconnectTencentMeeting(): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/connectors/tencent-meeting/authorization',
            errors: {
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
                503: `连接器服务暂不可用，无法确认授权清理结果`,
            },
        });
    }
    /**
     * 接收腾讯会议 OAuth 回调
     * 腾讯会议浏览器授权完成后的公开回调。服务端只依据一次性 State 定位并验证发起授权的租户成员，
     * 交换并加密保存 Token 后返回可关闭的 HTML 页面。code 与 error 至少提供一个；State 过期、无效或已消费时拒绝处理。
     *
     * @returns string 授权结果已处理；HTML 页面提示用户返回 CEES Desktop
     * @throws ApiError
     */
    public static completeTencentMeetingAuthorization({
        state,
        code,
        error,
        errorDescription,
    }: {
        /**
         * 服务端签发并持久化校验的一次性 OAuth State
         */
        state: string,
        /**
         * 腾讯会议返回的授权码；授权成功时必填
         */
        code?: string,
        /**
         * 腾讯会议返回的授权失败代码
         */
        error?: string,
        /**
         * 腾讯会议返回的授权失败说明，仅用于用户提示和受控日志
         */
        errorDescription?: string,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/connectors/tencent-meeting/oauth/callback',
            query: {
                'state': state,
                'code': code,
                'error': error,
                'error_description': errorDescription,
            },
            errors: {
                400: `OAuth State、授权码或回调参数无效、过期或已消费`,
                502: `腾讯会议 Token 交换或账号信息查询失败`,
                503: `腾讯会议连接器未配置或服务暂不可用`,
            },
        });
    }
    /**
     * 查询当前成员的腾讯会议连接状态
     * 返回当前 tenantId + membershipId 的独立授权状态、账号摘要、授权范围和 Token 健康状态。
     * 响应永远不包含第三方 Token、应用 Secret 或其他成员的授权信息。
     *
     * @returns TencentMeetingConnectionResponseEnvelope 当前成员的腾讯会议连接状态
     * @throws ApiError
     */
    public static getTencentMeetingConnectionStatus(): CancelablePromise<TencentMeetingConnectionResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/connectors/tencent-meeting/status',
            errors: {
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
            },
        });
    }
    /**
     * 查询当前腾讯会议授权可用的只读工具
     * 根据当前成员的授权范围和服务端能力返回工具目录。只返回 CEES 预定义的安全只读工具，
     * 不暴露腾讯会议原始 URL、HTTP Header、Access Token 或任意 Open API 调用能力。
     *
     * @returns TencentMeetingConnectorToolListResponseEnvelope 当前授权可用的只读工具
     * @throws ApiError
     */
    public static listTencentMeetingConnectorTools(): CancelablePromise<TencentMeetingConnectorToolListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/connectors/tencent-meeting/tools',
            errors: {
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
                409: `当前成员尚未完成腾讯会议授权或授权已经失效`,
                503: `腾讯会议连接器未配置或服务暂不可用`,
            },
        });
    }
    /**
     * 执行当前成员的腾讯会议只读工具调用
     * 按顺序执行一到三条 CEES 预定义的只读工具调用。服务端校验工具 ID、参数、OAuth Scope、
     * 当前账号对会议资源的访问权限，并对结果执行字段过滤、脱敏和大小限制。
     *
     * @returns TencentMeetingConnectorExecutionResponseEnvelope 按调用顺序返回腾讯会议只读上下文
     * @throws ApiError
     */
    public static executeTencentMeetingConnectorTools({
        requestBody,
    }: {
        requestBody: TencentMeetingConnectorExecutionRequest,
    }): CancelablePromise<TencentMeetingConnectorExecutionResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/connectors/tencent-meeting/executions',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `工具 ID、调用数量或参数不符合契约`,
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
                403: `腾讯会议授权范围不足或当前账号无权访问目标会议资源`,
                409: `当前成员尚未授权、授权已撤销或 Token 无法刷新`,
                429: `腾讯会议提供方限流，请按错误详情中的重试语义稍后重试`,
                502: `腾讯会议返回无效响应或上游调用失败`,
                503: `腾讯会议连接器未配置或提供方暂不可用`,
            },
        });
    }
}
