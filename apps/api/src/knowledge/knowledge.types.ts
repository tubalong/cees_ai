import type { KnowledgeBaseMemberPermission } from '@prisma/client';

export type { KnowledgeBaseMemberPermission };
export const KNOWLEDGE_BASE_MEMBER_PERMISSIONS = ['READER', 'EDITOR', 'MANAGER'] as const;

/** 库级归属（锚点）：PRIVATE 仅成员、DEPARTMENT 部门树成员、PROJECT 项目成员、TENANT 租户全员。 */
export const KNOWLEDGE_BASE_VISIBILITY_SCOPES = ['PRIVATE', 'DEPARTMENT', 'PROJECT', 'TENANT'] as const;
export type KnowledgeBaseVisibilityScope = typeof KNOWLEDGE_BASE_VISIBILITY_SCOPES[number];

export interface KnowledgeBaseResult {
    id: string;
    tenantId: string;
    name: string;
    description: string | null;
    visibilityScope: KnowledgeBaseVisibilityScope;
    departmentId: string | null;
    projectId: string | null;
    memberCount: number;
    createdBy: string | null;
    updatedBy: string | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface KnowledgeBaseListResult {
    items: KnowledgeBaseResult[];
    nextCursor: string | null;
}

/** 助手可见库清单项（块 7c）：可见知识库 + 当前用户的成员权限标注。 */
export interface AssistantKnowledgeBaseCandidate extends KnowledgeBaseResult {
    /** 当前用户对该库的成员权限；manage_all 权限短路时统一标为 MANAGER。 */
    myPermission: KnowledgeBaseMemberPermission;
}

export interface KnowledgeBaseMemberResult {
    id: string;
    tenantId: string;
    knowledgeBaseId: string;
    membershipId: string;
    userId: string;
    account: string;
    displayName: string;
    permission: KnowledgeBaseMemberPermission;
    createdAt: Date;
}

export interface KnowledgeBaseMemberListResult {
    items: KnowledgeBaseMemberResult[];
    nextCursor: string | null;
}

export const KNOWLEDGE_DOCUMENT_STATUSES = ['PENDING', 'PARSING', 'PARSED', 'INDEXING', 'READY', 'FAILED'] as const;
export type KnowledgeDocumentStatus = typeof KNOWLEDGE_DOCUMENT_STATUSES[number];

export const KNOWLEDGE_DOCUMENT_VISIBILITY_SCOPES = ['PRIVATE', 'DEPARTMENT', 'PROJECT', 'TENANT'] as const;
export type KnowledgeDocumentVisibilityScope = typeof KNOWLEDGE_DOCUMENT_VISIBILITY_SCOPES[number];

/** 转存来源类型（块 7c）：附件文件 / AI 生成文档 / 对话消息。 */
export const KNOWLEDGE_DOCUMENT_SOURCE_TYPES = ['FILE_OBJECT', 'DOCUMENT', 'MESSAGE'] as const;
export type KnowledgeDocumentSourceType = typeof KNOWLEDGE_DOCUMENT_SOURCE_TYPES[number];

export interface KnowledgeDocumentResult {
    id: string;
    tenantId: string;
    knowledgeBaseId: string;
    name: string;
    status: KnowledgeDocumentStatus;
    fileObjectId: string;
    versionNumber: number;
    currentVersionId: string | null;
    retryCount: number;
    lastError: string | null;
    visibilityScope: KnowledgeDocumentVisibilityScope;
    departmentId: string | null;
    projectId: string | null;
    createdBy: string | null;
    updatedBy: string | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface KnowledgeDocumentListResult {
    items: KnowledgeDocumentResult[];
    nextCursor: string | null;
}

export interface KnowledgeQueryCitationResult {
    citationId: string;
    documentId: string;
    documentVersionId: string;
    chunkId: string;
    text: string;
    score?: number;
    pageIndex?: number | null;
    bbox?: [number, number, number, number] | null;
}

export interface KnowledgeQueryResult {
    answer: string;
    grounded: boolean;
    insufficientEvidence: boolean;
    citations: KnowledgeQueryCitationResult[];
}

/** 助手工具检索结果：citation 只含业务内容（文档 ID、标题、片段、页码），不含内部 chunk 标识。 */
export interface AssistantKnowledgeSearchResult {
    answer: string;
    grounded: boolean;
    insufficientEvidence: boolean;
    citations: {
        id: string;
        title: string;
        snippet: string;
        pageIndex: number | null;
    }[];
    searchedKnowledgeBaseIds: string[];
}
