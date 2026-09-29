/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AssistantTaskPlanRevisionRequestedEvent = {
    type: 'plan_revision_requested';
    seq: number;
    /**
     * 请求调整时的当前计划版本（继续对话补充调整要求后将生成新版本草案）
     */
    version: number;
};

