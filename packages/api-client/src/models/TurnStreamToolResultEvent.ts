/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
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
     * 工具执行生成的正式资源 ID，例如图片资源 ID
     */
    resourceId?: string | null;
    /**
     * 工具执行生成的资源短期访问 URL
     */
    resourceUrl?: string | null;
    /**
     * 工具失败或被拒绝时的错误信息
     */
    error?: any | null;
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

