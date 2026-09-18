/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type KnowledgeQueryRequest = {
    /**
     * 提问内容
     */
    query: string;
    /**
     * 向量索引版本；不填使用服务端默认版本
     */
    indexVersion?: string | null;
};

