/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssistantTaskClarification } from './AssistantTaskClarification';
import type { AssistantTaskPlanStep } from './AssistantTaskPlanStep';
export type AssistantTaskPlan = {
    version: number;
    /**
     * 计划确认来源：用户确认 / 系统自动采纳
     */
    createdBy: AssistantTaskPlan.createdBy;
    confirmedAt?: string | null;
    createdAt: string;
    /**
     * 完整步骤清单（含执行同事与依赖，供确认卡片展示）
     */
    steps: Array<AssistantTaskPlanStep>;
    /**
     * 关键待定项（问题 + 选项）；确认答复随确认提交并并入生效版本
     */
    clarifications: Array<AssistantTaskClarification>;
};
export namespace AssistantTaskPlan {
    /**
     * 计划确认来源：用户确认 / 系统自动采纳
     */
    export enum createdBy {
        USER = 'USER',
        SYSTEM = 'SYSTEM',
    }
}

