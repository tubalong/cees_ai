/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssistantTask } from './AssistantTask';
import type { AssistantTaskPlan } from './AssistantTaskPlan';
import type { AssistantTaskStep } from './AssistantTaskStep';
export type AssistantTaskDetail = {
    task: AssistantTask;
    /**
     * 当前最新计划版本；PENDING_CONFIRM 阶段即待确认草案
     */
    currentPlan: (AssistantTaskPlan | null);
    /**
     * 当前生效计划的运行时步骤；计划确认前为空数组
     */
    steps: Array<AssistantTaskStep>;
};

