/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Conversation } from './Conversation';
export type ConversationResponseEnvelope = {
    success: boolean;
    data: Conversation;
    /**
     * 公开 API 请求追踪 ID
     */
    requestId?: string | null;
};

