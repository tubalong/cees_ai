/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ConnectorPreviousStep } from './ConnectorPreviousStep';
import type { WeComConnectorTool } from './WeComConnectorTool';
export type WeComConnectorPlanRequest = {
    query: string;
    tools: Array<WeComConnectorTool>;
    /**
     * 同一次用户请求内此前已执行的连接器步骤摘要（脱敏、不可信）；缺省或为空表示第一轮 规划。Desktop 只在第一轮返回 followUpMayBeNeeded 时进入第二轮。
     */
    previousSteps?: Array<ConnectorPreviousStep>;
};

