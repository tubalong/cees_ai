/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AssistantTaskPlanStep = {
    stepNo: number;
    /**
     * 计划内稳定标识（如 s1）
     */
    stepKey: string;
    /**
     * 步骤简短名（如“收集销售数据”）
     */
    title?: string;
    /**
     * 本步要求（做什么、完成标准、输出格式）
     */
    requirement: string;
    /**
     * 执行同事 ID；必取自已授权的在职同事
     */
    assigneeAgentId: string;
    /**
     * 执行同事名称（展示快照）
     */
    assigneeName?: string;
    /**
     * 预期产出描述
     */
    expectedOutput?: string | null;
    /**
     * 前置步骤的 stepKey；空数组表示可立即开始
     */
    dependsOnStepKeys?: Array<string>;
    /**
     * 重排沿用的历史步骤 stepKey（该步骤产出直接沿用、不再执行）；无则为 null
     */
    carriedFromStepKey?: string | null;
};

