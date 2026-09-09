/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OrganizationImportDepartmentResult } from './OrganizationImportDepartmentResult';
import type { OrganizationImportMemberCredential } from './OrganizationImportMemberCredential';
import type { OrganizationImportSummary } from './OrganizationImportSummary';
export type OrganizationImportResult = {
    summary: OrganizationImportSummary;
    departments: Array<OrganizationImportDepartmentResult>;
    members: Array<OrganizationImportMemberCredential>;
};

