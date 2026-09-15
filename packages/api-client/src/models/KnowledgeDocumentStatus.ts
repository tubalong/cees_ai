/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 知识库文档处理状态；PENDING 等待处理，PARSING 解析中，PARSED 解析完成，INDEXING 建立索引中，READY 可检索，FAILED 处理失败
 */
export enum KnowledgeDocumentStatus {
    PENDING = 'PENDING',
    PARSING = 'PARSING',
    PARSED = 'PARSED',
    INDEXING = 'INDEXING',
    READY = 'READY',
    FAILED = 'FAILED',
}
