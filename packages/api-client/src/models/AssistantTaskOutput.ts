/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssistantTaskOutputArchive } from './AssistantTaskOutputArchive';
import type { AssistantTaskOutputSuggestion } from './AssistantTaskOutputSuggestion';
export type AssistantTaskOutput = {
    /**
     * 产出资产（AI 文档）；验收与归档的载体
     */
    documentId: string;
    /**
     * 产出标题（AI 生成文档标题）
     */
    title: string;
    /**
     * 产出步骤的计划内稳定标识
     */
    stepKey: string;
    /**
     * 产出步骤的简短名；计划未给出时为 null
     */
    stepTitle?: string | null;
    /**
     * 内容验收与归档确认是否已完成
     */
    confirmed: boolean;
    /**
     * 已确认时的归档结果；未确认为 null
     */
    archive?: (AssistantTaskOutputArchive | null);
    /**
     * 归档目标建议（未确认时给出：规则路径为组织归属默认，LLM 路径基于产出主题）；已确认时为空数组
     */
    suggestions: Array<AssistantTaskOutputSuggestion>;
};

