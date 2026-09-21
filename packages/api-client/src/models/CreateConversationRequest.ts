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
    /**
     * GENERAL 为通用会话，PROJECT 为固定项目上下文会话
     */
    contextType?: CreateConversationRequest.contextType;
    /**
     * PROJECT 会话必填；GENERAL 会话必须为空
     */
    projectId?: string | null;
};
export namespace CreateConversationRequest {
    /**
     * GENERAL 为通用会话，PROJECT 为固定项目上下文会话
     */
    export enum contextType {
        GENERAL = 'GENERAL',
        PROJECT = 'PROJECT',
    }
}

