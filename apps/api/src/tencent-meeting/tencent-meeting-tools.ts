import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
    TencentMeetingConnectorPlannedCall,
    TencentMeetingConnectorTool,
    TencentMeetingToolId,
} from './tencent-meeting.types';

interface ToolDefinition extends TencentMeetingConnectorTool {
    scopeAliases: readonly string[];
}

const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
    {
        toolId: 'tencent_meeting.profile.get',
        name: '查询腾讯会议当前用户',
        description: '查询当前已授权腾讯会议账号的基础资料。',
        parameters: objectSchema({}),
        scopeAliases: ['VIEW_USER_INFO'],
    },
    {
        toolId: 'tencent_meeting.meetings.list',
        name: '查询腾讯会议列表',
        description: '按时间范围查询当前账号可访问的会议列表。',
        parameters: objectSchema({
            startTime: { type: 'string', format: 'date-time', description: '开始时间，ISO 8601 格式' },
            endTime: { type: 'string', format: 'date-time', description: '结束时间，ISO 8601 格式' },
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        }),
        scopeAliases: ['VIEW_VIDEO', 'MANAGE_VIDEO'],
    },
    {
        toolId: 'tencent_meeting.meetings.get',
        name: '查询腾讯会议详情',
        description: '根据会议 ID 查询当前账号有权访问的会议详情。',
        parameters: objectSchema({ meetingId: { type: 'string', minLength: 1 } }, ['meetingId']),
        scopeAliases: ['VIEW_VIDEO', 'MANAGE_VIDEO'],
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
        scopeAliases: ['VIEW_VIDEO', 'MANAGE_VIDEO'],
    },
    {
        toolId: 'tencent_meeting.recordings.list',
        name: '查询腾讯会议录制与纪要',
        description: '根据会议 ID 查询当前账号有权访问的录制和纪要元数据，不下载媒体正文。',
        parameters: objectSchema({ meetingId: { type: 'string', minLength: 1 } }, ['meetingId']),
        scopeAliases: ['VIEW_VIDEO', 'MANAGE_VIDEO', 'VIEW_RECORD', 'VIEW_RECORDING'],
    },
];

const TOOL_MAP = new Map<TencentMeetingToolId, ToolDefinition>(TOOL_DEFINITIONS.map((tool) => [tool.toolId, tool]));

export function discoverTencentMeetingTools(grantedScopes: string[]): TencentMeetingConnectorTool[] {
    return TOOL_DEFINITIONS
        .filter((tool) => hasToolScope(tool, grantedScopes))
        .map(({ scopeAliases: _scopeAliases, ...tool }) => ({ ...tool, parameters: structuredClone(tool.parameters) }));
}

export function validateTencentMeetingCalls(value: unknown): TencentMeetingConnectorPlannedCall[] {
    if (!isRecord(value) || Object.keys(value).some((key) => key !== 'calls') || !Array.isArray(value.calls)) {
        invalid('请求体必须只包含 calls 数组');
    }
    if (value.calls.length < 1 || value.calls.length > 3) invalid('每次必须执行一至三条腾讯会议只读调用');
    return value.calls.map((call, index) => validateCall(call, index));
}

export function requireTencentMeetingTool(toolId: TencentMeetingToolId, grantedScopes: string[]): TencentMeetingConnectorTool {
    const definition = TOOL_MAP.get(toolId);
    if (!definition) invalid(`不支持的腾讯会议工具：${toolId}`);
    if (!hasToolScope(definition, grantedScopes)) {
        throw new ForbiddenException({ code: 'INSUFFICIENT_SCOPE', message: '腾讯会议授权范围不足，无法执行该工具' });
    }
    const { scopeAliases: _scopeAliases, ...tool } = definition;
    return tool;
}

function validateCall(value: unknown, index: number): TencentMeetingConnectorPlannedCall {
    if (!isRecord(value) || Object.keys(value).some((key) => key !== 'toolId' && key !== 'arguments')) {
        invalid(`第 ${index + 1} 条调用格式无效`);
    }
    if (typeof value.toolId !== 'string' || !TOOL_MAP.has(value.toolId as TencentMeetingToolId)) {
        invalid(`第 ${index + 1} 条调用的工具 ID 无效`);
    }
    if (!isRecord(value.arguments)) invalid(`第 ${index + 1} 条调用参数必须是对象`);
    const toolId = value.toolId as TencentMeetingToolId;
    const argumentsValue = validateArguments(toolId, value.arguments);
    return { toolId, arguments: argumentsValue };
}

function validateArguments(toolId: TencentMeetingToolId, value: Record<string, unknown>): Record<string, unknown> {
    switch (toolId) {
        case 'tencent_meeting.profile.get':
            rejectExtra(value, []);
            return {};
        case 'tencent_meeting.meetings.list': {
            rejectExtra(value, ['startTime', 'endTime', 'page', 'pageSize']);
            const startTime = optionalDate(value.startTime, 'startTime');
            const endTime = optionalDate(value.endTime, 'endTime');
            if (startTime && endTime && startTime.getTime() > endTime.getTime()) invalid('startTime 不能晚于 endTime');
            return compact({
                startTime: startTime?.toISOString(),
                endTime: endTime?.toISOString(),
                page: page(value.page),
                pageSize: pageSize(value.pageSize),
            });
        }
        case 'tencent_meeting.meetings.get':
        case 'tencent_meeting.recordings.list':
            rejectExtra(value, ['meetingId']);
            return { meetingId: meetingId(value.meetingId) };
        case 'tencent_meeting.participants.list':
            rejectExtra(value, ['meetingId', 'page', 'pageSize']);
            return { meetingId: meetingId(value.meetingId), page: page(value.page), pageSize: pageSize(value.pageSize) };
    }
}

function hasToolScope(tool: ToolDefinition, grantedScopes: string[]): boolean {
    if (grantedScopes.length === 0) return true;
    const normalized = new Set(grantedScopes.map((scope) => scope.trim().toUpperCase()));
    return tool.scopeAliases.some((scope) => normalized.has(scope));
}

function optionalDate(value: unknown, name: string): Date | null {
    if (value === undefined) return null;
    if (typeof value !== 'string' || value.length > 100) invalid(`${name} 必须是 ISO 8601 时间`);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) invalid(`${name} 必须是 ISO 8601 时间`);
    return parsed;
}

function page(value: unknown): number {
    return integerInRange(value, 1, Number.MAX_SAFE_INTEGER, 1, 'page');
}

function pageSize(value: unknown): number {
    return integerInRange(value, 1, 100, 20, 'pageSize');
}

function integerInRange(value: unknown, minimum: number, maximum: number, fallback: number, name: string): number {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
        invalid(`${name} 超出允许范围`);
    }
    return value as number;
}

function meetingId(value: unknown): string {
    if (typeof value !== 'string') invalid('meetingId 必须是字符串');
    const normalized = value.trim();
    if (!normalized || normalized.length > 200 || !/^[A-Za-z0-9_-]+$/.test(normalized)) invalid('meetingId 格式无效');
    return normalized;
}

function rejectExtra(value: Record<string, unknown>, allowed: string[]): void {
    const allowedSet = new Set(allowed);
    if (Object.keys(value).some((key) => !allowedSet.has(key))) invalid('调用参数包含未声明字段');
}

function invalid(message: string): never {
    throw new BadRequestException({ code: 'INVALID_ARGUMENTS', message });
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
    return {
        type: 'object',
        additionalProperties: false,
        properties,
        ...(required.length > 0 ? { required } : {}),
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
