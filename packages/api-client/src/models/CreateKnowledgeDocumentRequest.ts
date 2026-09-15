/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { KnowledgeDocumentVisibilityScope } from './KnowledgeDocumentVisibilityScope';
export type CreateKnowledgeDocumentRequest = {
    /**
     * 已上传完成的文件对象 ID
     */
    fileObjectId: string;
    name: string;
    visibilityScope: KnowledgeDocumentVisibilityScope;
    /**
     * 可见范围为 DEPARTMENT 时必填
     */
    departmentId?: string | null;
    /**
     * 可见范围为 PROJECT 时必填
     */
    projectId?: string | null;
};

