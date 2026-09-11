/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ConversationListResult } from './ConversationListResult';
export type ConversationListResponseEnvelope = {
    success: boolean;
    data: ConversationListResult;
    /**
     * 公开 API 请求追踪 ID
     */
    requestId?: string | null;
};

