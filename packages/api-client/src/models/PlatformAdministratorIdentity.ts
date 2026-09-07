/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AuthUser } from './AuthUser';
import type { PlatformRole } from './PlatformRole';
export type PlatformAdministratorIdentity = {
    id: string;
    account: string;
    user: AuthUser;
    role: PlatformRole;
    permissions: Array<string>;
};

