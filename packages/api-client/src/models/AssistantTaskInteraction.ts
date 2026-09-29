/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssistantTaskInteractionOption } from './AssistantTaskInteractionOption';
import type { AssistantTaskInteractionStatus } from './AssistantTaskInteractionStatus';
import type { AssistantTaskInteractionType } from './AssistantTaskInteractionType';
export type AssistantTaskInteraction = {
    id: string;
    taskId: string;
    /**
     * 触发的步骤；任务级事项为 null
     */
    stepId?: string | null;
    /**
     * 触发步骤的计划内稳定标识（展示用）；任务级事项为 null
     */
    stepKey?: string | null;
    type: AssistantTaskInteractionType;
    status: AssistantTaskInteractionStatus;
    /**
     * 展示级摘要：授权=要执行的动作与影响；提问=问题文本；裁决=待拍板的分岔说明
     */
    summary: string;
    /**
     * 需要用户介入的原因：授权理由 / 提问背景 / 裁决背景
     */
    reason?: string | null;
    /**
     * 提问与裁决的候选项（用户可从中选择或提交自定义答复）；授权为空数组
     */
    options: Array<AssistantTaskInteractionOption>;
    /**
     * 临时授权范围；批准后填充（仅 AUTHORIZATION）
     */
    scope?: AssistantTaskInteraction.scope;
    /**
     * 用户解决内容（所选候选 id 或答复文本）；未解决为 null
     */
    resolution?: string | null;
    resolvedAt?: string | null;
    /**
     * 超时失效时间；不限时为 null
     */
    expiresAt?: string | null;
    createdAt: string;
};
export namespace AssistantTaskInteraction {
    /**
     * 临时授权范围；批准后填充（仅 AUTHORIZATION）
     */
    export enum scope {
        ONCE = 'ONCE',
        TASK = 'TASK',
    }
}

