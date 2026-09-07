/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TenantInvitationStatus } from './TenantInvitationStatus';
export type TenantInvitation = {
    id: string;
    tenantId: string;
    account: string;
    displayName?: string | null;
    status: TenantInvitationStatus;
    isInitialAdministrator: boolean;
    roleIds: Array<string>;
    expiresAt: string;
    createdAt: string;
};

