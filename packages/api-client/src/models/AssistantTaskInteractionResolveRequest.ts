/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AssistantTaskInteractionResolveRequest = {
    /**
     * 解决动作：approve / reject 授权批准或拒绝（仅 AUTHORIZATION）；
     * answer 提问答复（仅 QUESTION）；choose 裁决选项（仅 DECISION）。
     *
     */
    decision: AssistantTaskInteractionResolveRequest.decision;
    /**
     * 临时授权范围（仅 decision=approve）；ONCE 仅本次（缺省）；TASK 本任务内允许多次使用
     */
    scope?: AssistantTaskInteractionResolveRequest.scope;
    /**
     * 所选候选 id 或答复文本（answer / choose 必填；approve / reject 忽略）
     */
    value?: string | null;
};
export namespace AssistantTaskInteractionResolveRequest {
    /**
     * 解决动作：approve / reject 授权批准或拒绝（仅 AUTHORIZATION）；
     * answer 提问答复（仅 QUESTION）；choose 裁决选项（仅 DECISION）。
     *
     */
    export enum decision {
        APPROVE = 'approve',
        REJECT = 'reject',
        ANSWER = 'answer',
        CHOOSE = 'choose',
    }
    /**
     * 临时授权范围（仅 decision=approve）；ONCE 仅本次（缺省）；TASK 本任务内允许多次使用
     */
    export enum scope {
        ONCE = 'ONCE',
        TASK = 'TASK',
    }
}

