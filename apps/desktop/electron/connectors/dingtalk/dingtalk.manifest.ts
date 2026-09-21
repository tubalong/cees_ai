import type { ConnectorManifest } from '../core/connector.types';

export const DINGTALK_CONNECTOR_MANIFEST = {
    id: 'dingtalk',
    name: '钉钉',
    description: '通过命令行管理钉钉全产品能力',
    icon: 'dingtalk',
    transportType: 'LOCAL_CLI',
    executionLocation: 'DESKTOP',
    authType: 'OAUTH',
    supportsInstall: true,
    supportsDisconnect: true,
    supportsProfiles: true,
    supportsDynamicTools: true,
    supportsVersionManagement: true,
} as const satisfies ConnectorManifest<'dingtalk'>;
