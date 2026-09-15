/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { KnowledgeDocumentStatus } from './KnowledgeDocumentStatus';
import type { KnowledgeDocumentVisibilityScope } from './KnowledgeDocumentVisibilityScope';
export type KnowledgeDocument = {
    id: string;
    tenantId: string;
    knowledgeBaseId: string;
    name: string;
    status: KnowledgeDocumentStatus;
    /**
     * 当前版本对应的文件对象 ID
     */
    fileObjectId: string;
    /**
     * 当前版本号
     */
    versionNumber: number;
    /**
     * 当前处理中的文档版本 ID
     */
    currentVersionId: string;
    retryCount: number;
    lastError: string | null;
    visibilityScope: KnowledgeDocumentVisibilityScope;
    departmentId: string | null;
    projectId: string | null;
    createdBy: string | null;
    updatedBy: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
};

