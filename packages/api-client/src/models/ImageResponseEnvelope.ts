/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ImageResult } from './ImageResult';
export type ImageResponseEnvelope = {
    success: boolean;
    data: ImageResult;
    /**
     * 公开 API 请求追踪 ID
     */
    requestId?: string | null;
};

