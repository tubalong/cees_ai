/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DingTalkSyncJobStatus } from './DingTalkSyncJobStatus';
import type { DingTalkSyncType } from './DingTalkSyncType';
export type DingTalkSyncJob = {
    id: string;
    integrationId: string;
    type: DingTalkSyncType;
    status: DingTalkSyncJobStatus;
    departmentCount: number;
    userCount: number;
    errorCode: string | null;
    errorMessage: string | null;
    startedAt: string;
    completedAt: string | null;
    createdAt: string;
};

