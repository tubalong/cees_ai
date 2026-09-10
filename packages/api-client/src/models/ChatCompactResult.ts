/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatTokenUsage } from './ChatTokenUsage';
export type ChatCompactResult = {
    /**
     * 请求中的客户端本地会话标识
     */
    conversationId: string;
    /**
     * 请求中的客户端本地轮次标识
     */
    turnId: string;
    /**
     * 新摘要正文，由客户端保存到本地
     */
    summary: string;
    /**
     * 已压缩到的最后一条本地消息 ID
     */
    summarizedThroughMessageId: string | null;
    tokenUsage: ChatTokenUsage;
    /**
     * ai-service 报告的模型调用耗时，单位毫秒
     */
    latencyMs: number;
    /**
     * Provider 结束原因
     */
    finishReason: string | null;
};

