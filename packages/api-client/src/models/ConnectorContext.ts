/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ConnectorContext = {
    provider: ConnectorContext.provider;
    /**
     * Stable local tool ID derived from the DWS canonical_path
     */
    toolId: string;
    /**
     * DWS Schema canonical_path, retained for source display and audit context
     */
    toolName: string;
    fetchedAt: string;
    /**
     * 已脱敏的连接器结构化结果，不得包含 Token、Cookie、AppSecret 或授权凭据
     */
    data: Record<string, any>;
};
export namespace ConnectorContext {
    export enum provider {
        DINGTALK = 'DINGTALK',
    }
}

