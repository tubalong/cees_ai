/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatInvokeResult } from './ChatInvokeResult';
export type ChatInvokeResponseEnvelope = {
    success: boolean;
    data: ChatInvokeResult;
    /**
     * 公开 API 请求追踪 ID
     */
    requestId?: string | null;
};

