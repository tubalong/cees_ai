import type { ConnectorStatus } from '../core/connector.types';

export interface TencentMeetingApiAccount {
    externalUserId: string;
    displayName: string | null;
    organizationId: string | null;
    organizationName: string | null;
}

export interface TencentMeetingApiConnection {
    state: 'NOT_CONNECTED' | 'AUTHORIZING' | 'READY' | 'ERROR';
    authenticated: boolean;
    account: TencentMeetingApiAccount | null;
    grantedScopes: string[];
    tokenStatus: 'MISSING' | 'VALID' | 'EXPIRING' | 'REFRESH_FAILED' | 'REVOKED';
    authorizedAt: string | null;
    tokenExpiresAt: string | null;
    lastVerifiedAt: string | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    updatedAt: string;
}

export interface TencentMeetingConnectorStatus extends ConnectorStatus {
    account: TencentMeetingApiAccount | null;
    grantedScopes: string[];
    tokenStatus: TencentMeetingApiConnection['tokenStatus'];
    authorizedAt: string | null;
    tokenExpiresAt: string | null;
}

export function toTencentMeetingConnectorStatus(connection: TencentMeetingApiConnection): TencentMeetingConnectorStatus {
    if (connection.state === 'READY' && connection.authenticated) {
        return baseStatus(connection, {
            state: 'READY',
            authenticated: true,
            issueCode: null,
            recoveryAction: 'NONE',
            error: null,
        });
    }
    if (connection.state === 'AUTHORIZING') {
        return baseStatus(connection, {
            state: 'AUTH_REQUIRED',
            authenticated: false,
            issueCode: 'AUTHORIZING',
            recoveryAction: 'AUTHORIZE',
            error: '请在系统浏览器中完成腾讯会议授权',
        });
    }
    if (connection.state === 'ERROR') {
        return baseStatus(connection, {
            state: 'ERROR',
            authenticated: false,
            issueCode: connection.lastErrorCode ?? 'PROVIDER_UNAVAILABLE',
            recoveryAction: requiresAuthorization(connection.lastErrorCode) ? 'AUTHORIZE' : 'RETRY',
            error: connection.lastErrorMessage ?? '腾讯会议连接异常，请稍后重试',
        });
    }
    return baseStatus(connection, {
        state: 'AUTH_REQUIRED',
        authenticated: false,
        issueCode: connection.lastErrorCode ?? 'AUTH_REQUIRED',
        recoveryAction: 'AUTHORIZE',
        error: connection.lastErrorMessage,
    });
}

function baseStatus(
    connection: TencentMeetingApiConnection,
    status: Pick<ConnectorStatus, 'state' | 'authenticated' | 'issueCode' | 'recoveryAction' | 'error'>,
): TencentMeetingConnectorStatus {
    return {
        ...status,
        installed: true,
        version: null,
        checkedAt: connection.updatedAt || new Date().toISOString(),
        account: connection.account,
        grantedScopes: [...connection.grantedScopes],
        tokenStatus: connection.tokenStatus,
        authorizedAt: connection.authorizedAt,
        tokenExpiresAt: connection.tokenExpiresAt,
    };
}

function requiresAuthorization(code: string | null): boolean {
    return code === 'AUTH_REQUIRED'
        || code === 'TOKEN_REFRESH_FAILED'
        || code === 'OAUTH_ACCESS_DENIED';
}
