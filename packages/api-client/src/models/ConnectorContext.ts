/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ConnectorContext = {
    provider: ConnectorContext.provider;
    /**
     * Stable local connector tool ID。DWS 使用派生 ID，腾讯会议与企业微信使用 provider 工具名； `LOCAL_SYSTEM` 上下文只使用固定白名单（`disk_scan_volumes` / `disk_scan_directory` / `local_quarantine` / `local_restore` / `local_cleanup` / `local_capabilities`）， 其中 `local_capabilities` 仅声明客户端本机能力（如可将生成产物另存到用户选择的位置）， 不构成任何执行授权。
     */
    toolId: string;
    /**
     * Read-only tool display name retained for source display and audit context
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
        LOCAL_SYSTEM = 'LOCAL_SYSTEM',
    }
}

