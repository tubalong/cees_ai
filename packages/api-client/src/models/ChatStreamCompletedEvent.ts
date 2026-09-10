/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ChatStreamCompletedEvent = {
    type: 'completed';
    /**
     * ai-service 报告的模型调用耗时，单位毫秒
     */
    latencyMs: number;
    /**
     * Provider 结束原因；length 表示回答可能被输出上限截断
     */
    finishReason: string | null;
};

