/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UserProfileDepartment } from './UserProfileDepartment';
export type UserProfile = {
    userId: string;
    membershipId: string;
    tenantId: string;
    /**
     * 当前租户登录账号，只读
     */
    account: string;
    displayName: string;
    department: (UserProfileDepartment | null);
    version: number;
    updatedAt: string;
};

