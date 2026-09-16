/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 知识库检索命中的文档引用，属于 CEES 正式业务资源
 */
export type KnowledgeToolCitation = {
    /**
     * 知识库文档 ID
     */
    id: string;
    /**
     * 文档标题
     */
    title: string;
    /**
     * 命中的正文片段
     */
    snippet: string;
    /**
     * 命中文档页码；解析器未提供页码时为 null
     */
    pageIndex?: number | null;
};

