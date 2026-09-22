import type {
    ConnectorContext,
    ConnectorPlannedCall,
    ConnectorStatus,
    ConnectorTool,
} from '../core/connector.types';

export type TencentMeetingConnectorContext = ConnectorContext<'TENCENT_MEETING'>;
export type TencentMeetingConnectorPlannedCall = ConnectorPlannedCall;
export type TencentMeetingConnectorTool = ConnectorTool;

const SERVER_OAUTH_REQUIRED = '腾讯会议 OAuth 必须由 CEES API 服务端完成；当前尚未接入服务端授权与 Token 托管。';

const READ_TOOLS: readonly TencentMeetingConnectorTool[] = [
    {
        toolId: 'tencent_meeting.profile.get',
        name: '查询腾讯会议当前用户',
        description: '查询当前已授权腾讯会议账号的基础资料。',
        parameters: objectSchema({}),
    },
    {
        toolId: 'tencent_meeting.meetings.list',
        name: '查询腾讯会议列表',
        description: '按时间范围查询当前账号可访问的会议列表。',
        parameters: objectSchema({
            startTime: { type: 'string', description: '开始时间，ISO 8601 格式' },
            endTime: { type: 'string', description: '结束时间，ISO 8601 格式' },
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        }),
    },
    {
        toolId: 'tencent_meeting.meetings.get',
        name: '查询腾讯会议详情',
        description: '根据会议 ID 查询当前账号有权访问的会议详情。',
        parameters: objectSchema({
            meetingId: { type: 'string', minLength: 1 },
        }, ['meetingId']),
    },
    {
        toolId: 'tencent_meeting.participants.list',
        name: '查询腾讯会议参会成员',
        description: '根据会议 ID 查询当前账号有权访问的参会成员。',
        parameters: objectSchema({
            meetingId: { type: 'string', minLength: 1 },
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        }, ['meetingId']),
    },
    {
        toolId: 'tencent_meeting.recordings.list',
        name: '查询腾讯会议录制与纪要',
        description: '根据会议 ID 查询当前账号有权访问的录制和纪要元数据，不下载媒体正文。',
        parameters: objectSchema({
            meetingId: { type: 'string', minLength: 1 },
        }, ['meetingId']),
    },
];

export function getTencentMeetingConnectorStatus(): Promise<ConnectorStatus> {
    return Promise.resolve(createServerOAuthRequiredStatus());
}

export function connectTencentMeetingConnector(): Promise<ConnectorStatus> {
    return Promise.resolve(createServerOAuthRequiredStatus());
}

export function disconnectTencentMeetingConnector(): Promise<ConnectorStatus> {
    return Promise.resolve(createServerOAuthRequiredStatus());
}

export function resetTencentMeetingConnectorTools(): void {
}

export function discoverTencentMeetingReadTools(): Promise<TencentMeetingConnectorTool[]> {
    return Promise.resolve(READ_TOOLS.map(cloneTool));
}

export async function executeTencentMeetingReadCalls(
    calls: TencentMeetingConnectorPlannedCall[],
): Promise<TencentMeetingConnectorContext[]> {
    validatePlannedCalls(calls);
    throw new Error(SERVER_OAUTH_REQUIRED);
}

function createServerOAuthRequiredStatus(): ConnectorStatus {
    return {
        state: 'AUTH_REQUIRED',
        installed: true,
        authenticated: false,
        version: null,
        checkedAt: new Date().toISOString(),
        issueCode: 'SERVER_OAUTH_REQUIRED',
        recoveryAction: 'AUTHORIZE',
        error: SERVER_OAUTH_REQUIRED,
    };
}

function validatePlannedCalls(calls: TencentMeetingConnectorPlannedCall[]): void {
    const toolIds = new Set(READ_TOOLS.map((tool) => tool.toolId));
    for (const call of calls) {
        if (!toolIds.has(call.toolId)) throw new Error(`腾讯会议只读工具不存在：${call.toolId}`);
    }
}

function cloneTool(tool: TencentMeetingConnectorTool): TencentMeetingConnectorTool {
    return {
        ...tool,
        parameters: structuredClone(tool.parameters),
    };
}

function objectSchema(
    properties: Record<string, unknown>,
    required: string[] = [],
): Record<string, unknown> {
    return {
        type: 'object',
        additionalProperties: false,
        properties,
        ...(required.length > 0 ? { required } : {}),
    };
}
