/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ToolResultResourceReference } from './ToolResultResourceReference';
export type AssistantTaskStepCompletedEvent = {
    type: 'step_completed';
    seq: number;
    stepId: string;
    stepKey: string;
    /**
     * 步骤结果摘要（回流总管与展示）
     */
    summary: string;
    /**
     * 步骤产出资产引用（不含签名 URL）；无产出时为空数组
     */
    outputRefs: Array<ToolResultResourceReference>;
};

