/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AuthMembership } from './AuthMembership';
import type { AuthTenant } from './AuthTenant';
import type { AuthUser } from './AuthUser';
export type MeResponse = {
    user: AuthUser;
    tenant: AuthTenant;
    membership: AuthMembership;
    permissions: Array<string>;
};

