/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TurnPhase } from './TurnPhase';
export type TurnStreamStatusEvent = {
    type: 'status';
    /**
     * 轮次内递增的事件序号
     */
    seq: number;
    phase: TurnPhase;
};

