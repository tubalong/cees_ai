/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatMode } from './ChatMode';
export type CreateTurnRequest = {
    /**
     * 本轮 user 消息正文；历史消息与摘要由服务端加载
     */
    content?: string | null;
    /**
     * Stable image FileObject IDs referenced by this user message
     */
    imageFileIds?: Array<string>;
    /**
     * 本轮对话执行模式；省略时使用会话的默认模式
     */
    mode?: ChatMode;
    /**
     * 本轮是否允许检索知识库；省略时默认关闭。开启后 AI 可获得知识库检索工具，检索范围按用户权限折叠
     */
    knowledgeBaseEnabled?: boolean;
};

