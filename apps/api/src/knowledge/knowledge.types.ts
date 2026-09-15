export const KNOWLEDGE_BASE_MEMBER_PERMISSIONS = ['READER', 'EDITOR', 'MANAGER'] as const;
export type KnowledgeBaseMemberPermission = typeof KNOWLEDGE_BASE_MEMBER_PERMISSIONS[number];

export interface KnowledgeBaseResult {
    id: string;
    tenantId: string;
    name: string;
    description: string | null;
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
