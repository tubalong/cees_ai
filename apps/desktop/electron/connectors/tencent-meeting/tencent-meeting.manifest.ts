import type { ConnectorManifest } from '../core/connector.types';

export const TENCENT_MEETING_CONNECTOR_MANIFEST = {
    id: 'tencent-meeting',
    name: '腾讯会议',
    description: '通过腾讯会议官方远程 MCP 管理会议、查询成员、录制、转写与智能纪要，能力范围以当前个人 Token 为准。',
    icon: 'tencent-meeting',
    transportType: 'REMOTE_MCP',
    executionLocation: 'DESKTOP',
    authType: 'LOCAL_CREDENTIAL',
    supportsInstall: false,
    supportsDisconnect: true,
    supportsProfiles: false,
    supportsDynamicTools: true,
    supportsVersionManagement: false,
} as const satisfies ConnectorManifest<'tencent-meeting'>;
