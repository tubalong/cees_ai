/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { KnowledgeBaseVisibilityScope } from './KnowledgeBaseVisibilityScope';
export type AssistantTaskOutputConfirmedEvent = {
    type: 'output_confirmed';
    seq: number;
    /**
     * 产出资产 ID（步骤回流的 AI 文档）
     */
    documentId: string;
    /**
     * 归档目标知识库
     */
    knowledgeBaseId: string;
    /**
     * 知识库侧文档 ID（同源重复转存追加版本，不重复归档）
     */
    knowledgeDocumentId: string;
    /**
     * 归档库的可见范围（公司库全员可检索 / 部门库本部门 / 项目库项目成员 / 个人库仅本人）
     */
    visibilityScope: KnowledgeBaseVisibilityScope;
};

