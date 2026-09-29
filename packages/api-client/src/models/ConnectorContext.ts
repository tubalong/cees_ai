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
    /**
     * 客户端依据同一次 plan 的工具目录自报的风险等级，只用于服务端分级审计， 不作为权限或业务写入依据。省略时按 DESTRUCTIVE 处理（与既有「未识别工具按 DESTRUCTIVE」一致），逐条审计而不并入轮次级聚合。
     */
    riskLevel?: ConnectorContext.riskLevel;
    /**
     * 客户端自报的「本轮执行前已获得用户确认」，只用于审计留痕，不代表服务端授权； 服务端不据此放行任何写入。
     */
    confirmed?: boolean;
};
export namespace ConnectorContext {
    export enum provider {
        DINGTALK = 'DINGTALK',
        TENCENT_MEETING = 'TENCENT_MEETING',
        WECOM = 'WECOM',
        GITHUB = 'GITHUB',
        LOCAL_SYSTEM = 'LOCAL_SYSTEM',
    }
    /**
     * 客户端依据同一次 plan 的工具目录自报的风险等级，只用于服务端分级审计， 不作为权限或业务写入依据。省略时按 DESTRUCTIVE 处理（与既有「未识别工具按 DESTRUCTIVE」一致），逐条审计而不并入轮次级聚合。
     */
    export enum riskLevel {
        READ = 'READ',
        WRITE = 'WRITE',
        DESTRUCTIVE = 'DESTRUCTIVE',
    }
}

