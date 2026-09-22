/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 服务端托管 Token 的健康状态；不会返回 Token 本身
 */
export enum TencentMeetingTokenStatus {
    MISSING = 'MISSING',
    VALID = 'VALID',
    EXPIRING = 'EXPIRING',
    REFRESH_FAILED = 'REFRESH_FAILED',
    REVOKED = 'REVOKED',
}
