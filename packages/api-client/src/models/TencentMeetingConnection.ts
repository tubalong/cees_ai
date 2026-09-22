/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TencentMeetingAccount } from './TencentMeetingAccount';
import type { TencentMeetingConnectionState } from './TencentMeetingConnectionState';
import type { TencentMeetingConnectorErrorCode } from './TencentMeetingConnectorErrorCode';
import type { TencentMeetingTokenStatus } from './TencentMeetingTokenStatus';
export type TencentMeetingConnection = {
    state: TencentMeetingConnectionState;
    /**
     * 仅在授权有效且 Token 可用时为 true
     */
    authenticated: boolean;
    account: (TencentMeetingAccount | null);
    /**
     * 腾讯会议实际授予的 OAuth Scope；未授权时为空数组
     */
    grantedScopes: Array<string>;
    tokenStatus: TencentMeetingTokenStatus;
    authorizedAt: string | null;
    tokenExpiresAt: string | null;
    lastVerifiedAt: string | null;
    lastErrorCode: (TencentMeetingConnectorErrorCode | null);
    lastErrorMessage: string | null;
    updatedAt: string;
};

