/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ConversationVisibility } from './ConversationVisibility';
export type Conversation = {
    /**
     * 会话 ID
     */
    id: string;
    /**
     * 会话标题；未自动生成前为空字符串
     */
    title: string;
    visibility: ConversationVisibility;
    /**
     * 会话创建时间
     */
    createdAt: string;
    /**
     * 会话最近更新时间
     */
    updatedAt: string;
    /**
     * 最近一轮发起时间；尚未发起过轮次时为 null
     */
    lastTurnAt?: string | null;
    /**
     * 会话资源版本；创建、发起轮次、改标题和删除都会递增
     */
    version: number;
};

