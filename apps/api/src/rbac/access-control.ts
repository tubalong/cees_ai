export type DataScope = 'SELF' | 'DEPARTMENT' | 'DEPARTMENT_TREE' | 'PROJECT' | 'CUSTOM' | 'TENANT';

export interface DataScopeConstraint {
    scope: DataScope;
    userIds?: string[];
    departmentIds?: string[];
    projectIds?: string[];
}

export interface DataScopeResolution {
    scopes: DataScope[];
    tenantWide: boolean;
    membershipIds: string[];
    departmentIds: string[];
    projectIds: string[];
}

export interface ResourceAclChecker {
    canAccess(input: { tenantId: string; userId: string; resourceType: string; resourceId: string }): Promise<boolean>;
}
