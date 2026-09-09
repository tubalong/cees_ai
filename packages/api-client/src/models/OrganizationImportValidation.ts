/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OrganizationImportDepartmentPreview } from './OrganizationImportDepartmentPreview';
import type { OrganizationImportIssue } from './OrganizationImportIssue';
import type { OrganizationImportMemberPreview } from './OrganizationImportMemberPreview';
import type { OrganizationImportSummary } from './OrganizationImportSummary';
export type OrganizationImportValidation = {
    valid: boolean;
    summary: OrganizationImportSummary;
    departments: Array<OrganizationImportDepartmentPreview>;
    members: Array<OrganizationImportMemberPreview>;
    issues: Array<OrganizationImportIssue>;
};

