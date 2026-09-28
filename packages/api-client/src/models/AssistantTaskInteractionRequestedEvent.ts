/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssistantTaskInteractionOption } from './AssistantTaskInteractionOption';
import type { AssistantTaskInteractionType } from './AssistantTaskInteractionType';
export type AssistantTaskInteractionRequestedEvent = {
    type: 'interaction_requested';
    seq: number;
    /**
     * 挂起事项 ID（解决时使用）
     */
    interactionId: string;
    interactionType: AssistantTaskInteractionType;
    stepId?: string | null;
    stepKey?: string | null;
    /**
     * 展示级摘要（授权动作 / 问题 / 分岔说明）
     */
    summary: string;
    reason?: string | null;
    options: Array<AssistantTaskInteractionOption>;
    expiresAt?: string | null;
};

