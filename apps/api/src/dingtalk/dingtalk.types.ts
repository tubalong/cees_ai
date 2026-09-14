import {
    DingTalkIntegrationStatus,
    DingTalkSyncJobStatus,
    DingTalkSyncType,
} from '@prisma/client';

export interface DingTalkIntegrationResult {
    id: string;
    tenantId: string;
    corpId: string;
    appKey: string;
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

