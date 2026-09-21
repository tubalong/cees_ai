/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatMode } from './ChatMode';
import type { ConversationContextType } from './ConversationContextType';
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
    contextType: ConversationContextType;
    /**
     * 项目上下文会话绑定的项目 ID
     */
    projectId: string | null;
    /**
     * 会话默认对话执行模式；发起轮次未显式指定 mode 时使用
     */
    mode?: ChatMode;
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

