/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatMessage } from './ChatMessage';
import type { ChatMode } from './ChatMode';
export type ChatRequest = {
    /**
     * 客户端本地会话标识，仅用于调用关联和 Token 统计
     */
    conversationId: string;
    /**
     * 客户端本地轮次标识；同一轮的压缩和回答调用使用同一值
     */
    turnId: string;
    mode?: ChatMode;
    /**
     * 客户端本地保存的早期历史摘要；省略或 null 表示没有摘要
     */
    conversationSummary?: string | null;
    /**
     * 按时间升序排列的近期消息；最后一条必须是本轮 user 消息
     */
    messages: Array<ChatMessage>;
};

