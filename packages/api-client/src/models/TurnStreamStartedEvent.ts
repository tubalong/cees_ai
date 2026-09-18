/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatContextUsage } from './ChatContextUsage';
import type { ChatMode } from './ChatMode';
import type { TurnCapabilities } from './TurnCapabilities';
export type TurnStreamStartedEvent = {
    type: 'started';
    /**
     * 轮次内递增的事件序号，用于断线重连时定位重放起点
     */
    seq: number;
    /**
     * 公开 API 请求追踪 ID
     */
    requestId: string;
    /**
     * 所属服务端会话 ID
     */
    conversationId: string;
    /**
     * 本轮轮次 ID
     */
    turnId: string;
    mode: ChatMode;
    contextUsage: ChatContextUsage;
    capabilities?: TurnCapabilities;
};

