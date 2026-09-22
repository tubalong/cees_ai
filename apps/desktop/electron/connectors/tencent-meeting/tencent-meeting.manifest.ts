import type { ConnectorManifest } from '../core/connector.types';

export const TENCENT_MEETING_CONNECTOR_MANIFEST = {
    id: 'tencent-meeting',
    name: '腾讯会议',
    description: '连接腾讯会议后查询当前用户、会议列表、会议详情、参会成员以及可访问的录制和纪要元数据。',
    icon: 'tencent-meeting',
    transportType: 'HTTP_API',
    executionLocation: 'API',
    authType: 'OAUTH',
    supportsInstall: false,
    supportsDisconnect: true,
    supportsProfiles: false,
    supportsDynamicTools: true,
    supportsVersionManagement: false,
} as const satisfies ConnectorManifest<'tencent-meeting'>;
