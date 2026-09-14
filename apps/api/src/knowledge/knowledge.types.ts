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
