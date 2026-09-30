/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ConnectorPreviousStep } from './ConnectorPreviousStep';
import type { ConnectorRoutingRecentMessage } from './ConnectorRoutingRecentMessage';
import type { TencentMeetingConnectorTool } from './TencentMeetingConnectorTool';
export type TencentMeetingConnectorPlanRequest = {
    query: string;
    tools: Array<TencentMeetingConnectorTool>;
    /**
     * 同一次用户请求内此前已执行的连接器步骤摘要（脱敏、不可信）；缺省或为空表示第一轮 规划。Desktop 只在第一轮返回 followUpMayBeNeeded 时进入第二轮。
     */
    previousSteps?: Array<ConnectorPreviousStep>;
    /**
     * 同一会话最近若干轮对话（脱敏、不可信），仅用于消解代词与省略式追问 （例如「那这个月的呢」「还有呢」）；缺省或为空表示没有可用的会话上下文。
     */
    recentMessages?: Array<ConnectorRoutingRecentMessage>;
};

