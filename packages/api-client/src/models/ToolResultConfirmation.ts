/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ToolResultConfirmationField } from './ToolResultConfirmationField';
/**
 * 写操作的待确认预览；用户确认前不产生任何业务副作用
 */
export type ToolResultConfirmation = {
    /**
     * 待确认草稿 ID；确认与取消接口只接受该 ID，不接受重新提交参数
     */
    draftId: string;
    /**
     * 将要执行的受控工具名（面向开发者，不用于展示）
     */
    toolName: string;
    /**
     * 动作标题，例如「新建部门」
     */
    title: string;
    /**
     * 参数预览字段，供确认卡片展示
     */
    fields: Array<ToolResultConfirmationField>;
    /**
     * 草稿过期时间；过期后确认接口返回 409，需重新发起对话
     */
    expiresAt: string;
};

