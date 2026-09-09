export type OrganizationImportDepartmentAction = 'CREATE' | 'REUSE';
export type OrganizationImportIssueScope = 'REQUEST' | 'DEPARTMENT' | 'MEMBER';

export interface OrganizationImportIssue {
    scope: OrganizationImportIssueScope;
    clientRef: string | null;
    field: string | null;
    code: string;
    message: string;
}

export interface OrganizationImportSummary {
    departmentCount: number;
    departmentCreateCount: number;
    departmentReuseCount: number;
    memberCount: number;
}

export interface OrganizationImportDepartmentPreview {
    clientRef: string;
    action: OrganizationImportDepartmentAction;
    departmentId: string | null;
    path: string;
}

export interface OrganizationImportMemberPreview {
    clientRef: string;
    account: string;
    displayName: string;
    departmentClientRef: string;
    departmentPath: string;
    effectiveRoleIds: string[];
}

export interface OrganizationImportValidationResult {
    valid: boolean;
    summary: OrganizationImportSummary;
    departments: OrganizationImportDepartmentPreview[];
    members: OrganizationImportMemberPreview[];
    issues: OrganizationImportIssue[];
}

export interface OrganizationImportDepartmentResult {
    clientRef: string;
    departmentId: string;
    action: OrganizationImportDepartmentAction;
    path: string;
}

export interface OrganizationImportMemberCredential {
    clientRef: string;
    membershipId: string;
    displayName: string;
    account: string;
    departmentId: string;
    departmentPath: string;
    tenantCode: string;
    activationToken: string;
    activationExpiresAt: Date;
}

export interface OrganizationImportResult {
    summary: OrganizationImportSummary;
    departments: OrganizationImportDepartmentResult[];
    members: OrganizationImportMemberCredential[];
}
