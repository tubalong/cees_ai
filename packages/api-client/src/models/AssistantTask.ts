/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssistantTaskOriginType } from './AssistantTaskOriginType';
import type { AssistantTaskStatus } from './AssistantTaskStatus';
export type AssistantTask = {
    /**
     * 任务 ID
     */
    id: string;
    /**
     * 任务简短标题
     */
    title: string;
    /**
     * 任务目标（总管理解后的完整表述）
     */
    goal: string;
    status: AssistantTaskStatus;
    originType: AssistantTaskOriginType;
    /**
     * 发起会话；AUTO 来源（主动建议转任务）可为 null
     */
    conversationId: string | null;
    /**
     * 当前生效计划版本；计划确认前为 0
     */
    planVersion: number;
    createdAt: string;
    updatedAt: string;
    /**
     * 进入终态的时间；未终态为 null
     */
    completedAt?: string | null;
    /**
     * 失败原因摘要；非失败终态为 null
     */
    failedReason?: string | null;
};

