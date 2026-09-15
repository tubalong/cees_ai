/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 联网搜索返回的公开网页来源，不代表 CEES 正式业务资源
 */
export type ToolSource = {
    /**
     * 当前工具调用内稳定的来源 ID
     */
    id: string;
    title: string;
    url: string;
    domain: string;
    snippet: string;
    publishedAt: string | null;
};

