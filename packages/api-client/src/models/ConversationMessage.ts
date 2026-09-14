/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ConversationMessageRole } from './ConversationMessageRole';
export type ConversationMessage = {
    /**
     * 服务端生成的消息 ID
     */
    id: string;
    role: ConversationMessageRole;
    /**
     * 消息正文
     */
    content: string;
    /**
     * Stable image FileObject IDs; signed URLs are resolved only at model invocation time
     */
    imageFileIds: Array<string>;
    /**
     * 消息写入时间
     */
    createdAt: string;
    /**
     * 消息归属的轮次；未关联轮次时为 null
     */
    turnId?: string | null;
    /**
     * TOOL 角色消息对应的工具调用 ID；其他角色为 null
     */
    toolCallId?: string | null;
};

