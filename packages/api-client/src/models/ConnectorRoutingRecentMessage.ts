/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 最近一轮对话摘要。路由与四个连接器 plan 请求共用；只用于消解代词与省略表达，不作为业务事实或授权。
 */
export type ConnectorRoutingRecentMessage = {
    role: ConnectorRoutingRecentMessage.role;
    content: string;
};
export namespace ConnectorRoutingRecentMessage {
    export enum role {
        USER = 'user',
        ASSISTANT = 'assistant',
    }
}

