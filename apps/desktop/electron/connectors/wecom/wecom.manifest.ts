import type { ConnectorManifest } from '../core/connector.types';

export const WECOM_CONNECTOR_MANIFEST = {
    id: 'wecom',
    name: '企业微信',
    description: '通过官方企业微信 CLI 使用消息、邮件、文档、待办、日程、会议、微盘与通讯录能力，实际范围以机器人授权为准。',
    icon: 'wecom',
    transportType: 'LOCAL_CLI',
    executionLocation: 'DESKTOP',
    authType: 'QR_CODE',
    supportsInstall: true,
    supportsDisconnect: true,
    supportsProfiles: false,
    supportsDynamicTools: true,
    supportsVersionManagement: false,
} as const satisfies ConnectorManifest<'wecom'>;
