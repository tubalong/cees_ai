export interface TencentMeetingSettings {
    sdkId: string;
    corpId: string;
    secret: string;
    redirectUri: string;
    authorizeUrl: string;
    tokenUrl: string;
    refreshTokenUrl: string;
    userInfoUrl: string;
    apiBaseUrl: string;
    requestTimeoutMs: number;
    providerResponseMaxBytes: number;
    executionResponseMaxBytes: number;
}

export interface TencentMeetingTokenSet {
    accessToken: string;
    refreshToken: string;
    externalUserId: string;
    openId: string | null;
    openCorpId: string | null;
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

export type TencentMeetingToolId =
    | 'tencent_meeting.profile.get'
    | 'tencent_meeting.meetings.list'
    | 'tencent_meeting.meetings.get'
    | 'tencent_meeting.participants.list'
    | 'tencent_meeting.recordings.list';

export interface TencentMeetingConnectorTool {
    toolId: TencentMeetingToolId;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface TencentMeetingConnectorPlannedCall {
    toolId: TencentMeetingToolId;
    arguments: Record<string, unknown>;
}

export interface TencentMeetingConnectorContext {
    provider: 'TENCENT_MEETING';
    toolId: TencentMeetingToolId;
    toolName: string;
    fetchedAt: string;
    data: Record<string, unknown>;
}

export interface TencentMeetingConnectorExecutionRequest {
    calls: TencentMeetingConnectorPlannedCall[];
}

export interface TencentMeetingConnectorExecutionResult {
    contexts: TencentMeetingConnectorContext[];
}

export interface TencentMeetingAuthorizedCredential {
    connectionId: string;
    accessToken: string;
    openId: string;
    grantedScopes: string[];
    account: TencentMeetingAccountProfile;
}
