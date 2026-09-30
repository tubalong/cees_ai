/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ConnectorRoutingOption } from './ConnectorRoutingOption';
import type { ConnectorRoutingProvider } from './ConnectorRoutingProvider';
export type ConnectorRoutingResult = {
    /**
     * 本轮需要激活并进入二级规划的连接器；为空表示不需要任何连接器
     */
    providers: Array<ConnectorRoutingProvider>;
    /**
     * 目标不唯一时的反问提示；非空时 Desktop 不得规划或执行任何连接器调用
     */
    clarification: string | null;
    /**
     * clarification 非空时可供用户选择的候选连接器；Desktop 选择后才可重新发起本轮规划
     */
    clarificationOptions?: Array<ConnectorRoutingOption>;
    /**
     * 路由依据的简短说明，用于审计与排障，不展示为业务事实
     */
    reason: string;
};

