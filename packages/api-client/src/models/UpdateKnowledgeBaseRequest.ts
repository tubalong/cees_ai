/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { KnowledgeBaseVisibilityScope } from './KnowledgeBaseVisibilityScope';
export type UpdateKnowledgeBaseRequest = {
    name?: string;
    description?: string | null;
    /**
     * 归属范围；未提供的锚点字段保持现值
     */
    visibilityScope?: KnowledgeBaseVisibilityScope;
    /**
     * 归属部门，必须属于当前租户；仅 DEPARTMENT 时使用，传 null 清除锚点
     */
    departmentId?: string | null;
    /**
     * 归属项目，必须属于当前租户；仅 PROJECT 时使用，传 null 清除锚点
     */
    projectId?: string | null;
    version: number;
};

