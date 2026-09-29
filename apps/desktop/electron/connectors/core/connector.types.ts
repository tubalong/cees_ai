export type ConnectorState = 'NOT_INSTALLED' | 'AUTH_REQUIRED' | 'PROFILE_REQUIRED' | 'READY' | 'ERROR';

export type ConnectorRecoveryAction =
    | 'INSTALL'
    | 'MANUAL_INSTALL'
    | 'AUTHORIZE'
    | 'SELECT_PROFILE'
    | 'RETRY'
    | 'NONE';

export type ConnectorTransportType =
    | 'LOCAL_CLI'
    | 'LOCAL_MCP'
    | 'REMOTE_MCP'
    | 'HTTP_API'
    | 'SDK'
    | 'WEBSOCKET';

export type ConnectorExecutionLocation = 'DESKTOP' | 'API' | 'HYBRID';

export type ConnectorAuthType = 'QR_CODE' | 'OAUTH' | 'API_KEY' | 'LOCAL_CREDENTIAL' | 'NONE';

export interface ConnectorManifest<ConnectorId extends string = string> {
    id: ConnectorId;
    name: string;
    description: string;
    /**
     * 一级能力摘要：供连接器语义路由判断「这条问题该不该试这个连接器」。
     * 只描述能回答哪类问题，不得包含工具名、参数 Schema、账号或凭据。
     */
    capabilitySummary: string;
    /** 典型用户问法，作为语义路由的匹配示例；最多 5 条短句。 */
    routingExamples: readonly string[];
    icon: string;
    transportType: ConnectorTransportType;
    executionLocation: ConnectorExecutionLocation;
    authType: ConnectorAuthType;
    supportsInstall: boolean;
    supportsDisconnect: boolean;
    supportsProfiles: boolean;
    supportsDynamicTools: boolean;
    supportsVersionManagement: boolean;
}

export interface ConnectorStatus {
    state: ConnectorState;
    installed: boolean;
    authenticated: boolean;
    version: string | null;
    checkedAt: string;
    issueCode: string | null;
    recoveryAction: ConnectorRecoveryAction;
    error: string | null;
}

export interface ConnectorTool {
    toolId: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    riskLevel?: 'READ' | 'WRITE' | 'DESTRUCTIVE';
    requiresConfirmation?: boolean;
}

export interface ConnectorPlannedCall {
    toolId: string;
    arguments: Record<string, unknown>;
    confirmed?: boolean;
}

export interface ConnectorContext<Provider extends string = string> {
    provider: Provider;
    toolId: string;
    toolName: string;
    fetchedAt: string;
    data: Record<string, unknown>;
}
