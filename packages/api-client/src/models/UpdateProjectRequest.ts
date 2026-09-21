/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type UpdateProjectRequest = {
    name?: string;
    description?: string | null;
    /**
     * 归属部门，仅用于归属、筛选和统计，不授予任何访问权限
     */
    departmentId?: string | null;
    version: number;
};

