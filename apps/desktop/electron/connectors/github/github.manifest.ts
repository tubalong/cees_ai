import type { ConnectorManifest } from '../core/connector.types';

export const GITHUB_CONNECTOR_MANIFEST = {
    id: 'github',
    name: 'GitHub',
    description: '在 GitHub 上克隆、推送代码，查看和管理仓库与 Pull Request，用自然语言完成代码协作。',
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
