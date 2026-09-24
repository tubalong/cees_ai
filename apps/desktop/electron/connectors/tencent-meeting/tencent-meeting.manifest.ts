import type { ConnectorManifest } from '../core/connector.types';

export const TENCENT_MEETING_CONNECTOR_MANIFEST = {
    id: 'tencent-meeting',
    name: '腾讯会议',
    description: '通过命令行创建、查询和管理腾讯会议。支持快速发起会议、查看日程安排、管理参会人员。',
    icon: 'tencent-meeting',
    transportType: 'LOCAL_CLI',
    executionLocation: 'DESKTOP',
    authType: 'OAUTH',
    supportsInstall: true,
    supportsDisconnect: true,
    supportsProfiles: false,
    supportsDynamicTools: false,
    supportsVersionManagement: false,
} as const satisfies ConnectorManifest<'tencent-meeting'>;
