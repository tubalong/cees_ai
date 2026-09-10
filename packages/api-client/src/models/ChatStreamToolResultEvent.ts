/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatStreamErrorDetail } from './ChatStreamErrorDetail';
/**
 * 工具执行完成、失败或被 API 拒绝时发送的事件。
 */
export type ChatStreamToolResultEvent = {
    type: 'tool_result';
    /**
     * 对应 ChatStreamToolCallEvent 中的 toolCallId
     */
    toolCallId: string;
    /**
     * 工具执行结果状态
     */
    status: ChatStreamToolResultEvent.status;
    /**
     * 工具执行生成的正式资源 ID，例如图片资源 ID
     */
    resourceId?: string | null;
    /**
     * 工具执行生成的资源短期访问 URL
     */
    resourceUrl?: string | null;
    error?: ChatStreamErrorDetail;
};
export namespace ChatStreamToolResultEvent {
    /**
     * 工具执行结果状态
     */
    export enum status {
        COMPLETED = 'completed',
        FAILED = 'failed',
        REJECTED = 'rejected',
    }
}

