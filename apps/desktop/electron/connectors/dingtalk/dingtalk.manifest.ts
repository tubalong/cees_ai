import type { ConnectorManifest } from '../core/connector.types';

export const DINGTALK_CONNECTOR_MANIFEST = {
    id: 'dingtalk',
    name: '钉钉',
    description: '通过命令行管理钉钉全产品能力：AI 表格、考勤、日历、群聊与机器人、通讯录、开放平台文档、DING 消息、钉钉文档、钉钉云盘、AI 听记、邮箱、OA 审批、日志、待办。',
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
