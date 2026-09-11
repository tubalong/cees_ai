/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Conversation } from './Conversation';
import type { ConversationMessage } from './ConversationMessage';
export type ConversationDetail = {
    conversation: Conversation;
    /**
     * 按时间升序排列的最近消息，最多 100 条
     */
    messages: Array<ConversationMessage>;
};

