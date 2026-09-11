/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Turn } from './Turn';
export type TurnResponseEnvelope = {
    success: boolean;
    data: Turn;
    /**
     * 公开 API 请求追踪 ID
     */
    requestId?: string | null;
};

