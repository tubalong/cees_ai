/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ToolResultResourceReference } from './ToolResultResourceReference';
export type AssistantTaskStep = {
    id: string;
    stepNo: number;
    stepKey: string;
    planVersion: number;
    status: AssistantTaskStep.status;
    assigneeAgentId?: string | null;
    /**
     * 执行同事名称（实时解析）
     */
    assigneeName?: string | null;
    /**
     * 结果摘要（回流只存摘要与引用）
     */
    summary?: string | null;
    /**
     * 产出资产引用列表（不含签名 URL）；尚未回流时为空数组
     */
    outputRefs?: Array<ToolResultResourceReference>;
    attemptNo: number;
    startedAt?: string | null;
    completedAt?: string | null;
};
export namespace AssistantTaskStep {
    export enum status {
        PENDING = 'PENDING',
        READY = 'READY',
        RUNNING = 'RUNNING',
        WAITING_USER = 'WAITING_USER',
        SUCCEEDED = 'SUCCEEDED',
        FAILED = 'FAILED',
        SKIPPED = 'SKIPPED',
    }
}

