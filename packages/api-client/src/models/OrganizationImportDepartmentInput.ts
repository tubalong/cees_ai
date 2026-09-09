/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type OrganizationImportDepartmentInput = {
    /**
     * 前端为本次导入生成的临时标识，不落库
     */
    clientRef: string;
    /**
     * 单级部门名称，不能包含斜杠
     */
    name: string;
    parentClientRef?: string | null;
    description?: string | null;
    sortOrder?: number;
};

