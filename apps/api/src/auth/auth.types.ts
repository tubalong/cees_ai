export interface AccessTokenPayload {
    sub: string;
    tid: string;
    mid: string;
    sid: string;
}

export interface AuthenticatedPrincipal {
    id: string;
    tenantId: string;
    membershipId: string;
    sessionId: string;
    email: string;
    displayName: string;
    tenantCode: string;
    tenantName: string;
    roles: string[];
    permissions: string[];
}

export interface AuthTokenPair {
    accessToken: string;
    accessTokenExpiresIn: number;
    refreshToken: string;
    refreshTokenExpiresIn: number;
}

export interface AuthContextResult {
    user: {
        id: string;
        email: string;
        displayName: string;
    };
    tenant: {
        id: string;
        code: string;
        name: string;
    };
    membership: {
        id: string;
        status: 'ACTIVE';
        roles: string[];
    };
}

export interface MeResult extends AuthContextResult {
    permissions: string[];
}
