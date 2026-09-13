/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatMode } from './ChatMode';
import type { TurnStatus } from './TurnStatus';
export type Turn = {
    /**
     * 轮次 ID
     */
    id: string;
    /**
     * 所属会话 ID
     */
    conversationId: string;
    status: TurnStatus;
    mode: ChatMode;
    /**
     * 轮次失败时的错误信息；其他状态为 null
     */
    error?: any | null;
    /**
     * 轮次创建时间
     */
    createdAt: string;
    /**
     * 轮次到达终态的时间；未结束时为 null
     */
    completedAt?: string | null;
};

