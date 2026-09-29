import type { ConnectorManifest } from '../core/connector.types';

export const WECOM_CONNECTOR_MANIFEST = {
    id: 'wecom',
    name: '企业微信',
    description: '通过官方企业微信 CLI 使用消息、邮件、文档、待办、日程、会议、微盘与通讯录能力，实际范围以机器人授权为准。',
    capabilitySummary: '查询本人可见的企业微信数据：消息与群聊、邮件、文档、待办、日程与会议、微盘与通讯录；具体可用范围由智能机器人的实际授权决定。',
    routingExamples: ['我今天的日程', '帮我给项目群发条消息', '查一下某个同事的联系方式'],
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
