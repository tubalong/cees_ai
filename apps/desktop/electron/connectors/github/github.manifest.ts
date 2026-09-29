import type { ConnectorManifest } from '../core/connector.types';

export const GITHUB_CONNECTOR_MANIFEST = {
    id: 'github',
    name: 'GitHub',
    description: '在 GitHub 上克隆、推送代码，查看和管理仓库与 Pull Request，用自然语言完成代码协作。',
    capabilitySummary: '查询本人在 GitHub 上的仓库与协作数据：私有仓库、代码与提交记录、Pull Request、Issue 与代码搜索，也可执行克隆、推送等代码协作操作。',
    routingExamples: ['查看我的私有仓库', '总结我今天的提交', '我有哪些待评审的 PR'],
    icon: 'github',
    transportType: 'REMOTE_MCP',
    executionLocation: 'DESKTOP',
    authType: 'OAUTH',
    supportsInstall: false,
    supportsDisconnect: true,
    supportsProfiles: false,
    supportsDynamicTools: true,
    supportsVersionManagement: false,
} as const satisfies ConnectorManifest<'github'>;
