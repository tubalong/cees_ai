/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatMessage } from './ChatMessage';
export type ChatCompactRequest = {
    /**
     * 客户端本地会话标识，仅用于调用关联和 Token 统计
     */
    conversationId: string;
    /**
     * 本次压缩归属的客户端本地轮次标识
     */
    turnId: string;
    /**
     * 客户端本地保存的上一版摘要；省略或 null 表示首次压缩
     */
    previousSummary?: string | null;
    /**
     * 要压缩的本地历史消息，按时间升序排列
     */
    messages: Array<ChatMessage>;
};

