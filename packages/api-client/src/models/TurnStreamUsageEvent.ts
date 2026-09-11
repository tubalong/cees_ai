/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatTokenUsage } from './ChatTokenUsage';
export type TurnStreamUsageEvent = {
    type: 'usage';
    /**
     * 轮次内递增的事件序号
     */
    seq: number;
    tokenUsage: ChatTokenUsage;
};

