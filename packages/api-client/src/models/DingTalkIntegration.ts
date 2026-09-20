/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DingTalkIntegrationMode } from './DingTalkIntegrationMode';
import type { DingTalkIntegrationStatus } from './DingTalkIntegrationStatus';
export type DingTalkIntegration = {
    id: string;
    tenantId: string;
    mode: DingTalkIntegrationMode;
    corpId: string | null;
    appKey: string | null;
    authorizedByMembershipId: string | null;
    authorizedExternalUserId: string | null;
    authorizedProfile: string | null;
    grantedCapabilities: Array<string>;
    status: DingTalkIntegrationStatus;
    lastVerifiedAt: string | null;
    lastSyncedAt: string | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
};

