/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssistantTask } from './AssistantTask';
import type { AssistantTaskInteraction } from './AssistantTaskInteraction';
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
    /**
     * 挂起事项列表（含已解决历史，按创建时间升序；拍板视图按 status=PENDING 过滤）
     */
    interactions?: Array<AssistantTaskInteraction>;
};

