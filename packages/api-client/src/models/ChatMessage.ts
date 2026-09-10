/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatMessageRole } from './ChatMessageRole';
export type ChatMessage = {
    /**
     * 客户端本地生成并保存的消息稳定标识
     */
    id: string;
    role: ChatMessageRole;
    /**
     * 仅用于本次模型调用的消息正文，API 不持久化
     */
    content: string;
};

