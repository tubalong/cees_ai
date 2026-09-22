export interface TencentMeetingSettings {
    sdkId: string;
    secret: string;
    redirectUri: string;
    authorizeUrl: string;
    tokenUrl: string;
    refreshTokenUrl: string;
    userInfoUrl: string;
    requestTimeoutMs: number;
}

export interface TencentMeetingTokenSet {
    accessToken: string;
    refreshToken: string;
    externalUserId: string;
    openId: string | null;
    scopes: string[];
    accessTokenExpiresAt: Date;
    refreshTokenExpiresAt: Date;
}

export interface TencentMeetingAccountProfile {
    externalUserId: string;
    displayName: string | null;
    organizationId: string | null;
    organizationName: string | null;
}

export interface TencentMeetingAuthorizationResult {
    authorizationUrl: string;
    expiresAt: string;
    pollAfterMs: number;
}

export interface TencentMeetingConnectionResult {
    state: 'NOT_CONNECTED' | 'AUTHORIZING' | 'READY' | 'ERROR';
    authenticated: boolean;
    account: TencentMeetingAccountProfile | null;
    grantedScopes: string[];
    tokenStatus: 'MISSING' | 'VALID' | 'EXPIRING' | 'REFRESH_FAILED' | 'REVOKED';
    authorizedAt: string | null;
    tokenExpiresAt: string | null;
    lastVerifiedAt: string | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    updatedAt: string;
}

export interface TencentMeetingCallbackInput {
    state: string;
    authCode?: string;
    legacyCode?: string;
    error?: string;
    errorDescription?: string;
}

export interface TencentMeetingCallbackResult {
    success: boolean;
    title: string;
    message: string;
}
