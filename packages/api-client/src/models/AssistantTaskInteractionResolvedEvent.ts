/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssistantTaskInteractionType } from './AssistantTaskInteractionType';
export type AssistantTaskInteractionResolvedEvent = {
    type: 'interaction_resolved';
    seq: number;
    interactionId: string;
    interactionType: AssistantTaskInteractionType;
    stepId?: string | null;
    stepKey?: string | null;
    /**
     * 解决后状态：RESOLVED 已处理（批准/答复/选择）；REJECTED 已拒绝；EXPIRED 超时失效；CANCELLED 任务终态清理
     */
    status: AssistantTaskInteractionResolvedEvent.status;
    /**
     * 所选候选 id 或答复文本；拒绝与系统清理时为 null
     */
    value?: string | null;
    /**
     * 临时授权范围（仅授权批准）
     */
    scope?: AssistantTaskInteractionResolvedEvent.scope;
    resolvedAt: string;
};
export namespace AssistantTaskInteractionResolvedEvent {
    /**
     * 解决后状态：RESOLVED 已处理（批准/答复/选择）；REJECTED 已拒绝；EXPIRED 超时失效；CANCELLED 任务终态清理
     */
    export enum status {
        RESOLVED = 'RESOLVED',
        REJECTED = 'REJECTED',
        EXPIRED = 'EXPIRED',
        CANCELLED = 'CANCELLED',
    }
    /**
     * 临时授权范围（仅授权批准）
     */
    export enum scope {
        ONCE = 'ONCE',
        TASK = 'TASK',
    }
}

