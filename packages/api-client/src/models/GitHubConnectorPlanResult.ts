/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { GitHubConnectorPlannedCall } from './GitHubConnectorPlannedCall';
export type GitHubConnectorPlanResult = {
    calls: Array<GitHubConnectorPlannedCall>;
    /**
     * 模型提示「本次用户请求可能还需要第二轮连接器调用才能完成」；缺省或 false 时 Desktop 不得进入第二轮，以避免为不确定的情况多付一次规划成本。
     */
    followUpMayBeNeeded?: boolean;
};

