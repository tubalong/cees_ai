/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { KnowledgeBaseMemberPermission } from './KnowledgeBaseMemberPermission';
export type KnowledgeBaseMember = {
    id: string;
    tenantId: string;
    knowledgeBaseId: string;
    membershipId: string;
    userId: string;
    account: string;
    displayName: string;
    permission: KnowledgeBaseMemberPermission;
    createdAt: string;
};

