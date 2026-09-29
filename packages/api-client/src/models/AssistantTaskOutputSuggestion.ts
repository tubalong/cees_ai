/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AssistantTaskOutputSuggestion = {
    /**
     * 建议的归档目标知识库
     */
    knowledgeBaseId: string;
    /**
     * 推荐理由（规则路径=组织归属；LLM 路径=模型基于产出主题给出）
     */
    reason: string;
};

