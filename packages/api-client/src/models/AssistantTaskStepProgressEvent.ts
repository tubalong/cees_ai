/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AssistantTaskStepProgressEvent = {
    type: 'step_progress';
    seq: number;
    stepId: string;
    stepKey: string;
    /**
     * 进度说明（展示级），例如正在执行的动作
     */
    note: string;
};

