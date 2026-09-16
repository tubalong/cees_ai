/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type KnowledgeQueryCitation = {
    /**
     * 答案中引用的短编号，如 S1
     */
    citationId: string;
    documentId: string;
    documentVersionId: string;
    /**
     * 向量库 chunk 标识
     */
    chunkId: string;
    /**
     * 引用原文片段
     */
    text: string;
    /**
     * 向量相似度得分
     */
    score?: number;
    /**
     * 原文页码，从 0 开始
     */
    pageIndex?: number | null;
    /**
     * 页内定位框 [x0, y0, x1, y1]
     */
    bbox?: any[] | null;
};

