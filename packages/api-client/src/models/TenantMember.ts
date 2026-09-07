/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AuthUser } from './AuthUser';
import type { MemberStatus } from './MemberStatus';
import type { TenantMemberRole } from './TenantMemberRole';
export type TenantMember = {
    id: string;
    account: string;
    user: AuthUser;
    departmentId?: string | null;
    status: MemberStatus;
    roles: Array<TenantMemberRole>;
    joinedAt: string;
    version: number;
};

