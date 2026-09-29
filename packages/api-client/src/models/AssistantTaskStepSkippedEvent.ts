/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AssistantTaskStepSkippedEvent = {
    type: 'step_skipped';
    seq: number;
    stepId: string;
    stepKey: string;
    /**
     * 跳过原因摘要（展示级）
     */
    reason?: string | null;
};

