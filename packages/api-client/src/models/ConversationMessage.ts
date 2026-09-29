/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ConnectorContext } from './ConnectorContext';
import type { ConversationMessageRole } from './ConversationMessageRole';
import type { KnowledgeToolCitation } from './KnowledgeToolCitation';
import type { ToolResultResourceReference } from './ToolResultResourceReference';
import type { ToolSource } from './ToolSource';
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
     * 用户消息引用的稳定图片文件 ID（用户输入的附件），仅用户消息可能非空；展示/下载地址由前端通过文件接口按需获取
     */
    imageFileIds: Array<string>;
    /**
     * 用户消息在该轮提交的已脱敏连接器上下文；其他角色固定为空数组。用于恢复连接器授权提示等确定性交互，不作为 CEES 权限或业务事实依据
     */
    connectorContexts: Array<ConnectorContext>;
    /**
     * 当前管理页面提供的结构化 AI 助手上下文；只用于本轮回答，不作为业务写入或权限依据
     */
    assistantContext?: Record<string, any>;
    /**
     * 图片或文档生成的界面选择；作为结构化指令传递，不写入用户正文
     */
    generationOptions?: Record<string, any>;
    /**
     * 工具产生的稳定正式资源引用（IMAGE 为 AI 生成图片、DOCUMENT 为 AI 生成文档）；非 TOOL 消息为空数组；资源访问 URL 必须通过对应资源接口按需获取（图片为 GET /api/v1/images/{imageId}），消息正文不携带签名 URL
     */
    resources: Array<ToolResultResourceReference>;
    /**
     * TOOL 消息对应工具调用返回的结构化来源（联网搜索等非资源型工具）；其他角色固定为空数组；来源按轮次归属，老客户端可忽略该字段
     */
    sources?: Array<ToolSource>;
    /**
     * TOOL 消息对应工具调用返回的知识库文档引用；其他角色固定为空数组；引用按轮次归属，老客户端可忽略该字段
     */
    citations?: Array<KnowledgeToolCitation>;
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

