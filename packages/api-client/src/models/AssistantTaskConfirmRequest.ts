/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AssistantTaskConfirmRequest = {
    /**
     * start 确认计划开始执行（确认后才派发步骤）；
     * revise 保留当前草案并记录调整意图（随后在对话中提出调整要求重新规划）。
     *
     */
    decision: AssistantTaskConfirmRequest.decision;
    /**
     * 关键待定项答复；decision=start 时必须覆盖全部待定项
     */
    answers?: Array<{
        key: string;
        /**
         * 所选选项 id
         */
        value: string;
    }>;
};
export namespace AssistantTaskConfirmRequest {
    /**
     * start 确认计划开始执行（确认后才派发步骤）；
     * revise 保留当前草案并记录调整意图（随后在对话中提出调整要求重新规划）。
     *
     */
    export enum decision {
        START = 'start',
        REVISE = 'revise',
    }
}

