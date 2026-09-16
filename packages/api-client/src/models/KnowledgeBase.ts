/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type KnowledgeBase = {
    id: string;
    tenantId: string;
    name: string;
    description: string | null;
    /**
     * 归属部门；不填为公司级知识库，与 projectId 二选一
     */
    departmentId?: string | null;
    /**
     * 归属项目；不填为公司级知识库，与 departmentId 二选一
     */
    projectId?: string | null;
    memberCount: number;
    createdBy: string | null;
    updatedBy: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
};

