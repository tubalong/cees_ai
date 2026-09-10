/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatContextUsage } from './ChatContextUsage';
import type { ChatMode } from './ChatMode';
export type ChatStreamStartedEvent = {
    type: 'started';
    /**
     * 公开 API 请求追踪 ID
     */
    requestId: string;
    /**
     * 请求中的客户端本地会话标识
     */
    conversationId: string;
    /**
     * 请求中的客户端本地轮次标识
     */
    turnId: string;
    mode: ChatMode;
    contextUsage: ChatContextUsage;
};

