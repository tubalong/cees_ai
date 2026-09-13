/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Conversation } from './Conversation';
export type ConversationListResult = {
    /**
     * 按更新时间倒序排列的会话
     */
    items: Array<Conversation>;
    /**
     * 下一页游标；没有更多数据时为 null
     */
    nextCursor: string | null;
};

