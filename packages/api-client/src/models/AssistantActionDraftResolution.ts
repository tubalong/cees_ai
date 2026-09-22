/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ToolResultResourceReference } from './ToolResultResourceReference';
export type AssistantActionDraftResolution = {
    draftId: string;
    /**
     * 草稿处理结果状态
     */
    status: AssistantActionDraftResolution.status;
    /**
     * 面向用户的结果说明；失败时为可安全展示的原因
     */
    summary: string;
    /**
     * 执行产生的正式资源；多数业务写操作无资源产出
     */
    resource?: (ToolResultResourceReference | null);
};
export namespace AssistantActionDraftResolution {
    /**
     * 草稿处理结果状态
     */
    export enum status {
        PENDING_CONFIRMATION = 'PENDING_CONFIRMATION',
        EXECUTED = 'EXECUTED',
        FAILED = 'FAILED',
        REJECTED = 'REJECTED',
        EXPIRED = 'EXPIRED',
    }
}

