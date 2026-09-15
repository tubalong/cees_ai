/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatMode } from './ChatMode';
export type CreateConversationRequest = {
    title?: string | null;
    /**
     * 会话默认对话执行模式；省略时使用 standard
     */
    mode?: ChatMode;
};

