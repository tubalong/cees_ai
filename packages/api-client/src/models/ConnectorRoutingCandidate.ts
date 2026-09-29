/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ConnectorRoutingProvider } from './ConnectorRoutingProvider';
export type ConnectorRoutingCandidate = {
    provider: ConnectorRoutingProvider;
    /**
     * 连接器展示名，例如 钉钉
     */
    displayName: string;
    /**
     * 一级能力摘要，只描述能回答哪类问题，不包含工具名、参数或凭据
     */
    capabilitySummary: string;
    /**
     * 典型用户问法短句，用于语义匹配
     */
    routingExamples?: Array<string>;
    /**
     * 与 Desktop ConnectorState 一致；只有 READY 的连接器可以被路由命中
     */
    state: ConnectorRoutingCandidate.state;
    /**
     * 当前已发现工具数量，仅用于提示模型能力规模，不参与权限判断
     */
    toolCount?: number;
};
export namespace ConnectorRoutingCandidate {
    /**
     * 与 Desktop ConnectorState 一致；只有 READY 的连接器可以被路由命中
     */
    export enum state {
        NOT_INSTALLED = 'NOT_INSTALLED',
        AUTH_REQUIRED = 'AUTH_REQUIRED',
        PROFILE_REQUIRED = 'PROFILE_REQUIRED',
        READY = 'READY',
        ERROR = 'ERROR',
    }
}

