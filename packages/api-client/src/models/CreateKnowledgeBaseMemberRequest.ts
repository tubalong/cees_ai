/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { KnowledgeBaseMemberPermission } from './KnowledgeBaseMemberPermission';
export type CreateKnowledgeBaseMemberRequest = {
    /**
     * 当前租户成员 ID，而不是全局用户 ID
     */
    membershipId: string;
    permission: KnowledgeBaseMemberPermission;
};

