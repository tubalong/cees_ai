/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type TencentMeetingAuthorization = {
    /**
     * 包含一次性 State 的腾讯会议 OAuth 授权地址
     */
    authorizationUrl: string;
    /**
     * 本次 OAuth State 的过期时间
     */
    expiresAt: string;
    /**
     * Desktop 建议等待该时长后轮询连接状态
     */
    pollAfterMs: number;
};

