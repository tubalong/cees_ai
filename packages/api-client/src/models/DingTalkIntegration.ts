/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type DingTalkIntegration = {
    id: string;
    tenantId: string;
    corpId: string;
    appKey: string;
    status: DingTalkIntegration.status;
    lastVerifiedAt: string | null;
    lastSyncedAt: string | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
};
export namespace DingTalkIntegration {
    export enum status {
        ACTIVE = 'ACTIVE',
        DISABLED = 'DISABLED',
    }
}

