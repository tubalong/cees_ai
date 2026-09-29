import type { ConnectorManifest } from '../core/connector.types';

export const TENCENT_MEETING_CONNECTOR_MANIFEST = {
    id: 'tencent-meeting',
    name: '腾讯会议',
    description: '通过命令行创建、查询和管理腾讯会议。支持快速发起会议、查看日程安排、管理参会人员。',
    capabilitySummary: '查询与创建本人腾讯会议账号下的会议：即将开始的会议、历史会议记录、会议详情与参会人、录制与会议纪要。',
    routingExamples: ['我今天的会议', '上周开了哪些会', '帮我约一个明天上午的会议'],
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
