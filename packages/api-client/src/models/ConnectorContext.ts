/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ConnectorContext = {
    provider: ConnectorContext.provider;
    /**
     * Stable local connector tool ID; DWS uses a derived ID while Tencent Meeting and WeCom use provider tool names
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
        TENCENT_MEETING = 'TENCENT_MEETING',
        WECOM = 'WECOM',
        GITHUB = 'GITHUB',
    }
}

