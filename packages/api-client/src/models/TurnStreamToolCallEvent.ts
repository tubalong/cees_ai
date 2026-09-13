/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 模型请求执行一个受控工具；具体是否执行由 API 根据权限、能力和额度决定。
 */
export type TurnStreamToolCallEvent = {
    type: 'tool_call';
    /**
     * 轮次内递增的事件序号
     */
    seq: number;
    /**
     * 本次工具调用的稳定标识
     */
    toolCallId: string;
    /**
     * 模型请求执行的受控工具名
     */
    name: string;
    /**
     * 模型生成并经过 API 校验的工具参数
     */
    arguments: Record<string, any>;
};

