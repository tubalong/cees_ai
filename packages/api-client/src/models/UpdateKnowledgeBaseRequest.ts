/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type UpdateKnowledgeBaseRequest = {
    name?: string;
    description?: string | null;
    /**
     * 归属部门；与 projectId 二选一
     */
    departmentId?: string | null;
    /**
     * 归属项目；与 departmentId 二选一
     */
    projectId?: string | null;
    version: number;
};

