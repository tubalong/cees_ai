import type { ConnectorManifest } from '../core/connector.types';

export const DINGTALK_CONNECTOR_MANIFEST = {
    id: 'dingtalk',
    name: '钉钉',
    description: '通过命令行管理钉钉全产品能力：AI 表格、考勤、日历、群聊与机器人、通讯录、开放平台文档、DING 消息、钉钉文档、钉钉云盘、AI 听记、邮箱、OA 审批、日志、待办。',
    capabilitySummary: '查询本人账号可见的钉钉数据：考勤打卡、OA 审批与待办、日历日程与会议室、AI 听记与纪要、群聊消息、文档与钉盘、日志与邮件。',
    routingExamples: ['我这个月打了几天卡', '我有哪些待审批的申请', '帮我看看项目群里说了什么', '我今天的日程安排'],
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
