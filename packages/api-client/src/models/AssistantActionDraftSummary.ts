/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ToolResultConfirmationField } from './ToolResultConfirmationField';
/**
 * 待确认草稿的展示视图。只含用户核对所需的业务值，不含工具参数快照与内部 ID。
 */
export type AssistantActionDraftSummary = {
    draftId: string;
    /**
     * 产生草稿的工具名；客户端用于选择图标与文案
     */
    toolName: string;
    /**
     * 动作标题，例如「新建部门」
     */
    title: string;
    fields: Array<ToolResultConfirmationField>;
    expiresAt: string;
    conversationId: string;
    createdAt: string;
};

