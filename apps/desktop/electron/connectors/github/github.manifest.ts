import type { ConnectorManifest } from '../core/connector.types';

export const GITHUB_CONNECTOR_MANIFEST = {
    id: 'github',
    name: 'GitHub',
    description: '通过 GitHub 官方远程 MCP 查询仓库、代码、提交、Issue、Pull Request 和 Actions，并在确认后执行写操作。',
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
