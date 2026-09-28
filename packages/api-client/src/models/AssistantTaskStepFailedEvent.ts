/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AssistantTaskStepFailedEvent = {
    type: 'step_failed';
    seq: number;
    stepId: string;
    stepKey: string;
    /**
     * 失败原因摘要（展示级）
     */
    reason?: string | null;
};

