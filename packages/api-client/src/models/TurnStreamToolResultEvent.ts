/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { KnowledgeToolCitation } from './KnowledgeToolCitation';
import type { ToolResultConfirmation } from './ToolResultConfirmation';
import type { ToolResultResourceReference } from './ToolResultResourceReference';
import type { ToolSource } from './ToolSource';
/**
 * 工具执行完成、失败或被 API 拒绝时发送的事件。
 */
export type TurnStreamToolResultEvent = {
    type: 'tool_result';
    /**
     * 轮次内递增的事件序号
     */
    seq: number;
    /**
     * 对应 TurnStreamToolCallEvent 中的 toolCallId
     */
    toolCallId: string;
    /**
     * 工具执行结果状态；awaiting_confirmation 表示写操作已生成待确认草稿，副作用尚未发生
     */
    status: TurnStreamToolResultEvent.status;
    /**
     * 工具生成的稳定正式资源引用；访问 URL 必须通过对应资源接口按需获取（图片为 GET /api/v1/images/{imageId}）；事件与历史消息一律不携带签名 URL
     */
    resource: (ToolResultResourceReference | null);
    /**
     * 联网搜索等非资源型工具返回的结构化来源；老客户端可忽略该字段
     */
    sources?: Array<ToolSource>;
    /**
     * 知识库检索工具命中的文档引用；老客户端可忽略该字段
     */
    citations?: Array<KnowledgeToolCitation>;
    /**
     * 写操作的待确认预览；status 为 awaiting_confirmation 时必定存在
     */
    confirmation?: (ToolResultConfirmation | null);
    /**
     * 工具失败或被拒绝时的错误信息
     */
    error: any | null;
};
export namespace TurnStreamToolResultEvent {
    /**
     * 工具执行结果状态；awaiting_confirmation 表示写操作已生成待确认草稿，副作用尚未发生
     */
    export enum status {
        COMPLETED = 'completed',
        FAILED = 'failed',
        REJECTED = 'rejected',
        AWAITING_CONFIRMATION = 'awaiting_confirmation',
    }
}

