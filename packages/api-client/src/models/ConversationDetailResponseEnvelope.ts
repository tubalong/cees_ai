/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ConversationDetail } from './ConversationDetail';
export type ConversationDetailResponseEnvelope = {
    success: boolean;
    data: ConversationDetail;
    /**
     * 公开 API 请求追踪 ID
     */
    requestId?: string | null;
};

