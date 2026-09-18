/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 本轮实际生效的对话能力；由显式开关与服务端意图自动启用合并后得出
 */
export type TurnCapabilities = {
    /**
     * 本轮实际是否启用联网搜索
     */
    webSearch: boolean;
    /**
     * 本轮实际是否启用知识库检索
     */
    knowledgeBase: boolean;
    /**
     * 由服务端意图识别自动启用的能力标识；用户显式开启的不计入，供前端展示透明提示
     */
    autoEnabled: Array<'web_search' | 'knowledge_search'>;
};

