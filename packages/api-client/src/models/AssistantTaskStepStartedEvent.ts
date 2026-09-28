/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AssistantTaskStepStartedEvent = {
    type: 'step_started';
    seq: number;
    /**
     * 运行时步骤 ID
     */
    stepId: string;
    /**
     * 计划内稳定标识（如 s1）
     */
    stepKey: string;
    /**
     * 步骤序号（计划内递增）
     */
    stepNo: number;
    /**
     * 步骤简短名；计划未给出时为 null
     */
    title?: string | null;
    /**
     * 执行同事名称（实时解析）；档案缺失时为 null
     */
    assigneeName?: string | null;
};

