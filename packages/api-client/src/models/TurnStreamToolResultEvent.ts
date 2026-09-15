/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
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
     * 工具执行结果状态
     */
    status: TurnStreamToolResultEvent.status;
    /**
     * 工具生成的稳定正式资源引用；访问 URL 必须通过对应资源接口按需获取
     */
    resource: (ToolResultResourceReference | null);
    /**
     * 联网搜索等非资源型工具返回的结构化来源；老客户端可忽略该字段
     */
    sources?: Array<ToolSource>;
    /**
     * 工具失败或被拒绝时的错误信息
     */
    error: any | null;
};
export namespace TurnStreamToolResultEvent {
    /**
     * 工具执行结果状态
     */
    export enum status {
        COMPLETED = 'completed',
        FAILED = 'failed',
        REJECTED = 'rejected',
    }
}

