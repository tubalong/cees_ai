/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatMode } from './ChatMode';
import type { ConnectorContext } from './ConnectorContext';
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
     * Stable document FileObject IDs referenced by this user message; the API extracts text and injects it into the trusted conversation context
     */
    fileIds?: Array<string>;
    /**
     * 本轮对话执行模式；省略时使用会话的默认模式
     */
    mode?: ChatMode;
    /**
     * 本轮是否允许检索知识库；省略时默认关闭。开启后 AI 可获得知识库检索工具，检索范围按用户权限折叠
     */
    knowledgeBaseEnabled?: boolean;
    /**
     * 本轮是否允许联网搜索；省略时默认关闭。关闭时 AI 不获得联网检索工具；若用户消息明确提到需要联网，服务端可为本轮自动临时启用并在 started 事件回传（见 TurnCapabilities.autoEnabled）
     */
    webSearchEnabled?: boolean;
    /**
     * Desktop 从用户已授权的本地连接器取得的本轮结构化结果；不会作为业务事实或后续写操作权限依据
     */
    connectorContexts?: Array<ConnectorContext>;
};

