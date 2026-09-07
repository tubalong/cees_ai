/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AuthUser } from './AuthUser';
import type { MemberStatus } from './MemberStatus';
export type PlatformTenantAdministrator = {
    membershipId: string;
    account: string;
    user: AuthUser;
    status: MemberStatus;
    joinedAt: string;
};

