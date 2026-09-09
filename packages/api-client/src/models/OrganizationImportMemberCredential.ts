/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type OrganizationImportMemberCredential = {
    clientRef: string;
    membershipId: string;
    displayName: string;
    account: string;
    departmentId: string;
    departmentPath: string;
    tenantCode: string;
    /**
     * 一次性明文激活令牌，仅在确认导入响应返回
     */
    activationToken: string;
    activationExpiresAt: string;
};

