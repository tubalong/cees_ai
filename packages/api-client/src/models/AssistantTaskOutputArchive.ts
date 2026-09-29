/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { KnowledgeBaseVisibilityScope } from './KnowledgeBaseVisibilityScope';
export type AssistantTaskOutputArchive = {
    /**
     * 归档目标知识库
     */
    knowledgeBaseId: string;
    /**
     * 知识库侧文档 ID（转存产物；同源重复转存追加版本）
     */
    knowledgeDocumentId: string;
    /**
     * 归档库的可见范围（公司库全员可检索 / 部门库本部门 / 项目库项目成员 / 个人库仅本人）
     */
    visibilityScope: KnowledgeBaseVisibilityScope;
    /**
     * 验收归档时间
     */
    confirmedAt: string;
};

