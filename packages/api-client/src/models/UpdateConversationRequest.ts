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
     * 历史兼容字段，不再参与校验；服务端忽略该字段（每次发起轮次都会递增会话版本，旧客户端持有的版本必然过期）
     */
    version?: number;
};

