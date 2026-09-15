/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Conversation } from './Conversation';
import type { ConversationMessage } from './ConversationMessage';
export type ConversationDetail = {
    conversation: Conversation;
    /**
     * 按轮次顺序升序排列的最近消息，最多 100 条；同一轮次内按写入时间排序，跨轮次迟到的工具消息归位到所属轮次，不会插入后续轮次
     */
    messages: Array<ConversationMessage>;
};

