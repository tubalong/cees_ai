/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatCompactResult } from './ChatCompactResult';
export type ChatCompactResponseEnvelope = {
    success: boolean;
    data: ChatCompactResult;
    /**
     * 公开 API 请求追踪 ID
     */
    requestId?: string | null;
};

