/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TenantStatus } from './TenantStatus';
export type PlatformTenantDetail = {
    id: string;
    code: string;
    name: string;
    status: TenantStatus;
    activeAdministratorCount: number;
    pendingInvitationCount: number;
    version: number;
    createdAt: string;
    updatedAt: string;
};

