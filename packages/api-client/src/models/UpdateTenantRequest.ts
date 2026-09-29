/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type UpdateTenantRequest = {
    name?: string;
    /**
     * IANA 时区标识；与 name 至少提供一个，非法标识返回 400 TENANT_TIMEZONE_INVALID
     */
    timezone?: string;
    /**
     * 连接器读操作审计开关；省略表示不修改。与 name / timezone 至少提供一个
     */
    connectorReadAuditEnabled?: boolean;
    version: number;
};

