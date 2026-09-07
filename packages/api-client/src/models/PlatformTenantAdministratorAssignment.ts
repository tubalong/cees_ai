/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PlatformTenantAdministrator } from './PlatformTenantAdministrator';
import type { TenantAdministratorAssignmentStatus } from './TenantAdministratorAssignmentStatus';
import type { TenantInvitation } from './TenantInvitation';
export type PlatformTenantAdministratorAssignment = {
    status: TenantAdministratorAssignmentStatus;
    administrator?: PlatformTenantAdministrator;
    invitation?: TenantInvitation;
    invitationToken?: string;
};

