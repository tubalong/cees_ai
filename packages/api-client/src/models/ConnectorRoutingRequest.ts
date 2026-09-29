/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ConnectorRoutingCandidate } from './ConnectorRoutingCandidate';
import type { ConnectorRoutingProvider } from './ConnectorRoutingProvider';
import type { ConnectorRoutingRecentMessage } from './ConnectorRoutingRecentMessage';
export type ConnectorRoutingRequest = {
    query: string;
    connectors: Array<ConnectorRoutingCandidate>;
    /**
     * 上一轮已激活的连接器；仅用于消解「那……呢」这类省略追问。
     * 客户端自报字段：服务端必须只把它与就绪候选集求交后作为提示，绝不能当作授权。
     *
     */
    previousProviders?: Array<ConnectorRoutingProvider>;
    /**
     * 最近若干轮对话（不含本轮），仅用于理解代词与省略表达，不作为业务事实
     */
    recentMessages?: Array<ConnectorRoutingRecentMessage>;
};

