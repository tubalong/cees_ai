/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatContextStrategy } from './ChatContextStrategy';
export type ChatContextUsage = {
    strategy: ChatContextStrategy;
    /**
     * API 向 ai-service 提交的消息条数
     */
    receivedMessageCount: number;
    /**
     * 上下文预算处理后实际纳入的消息条数
     */
    includedMessageCount: number;
    /**
     * 是否因上下文预算舍弃了较早消息
     */
    historyTruncated: boolean;
    /**
     * ai-service 在模型调用前估算的输入 Token
     */
    estimatedInputTokens: number;
};

