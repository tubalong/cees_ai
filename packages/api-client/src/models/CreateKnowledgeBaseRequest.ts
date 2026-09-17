/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { KnowledgeBaseVisibilityScope } from './KnowledgeBaseVisibilityScope';
export type CreateKnowledgeBaseRequest = {
    name: string;
    description?: string | null;
    /**
     * 归属范围，默认 PRIVATE；DEPARTMENT 必填 departmentId，PROJECT 必填 projectId，两者互斥
     */
    visibilityScope?: KnowledgeBaseVisibilityScope;
    /**
     * 归属部门，必须属于当前租户；仅 DEPARTMENT 时使用
     */
    departmentId?: string;
    /**
     * 归属项目，必须属于当前租户；仅 PROJECT 时使用
     */
    projectId?: string;
};

