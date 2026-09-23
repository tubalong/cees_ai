import { HttpException, Injectable, OnModuleInit } from '@nestjs/common';
import {
    DEFAULT_TENANT_TIMEZONE,
    addLocalDays,
    localDateKey,
    shiftLocalDateKey,
    startOfLocalDate,
    startOfLocalDay,
} from '../../../common/tenant-time';
import { PrismaService } from '../../../database/prisma.service';
import { TenantContext } from '../../../tenant/tenant-context';
import { TencentMeetingGatewayService } from '../../../tencent-meeting/tencent-meeting-gateway.service';
import type { TencentMeetingToolId } from '../../../tencent-meeting/tencent-meeting.types';
import { ToolRegistryService } from '../tool-registry';
import {
    runAsTenant,
    ToolExecutionError,
    type ToolDefinition,
    type ToolExecutionContext,
    type ToolExecutionResult,
} from '../tool.types';

type MeetingRange = 'TODAY' | 'TOMORROW' | 'THIS_WEEK' | 'NEXT_7_DAYS';

const MEETING_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SAFE_ERROR_SUMMARIES: Readonly<Record<string, string>> = {
    AUTH_REQUIRED: '请先前往连接器页面连接或重新授权腾讯会议，然后再试',
    TOKEN_REFRESH_FAILED: '请先前往连接器页面连接或重新授权腾讯会议，然后再试',
    OAUTH_ACCESS_DENIED: '请先前往连接器页面连接或重新授权腾讯会议，然后再试',
    INSUFFICIENT_SCOPE: '当前腾讯会议授权范围不足，请前往连接器页面重新授权后再试',
    RESOURCE_FORBIDDEN: '当前腾讯会议账号无权查看该会议资源，请确认会议归属或访问权限',
    PROVIDER_RATE_LIMITED: '腾讯会议请求过于频繁，请稍后重试',
    CONNECTOR_NOT_CONFIGURED: '腾讯会议连接器尚未完成服务端配置，请联系管理员',
    PROVIDER_UNAVAILABLE: '腾讯会议服务暂时不可用，请稍后重试',
};

@Injectable()
export class TencentMeetingTools implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly gateway: TencentMeetingGatewayService,
        private readonly tenantContext: TenantContext,
        private readonly prisma: PrismaService,
    ) { }

    onModuleInit(): void {
        for (const definition of this.definitions) this.registry.register(definition);
    }

    private readonly definitions: ToolDefinition[] = [
        {
            name: 'tencent_meeting_get_profile',
            version: '1.0.0',
            displayName: '查看腾讯会议账号',
            description: '查询当前用户已授权的腾讯会议账号资料。用户询问当前连接的是哪个腾讯会议账号或所属组织时使用。',
            parameters: objectSchema({}),
            requiredPermissions: [],
            riskLevel: 'READ',
            validate: validateNoArguments,
            execute: (context, input) => this.execute(context, 'tencent_meeting.profile.get', input, profileSummary),
        },
        {
            name: 'tencent_meeting_list_meetings',
            version: '1.0.0',
            displayName: '查看腾讯会议列表',
            description: '查询当前腾讯会议账号可访问的会议列表。支持今天、明天、本周、未来七天或明确 ISO 8601 时间范围。'
                + '用户问“下一场会议”时优先查询未来七天，并根据查询时间和会议开始时间选择尚未结束且最近的一场。',
            parameters: objectSchema({
                range: {
                    type: 'string',
                    enum: ['TODAY', 'TOMORROW', 'THIS_WEEK', 'NEXT_7_DAYS'],
                    description: '相对租户时区的查询范围；不能与 start_time/end_time 同时使用',
                },
                start_time: { type: 'string', format: 'date-time', description: '明确开始时间，ISO 8601 格式' },
                end_time: { type: 'string', format: 'date-time', description: '明确结束时间，ISO 8601 格式' },
                page: { type: 'integer', minimum: 1, default: 1 },
                page_size: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            }),
            requiredPermissions: [],
            riskLevel: 'READ',
            validate: validateMeetingListArguments,
            execute: (context, input) => this.executeMeetingList(context, input),
        },
        {
            name: 'tencent_meeting_get_meeting',
            version: '1.0.0',
            displayName: '查看腾讯会议详情',
            description: '根据会议 ID 查询会议主题、状态和时间等详情。meeting_id 必须来自腾讯会议列表工具的结果。',
            parameters: objectSchema({
                meeting_id: { type: 'string', description: '取自 tencent_meeting_list_meetings 结果的会议 ID' },
            }, ['meeting_id']),
            requiredPermissions: [],
            riskLevel: 'READ',
            validate: validateMeetingIdArguments,
            execute: (context, input) => this.execute(context, 'tencent_meeting.meetings.get', {
                meetingId: input.meeting_id,
            }, meetingSummary),
        },
        {
            name: 'tencent_meeting_list_participants',
            version: '1.0.0',
            displayName: '查看腾讯会议参会人',
            description: '查询指定会议的参会成员及入会、离会时间。meeting_id 必须来自腾讯会议列表工具的结果。',
            parameters: objectSchema({
                meeting_id: { type: 'string', description: '取自 tencent_meeting_list_meetings 结果的会议 ID' },
                page: { type: 'integer', minimum: 1, default: 1 },
                page_size: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            }, ['meeting_id']),
            requiredPermissions: [],
            riskLevel: 'READ',
            validate: validateParticipantArguments,
            execute: (context, input) => this.execute(context, 'tencent_meeting.participants.list', {
                meetingId: input.meeting_id,
                page: input.page,
                pageSize: input.page_size,
            }, (data) => participantSummary(input.meeting_id as string, data)),
        },
        {
            name: 'tencent_meeting_list_recordings',
            version: '1.0.0',
            displayName: '查看腾讯会议录制',
            description: '查询指定会议是否存在录制或 AI 纪要元数据，不返回下载地址。meeting_id 必须来自腾讯会议列表工具的结果。',
            parameters: objectSchema({
                meeting_id: { type: 'string', description: '取自 tencent_meeting_list_meetings 结果的会议 ID' },
            }, ['meeting_id']),
            requiredPermissions: [],
            riskLevel: 'READ',
            validate: validateMeetingIdArguments,
            execute: (context, input) => this.execute(context, 'tencent_meeting.recordings.list', {
                meetingId: input.meeting_id,
            }, (data) => recordingSummary(input.meeting_id as string, data)),
        },
    ];

    private async executeMeetingList(
        context: ToolExecutionContext,
        input: Record<string, unknown>,
    ): Promise<ToolExecutionResult> {
        return runAsTenant(this.tenantContext, context, async () => {
            try {
                const tenant = await this.prisma.tenant.findFirst({
                    where: { id: context.tenantId, deletedAt: null },
                    select: { timezone: true },
                });
                const timeZone = tenant?.timezone || DEFAULT_TENANT_TIMEZONE;
                const queryTime = new Date();
                const range = resolveMeetingRange(input, timeZone, queryTime);
                const result = await this.gateway.execute({
                    calls: [{
                        toolId: 'tencent_meeting.meetings.list',
                        arguments: {
                            ...range,
                            page: input.page,
                            pageSize: input.page_size,
                        },
                    }],
                });
                return success(meetingListSummary(singleContextData(result), queryTime, timeZone));
            } catch (error) {
                throw safeTencentMeetingError(error);
            }
        });
    }

    private async execute(
        context: ToolExecutionContext,
        toolId: TencentMeetingToolId,
        input: Record<string, unknown>,
        summarize: (data: Record<string, unknown>) => string,
    ): Promise<ToolExecutionResult> {
        return runAsTenant(this.tenantContext, context, async () => {
            try {
                const result = await this.gateway.execute({ calls: [{ toolId, arguments: input }] });
                return success(summarize(singleContextData(result)));
            } catch (error) {
                throw safeTencentMeetingError(error);
            }
        });
    }
}

function validateNoArguments(input: unknown): Record<string, unknown> {
    const raw = requireObject(input);
    rejectExtra(raw, []);
    return {};
}

function validateMeetingListArguments(input: unknown): Record<string, unknown> {
    const raw = requireObject(input);
    rejectExtra(raw, ['range', 'start_time', 'end_time', 'page', 'page_size']);
    const parsed: Record<string, unknown> = {
        page: integerInRange(raw.page, 1, Number.MAX_SAFE_INTEGER, 1, 'page'),
        page_size: integerInRange(raw.page_size, 1, 100, 20, 'page_size'),
    };
    if (raw.range !== undefined) {
        const allowed: MeetingRange[] = ['TODAY', 'TOMORROW', 'THIS_WEEK', 'NEXT_7_DAYS'];
        if (typeof raw.range !== 'string' || !allowed.includes(raw.range as MeetingRange)) {
            throw new Error(`range 只能是 ${allowed.join(' / ')}`);
        }
        if (raw.start_time !== undefined || raw.end_time !== undefined) {
            throw new Error('range 不能与 start_time/end_time 同时使用');
        }
        parsed.range = raw.range;
    }
    const startTime = optionalIsoDate(raw.start_time, 'start_time');
    const endTime = optionalIsoDate(raw.end_time, 'end_time');
    if (startTime && endTime && startTime.getTime() > endTime.getTime()) {
        throw new Error('start_time 不能晚于 end_time');
    }
    if (startTime) parsed.start_time = startTime.toISOString();
    if (endTime) parsed.end_time = endTime.toISOString();
    return parsed;
}

function validateMeetingIdArguments(input: unknown): Record<string, unknown> {
    const raw = requireObject(input);
    rejectExtra(raw, ['meeting_id']);
    return { meeting_id: meetingId(raw.meeting_id) };
}

function validateParticipantArguments(input: unknown): Record<string, unknown> {
    const raw = requireObject(input);
    rejectExtra(raw, ['meeting_id', 'page', 'page_size']);
    return {
        meeting_id: meetingId(raw.meeting_id),
        page: integerInRange(raw.page, 1, Number.MAX_SAFE_INTEGER, 1, 'page'),
        page_size: integerInRange(raw.page_size, 1, 100, 20, 'page_size'),
    };
}

function resolveMeetingRange(
    input: Record<string, unknown>,
    timeZone: string,
    now: Date,
): { startTime?: string; endTime?: string } {
    if (typeof input.start_time === 'string' || typeof input.end_time === 'string') {
        return {
            ...(typeof input.start_time === 'string' ? { startTime: input.start_time } : {}),
            ...(typeof input.end_time === 'string' ? { endTime: input.end_time } : {}),
        };
    }
    const range = input.range as MeetingRange | undefined;
    if (!range) return {};
    if (range === 'TODAY') {
        return {
            startTime: startOfLocalDay(timeZone, now).toISOString(),
            endTime: addLocalDays(timeZone, now, 1).toISOString(),
        };
    }
    if (range === 'TOMORROW') {
        return {
            startTime: addLocalDays(timeZone, now, 1).toISOString(),
            endTime: addLocalDays(timeZone, now, 2).toISOString(),
        };
    }
    if (range === 'NEXT_7_DAYS') {
        return {
            startTime: startOfLocalDay(timeZone, now).toISOString(),
            endTime: addLocalDays(timeZone, now, 7).toISOString(),
        };
    }
    const dateKey = localDateKey(timeZone, now);
    const weekday = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
    const daysSinceMonday = (weekday + 6) % 7;
    const mondayKey = shiftLocalDateKey(timeZone, now, -daysSinceMonday);
    const nextMondayKey = shiftLocalDateKey(timeZone, now, 7 - daysSinceMonday);
    return {
        startTime: startOfLocalDate(timeZone, mondayKey).toISOString(),
        endTime: startOfLocalDate(timeZone, nextMondayKey).toISOString(),
    };
}

function profileSummary(data: Record<string, unknown>): string {
    return JSON.stringify({
        type: 'tencent_meeting_profile',
        account: {
            display_name: scalar(data.displayName),
            organization_name: scalar(data.organizationName),
        },
    });
}

function meetingListSummary(data: Record<string, unknown>, queryTime: Date, timeZone: string): string {
    return JSON.stringify({
        type: 'tencent_meeting_list',
        query_time: queryTime.toISOString(),
        tenant_timezone: timeZone,
        meetings: recordArray(data.items).map(meetingView),
        page: scalar(data.page),
        page_size: scalar(data.pageSize),
        total: scalar(data.total),
        has_more: scalar(data.hasMore),
        instruction: 'meeting_id 仅供后续详情、参会成员或录制工具使用；回答用户时不要主动展示内部 ID。'
            + '用户询问下一场会议时，以 query_time 为当前时刻，选择尚未结束且开始时间最近的会议。',
    });
}

function meetingSummary(data: Record<string, unknown>): string {
    return JSON.stringify({
        type: 'tencent_meeting_detail',
        meeting: meetingView(data),
        instruction: 'meeting_id 仅供后续参会成员或录制工具使用；回答用户时不要主动展示内部 ID。',
    });
}

function participantSummary(meetingIdValue: string, data: Record<string, unknown>): string {
    return JSON.stringify({
        type: 'tencent_meeting_participants',
        meeting_id: meetingIdValue,
        participants: recordArray(data.items).map((item) => ({
            display_name: scalar(item.displayName),
            role: scalar(item.role),
            join_time: scalar(item.joinTime),
            left_time: scalar(item.leftTime),
            state: scalar(item.state),
        })),
        page: scalar(data.page),
        page_size: scalar(data.pageSize),
        total: scalar(data.total),
        instruction: '回答用户时不要展示 meeting_id，也不要推断或补充未返回的手机号、邮箱等身份信息。',
    });
}

function recordingSummary(meetingIdValue: string, data: Record<string, unknown>): string {
    return JSON.stringify({
        type: 'tencent_meeting_recordings',
        meeting_id: meetingIdValue,
        recordings: recordArray(data.items).map((item) => ({
            start_time: scalar(item.startTime),
            end_time: scalar(item.endTime),
            duration_seconds: scalar(item.durationSeconds),
            file_type: scalar(item.fileType),
            file_size: scalar(item.fileSize),
            status: scalar(item.status),
            has_summary: scalar(item.hasSummary),
        })),
        total: scalar(data.total),
        instruction: '回答用户时不要展示 meeting_id；本工具不提供录制下载地址。',
    });
}

function meetingView(data: Record<string, unknown>): Record<string, unknown> {
    return {
        meeting_id: scalar(data.meetingId),
        meeting_code: scalar(data.meetingCode),
        subject: scalar(data.subject),
        meeting_type: scalar(data.meetingType),
        status: scalar(data.status),
        start_time: scalar(data.startTime),
        end_time: scalar(data.endTime),
    };
}

function safeTencentMeetingError(error: unknown): ToolExecutionError {
    if (error instanceof ToolExecutionError) return error;
    const status = error instanceof HttpException ? error.getStatus() : 502;
    const rawCode = error instanceof HttpException ? exceptionCode(error) : 'PROVIDER_UNAVAILABLE';
    const code = Object.prototype.hasOwnProperty.call(SAFE_ERROR_SUMMARIES, rawCode)
        ? rawCode
        : 'PROVIDER_UNAVAILABLE';
    const summary = SAFE_ERROR_SUMMARIES[code];
    return new ToolExecutionError(code, `腾讯会议工具执行失败（${code}, HTTP ${status}）`, summary);
}

function exceptionCode(error: HttpException): string {
    const response = error.getResponse();
    if (typeof response === 'object' && response !== null && typeof (response as { code?: unknown }).code === 'string') {
        return (response as { code: string }).code;
    }
    return 'PROVIDER_UNAVAILABLE';
}

function singleContextData(result: { contexts: Array<{ data: Record<string, unknown> }> }): Record<string, unknown> {
    return result.contexts[0]?.data ?? {};
}

function success(summary: string): ToolExecutionResult {
    return { resourceType: null, resourceId: null, summary };
}

function requireObject(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('工具参数必须为对象');
    return input as Record<string, unknown>;
}

function rejectExtra(input: Record<string, unknown>, allowed: string[]): void {
    const allowedSet = new Set(allowed);
    const extra = Object.keys(input).find((key) => !allowedSet.has(key));
    if (extra) throw new Error(`本工具不接受参数：${extra}`);
}

function optionalIsoDate(value: unknown, name: string): Date | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || value.length > 100) throw new Error(`${name} 必须是 ISO 8601 时间`);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new Error(`${name} 必须是 ISO 8601 时间`);
    return parsed;
}

function integerInRange(value: unknown, minimum: number, maximum: number, fallback: number, name: string): number {
    if (value === undefined || value === null) return fallback;
    if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
        throw new Error(`${name} 超出允许范围`);
    }
    return value as number;
}

function meetingId(value: unknown): string {
    if (typeof value !== 'string') throw new Error('meeting_id 必须是字符串');
    const normalized = value.trim();
    if (!normalized || normalized.length > 200 || !MEETING_ID_PATTERN.test(normalized)) {
        throw new Error('meeting_id 格式无效');
    }
    return normalized;
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
    return {
        type: 'object',
        additionalProperties: false,
        properties,
        ...(required.length > 0 ? { required } : {}),
    };
}

function recordArray(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scalar(value: unknown): string | number | boolean | null {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null;
}
