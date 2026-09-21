/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DingTalkSyncJobStatus } from './DingTalkSyncJobStatus';
import type { DingTalkSyncScope } from './DingTalkSyncScope';
import type { DingTalkSyncSource } from './DingTalkSyncSource';
import type { DingTalkSyncType } from './DingTalkSyncType';
export type DingTalkSyncJob = {
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
    startedAt: string;
    completedAt: string | null;
    createdAt: string;
};

