/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatAssistantMessage } from './ChatAssistantMessage';
import type { ChatContextUsage } from './ChatContextUsage';
import type { ChatMode } from './ChatMode';
import type { ChatTokenUsage } from './ChatTokenUsage';
export type ChatInvokeResult = {
    /**
     * 请求中的客户端本地会话标识
     */
    conversationId: string;
    /**
     * 请求中的客户端本地轮次标识
     */
    turnId: string;
    mode: ChatMode;
    message: ChatAssistantMessage;
    contextUsage: ChatContextUsage;
    tokenUsage: ChatTokenUsage;
    /**
     * ai-service 报告的模型调用耗时，单位毫秒
     */
    latencyMs: number;
    /**
     * Provider 结束原因；length 表示回答可能被输出上限截断
     */
    finishReason: string | null;
};

