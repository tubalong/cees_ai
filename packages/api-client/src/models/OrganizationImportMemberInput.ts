/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type OrganizationImportMemberInput = {
    clientRef: string;
    /**
     * 前端完成拼音建议和冲突裁定后的最终账号
     */
    account: string;
    displayName: string;
    departmentClientRef: string;
    /**
     * 不传时使用批次 defaultRoleIds；第一版禁止 tenant_admin
     */
    roleIds?: Array<string>;
};

