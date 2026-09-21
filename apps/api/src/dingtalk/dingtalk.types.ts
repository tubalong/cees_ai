import {
    DingTalkIntegrationMode,
    DingTalkIntegrationStatus,
    DingTalkSyncScope,
    DingTalkSyncSource,
    DingTalkSyncJobStatus,
    DingTalkSyncType,
} from '@prisma/client';

export interface DingTalkIntegrationResult {
    id: string;
    tenantId: string;
    mode: DingTalkIntegrationMode;
    corpId: string | null;
    appKey: string | null;
    authorizedByMembershipId: string | null;
    authorizedExternalUserId: string | null;
    authorizedProfile: string | null;
    grantedCapabilities: string[];
    status: DingTalkIntegrationStatus;
    lastVerifiedAt: Date | null;
    lastSyncedAt: Date | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface DingTalkDepartmentResult {
    id: string;
    externalDepartmentId: string;
    parentExternalDepartmentId: string | null;
    departmentId: string | null;
    name: string;
    displayOrder: number;
    isDeleted: boolean;
    lastSeenAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface DingTalkUserResult {
    id: string;
    externalUserId: string;
    unionId: string | null;
    membershipId: string | null;
    name: string;
    title: string | null;
    jobNumber: string | null;
    departmentExternalIds: string[];
    active: boolean;
    admin: boolean;
    boss: boolean;
    isDeleted: boolean;
    lastSeenAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface DingTalkSyncJobResult {
    id: string;
    integrationId: string;
    type: DingTalkSyncType;
    source: DingTalkSyncSource;
    scope: DingTalkSyncScope;
    authorizedByMembershipId: string | null;
    authorizedExternalUserId: string | null;
    status: DingTalkSyncJobStatus;
    departmentCount: number;
    userCount: number;
    errorCode: string | null;
    errorMessage: string | null;
    startedAt: Date;
    completedAt: Date | null;
    createdAt: Date;
}

export interface CursorListResult<T> {
    items: T[];
    nextCursor: string | null;
}

export interface DingTalkCredentials {
    appKey: string;
    appSecret: string;
}

export interface DingTalkDepartmentSnapshot {
    externalDepartmentId: string;
    parentExternalDepartmentId: string | null;
    name: string;
    displayOrder: number;
}

export interface DingTalkUserSnapshot {
    externalUserId: string;
    unionId: string | null;
    name: string;
    title: string | null;
    jobNumber: string | null;
    departmentExternalIds: string[];
    active: boolean;
    admin: boolean;
    boss: boolean;
}

export interface DingTalkOrganizationSnapshot {
    departments: DingTalkDepartmentSnapshot[];
    users: DingTalkUserSnapshot[];
}


export type DingTalkMappingAction = 'MATCH_EXISTING' | 'CREATE' | 'CONFLICT' | 'SKIP';

export interface DingTalkDepartmentMappingPreview {
    dingtalkDepartmentId: string;
    externalDepartmentId: string;
    name: string;
    path: string;
    action: DingTalkMappingAction;
    departmentId: string | null;
    candidateDepartmentIds: string[];
    reason: string;
}

export interface DingTalkUserMappingPreview {
    dingtalkUserId: string;
    externalUserId: string;
    name: string;
    departmentPaths: string[];
    action: DingTalkMappingAction;
    membershipId: string | null;
    candidateMembershipIds: string[];
    suggestedAccount: string;
    reason: string;
}

export interface DingTalkMappingPreviewResult {
    activationExpiresInDays: number;
    departments: DingTalkDepartmentMappingPreview[];
    users: DingTalkUserMappingPreview[];
    summary: {
        departmentMatchedCount: number;
        departmentCreateCount: number;
        departmentConflictCount: number;
        userMatchedCount: number;
        userCreateCount: number;
        userConflictCount: number;
    };
}

export interface DingTalkMappingCredential {
    dingtalkUserId: string;
    membershipId: string;
    displayName: string;
    account: string;
    departmentId: string | null;
    tenantCode: string;
    roleIds: string[];
    roleCodes: string[];
    activationToken: string;
    activationExpiresAt: Date;
}

export interface DingTalkMappingResult {
    preview: DingTalkMappingPreviewResult;
    credentials: DingTalkMappingCredential[];
    summary: DingTalkMappingPreviewResult['summary'] & {
        departmentSkippedCount: number;
        userSkippedCount: number;
    };
}

