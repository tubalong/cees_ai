/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type UpdateConversationRequest = {
    /**
     * 新的会话标题
     */
    title: string;
    /**
     * 当前会话版本，用于防止并发覆盖
     */
    version: number;
};

