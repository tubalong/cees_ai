/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OrganizationImportDepartmentInput } from './OrganizationImportDepartmentInput';
import type { OrganizationImportMemberInput } from './OrganizationImportMemberInput';
export type OrganizationImportRequest = {
    /**
     * 批次默认角色；第一版禁止 tenant_admin
     */
    defaultRoleIds: Array<string>;
    departments: Array<OrganizationImportDepartmentInput>;
    members: Array<OrganizationImportMemberInput>;
    activationExpiresInDays?: number;
};

