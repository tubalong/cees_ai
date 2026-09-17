/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { KnowledgeBaseVisibilityScope } from './KnowledgeBaseVisibilityScope';
export type KnowledgeBase = {
    id: string;
    tenantId: string;
    name: string;
    description: string | null;
    visibilityScope: KnowledgeBaseVisibilityScope;
    /**
     * 归属锚点；DEPARTMENT 时挂部门，其余为空
     */
    departmentId: string | null;
    /**
     * 归属锚点；PROJECT 时挂项目，其余为空
     */
    projectId: string | null;
    memberCount: number;
    createdBy: string | null;
    updatedBy: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
};

