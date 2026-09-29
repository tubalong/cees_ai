/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AssistantTaskOutputsConfirmRequest = {
    /**
     * 逐产出的验收与归档提交；仅任务终态可提交
     */
    outputs: Array<{
        /**
         * 产出资产 ID（任务步骤的回流产出）
         */
        documentId: string;
        /**
         * 归档目标知识库；当前成员须具备编辑（EDITOR）及以上权限
         */
        knowledgeBaseId: string;
    }>;
};

