import { PlatformRole } from '@prisma/client';

export interface PlatformAccessTokenPayload {
    scope: 'PLATFORM';
    sub: string;
    pid: string;
    sid: string;
}

export interface PlatformAuthenticatedPrincipal {
    id: string;
    platformAdministratorId: string;
    sessionId: string;
    account: string;
    displayName: string;
    role: PlatformRole;
    permissions: string[];
}

export interface PlatformAuthTokenPair {
    accessToken: string;
    accessTokenExpiresIn: number;
    refreshToken: string;
    refreshTokenExpiresIn: number;
}

export interface PlatformAdministratorIdentity {
    id: string;
    account: string;
    user: {
        id: string;
        displayName: string;
    };
    role: PlatformRole;
    permissions: string[];
}

export interface PlatformLoginResult extends PlatformAuthTokenPair {
    administrator: PlatformAdministratorIdentity;
}

export interface PlatformMeResult {
    administrator: PlatformAdministratorIdentity;
}
