import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { TencentMeetingClient, TencentMeetingProviderError } from './tencent-meeting.client';
import { TencentMeetingConfig } from './tencent-meeting.config';
import { TencentMeetingService } from './tencent-meeting.service';
import {
    discoverTencentMeetingTools,
    requireTencentMeetingTool,
    validateTencentMeetingCalls,
} from './tencent-meeting-tools';
import {
    TencentMeetingAuthorizedCredential,
    TencentMeetingConnectorContext,
    TencentMeetingConnectorExecutionResult,
    TencentMeetingConnectorPlannedCall,
    TencentMeetingConnectorTool,
} from './tencent-meeting.types';

const RESOURCE_TYPE = 'TENCENT_MEETING_CONNECTION';
const PROVIDER_PARTICIPANT_PAGE_SIZE = 50;
const PROVIDER_MEETING_PAGE_LIMIT = 100;
const PROVIDER_RECORDING_PAGE_LIMIT = 100;
const RECORDING_WINDOW_SECONDS = 31 * 24 * 60 * 60;

@Injectable()
export class TencentMeetingGatewayService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
        private readonly config: TencentMeetingConfig,
        private readonly client: TencentMeetingClient,
        private readonly meetingService: TencentMeetingService,
    ) { }

    async listTools(): Promise<{ tools: TencentMeetingConnectorTool[] }> {
        const credential = await this.meetingService.requireAuthorizedCredential();
        return { tools: discoverTencentMeetingTools(credential.grantedScopes) };
    }

    async execute(input: unknown): Promise<TencentMeetingConnectorExecutionResult> {
        let connectionId: string | null = null;
        let calls: TencentMeetingConnectorPlannedCall[] = [];
        try {
            calls = validateTencentMeetingCalls(input);
            const credential = await this.meetingService.requireAuthorizedCredential();
            connectionId = credential.connectionId;
            const contexts: TencentMeetingConnectorContext[] = [];
            for (const call of calls) {
                const tool = requireTencentMeetingTool(call.toolId, credential.grantedScopes);
                contexts.push({
                    provider: 'TENCENT_MEETING',
                    toolId: call.toolId,
                    toolName: tool.name,
                    fetchedAt: new Date().toISOString(),
                    data: await this.executeCall(call, credential),
                });
            }
            const result = { contexts };
            const resultBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
            if (resultBytes > this.config.settings().executionResponseMaxBytes) {
                throw new HttpException({ code: 'PROVIDER_UNAVAILABLE', message: '腾讯会议执行结果超过安全限制' }, HttpStatus.BAD_GATEWAY);
            }
            await this.writeAudit('TENCENT_MEETING_READ_EXECUTED', AuditOutcome.SUCCESS, connectionId, {
                toolIds: calls.map((call) => call.toolId),
                callCount: calls.length,
                resultBytes,
            });
            return result;
        } catch (error) {
            const mapped = gatewayException(error);
            await this.writeAudit('TENCENT_MEETING_READ_FAILED', AuditOutcome.FAILURE, connectionId, {
                toolIds: calls.map((call) => call.toolId),
                callCount: calls.length,
                errorCode: exceptionCode(mapped),
            });
            throw mapped;
        }
    }

    private async executeCall(
        call: TencentMeetingConnectorPlannedCall,
        credential: TencentMeetingAuthorizedCredential,
    ): Promise<Record<string, unknown>> {
        switch (call.toolId) {
            case 'tencent_meeting.profile.get':
                return this.profile(credential);
            case 'tencent_meeting.meetings.list':
                return this.meetings(call.arguments, credential);
            case 'tencent_meeting.meetings.get':
                return this.meeting(call.arguments.meetingId as string, credential);
            case 'tencent_meeting.participants.list':
                return this.participants(call.arguments, credential);
            case 'tencent_meeting.recordings.list':
                return this.recordings(call.arguments.meetingId as string, credential);
        }
    }

    private async profile(credential: TencentMeetingAuthorizedCredential): Promise<Record<string, unknown>> {
        const profile = await this.client.getUserInfo(credential.accessToken, credential.openId, credential.openId);
        return {
            externalUserId: credential.openId,
            displayName: profile.displayName,
            organizationId: profile.organizationId,
            organizationName: profile.organizationName,
        };
    }

    private async meetings(
        argumentsValue: Record<string, unknown>,
        credential: TencentMeetingAuthorizedCredential,
    ): Promise<Record<string, unknown>> {
        const startTime = optionalTimestamp(argumentsValue.startTime);
        const endTime = optionalTimestamp(argumentsValue.endTime);
        const page = argumentsValue.page as number;
        const pageSize = argumentsValue.pageSize as number;
        const offset = (page - 1) * pageSize;
        const targetCount = offset + pageSize;
        const meetings: Record<string, unknown>[] = [];
        const seenMeetingIds = new Set<string>();
        let cursor = startTime === null ? undefined : { pos: Math.floor(startTime / 1000), cursory: 0 };
        let remaining = 0;

        for (let requestIndex = 0; requestIndex < PROVIDER_MEETING_PAGE_LIMIT; requestIndex += 1) {
            const payload = await this.client.listMeetings(credential.accessToken, credential.openId, cursor);
            const pageMeetings = findArray(payload, ['meeting_info_list', 'meeting_list', 'meetings'])
                .filter(isRecord)
                .map(safeMeeting)
                .filter((meeting) => overlaps(meeting.startTime, meeting.endTime, startTime, endTime));
            for (const meeting of pageMeetings) {
                const identity = typeof meeting.meetingId === 'string'
                    ? meeting.meetingId
                    : JSON.stringify(meeting);
                if (!seenMeetingIds.has(identity)) {
                    seenMeetingIds.add(identity);
                    meetings.push(meeting);
                }
            }
            remaining = firstNumber(payload, ['remaining']) ?? 0;
            const nextPos = firstNumber(payload, ['next_pos']);
            const nextCursory = firstNumber(payload, ['next_cursory']);
            if (meetings.length >= targetCount || remaining <= 0 || nextPos === null || nextCursory === null) break;
            cursor = { pos: nextPos, cursory: nextCursory };
        }
        if (meetings.length < targetCount && remaining > 0) {
            throw new HttpException({ code: 'PROVIDER_UNAVAILABLE', message: '腾讯会议查询范围过大，请缩小时间范围' }, HttpStatus.BAD_GATEWAY);
        }
        return {
            items: meetings.slice(offset, offset + pageSize),
            page,
            pageSize,
            total: remaining <= 0 ? meetings.length : null,
            hasMore: remaining > 0,
        };
    }

    private async meeting(meetingId: string, credential: TencentMeetingAuthorizedCredential): Promise<Record<string, unknown>> {
        const payload = await this.client.getMeeting(credential.accessToken, credential.openId, meetingId);
        return safeMeeting(meetingRecord(payload));
    }

    private async participants(
        argumentsValue: Record<string, unknown>,
        credential: TencentMeetingAuthorizedCredential,
    ): Promise<Record<string, unknown>> {
        const meetingId = argumentsValue.meetingId as string;
        const page = argumentsValue.page as number;
        const pageSize = argumentsValue.pageSize as number;
        const desiredOffset = (page - 1) * pageSize;
        let providerPage = Math.floor(desiredOffset / PROVIDER_PARTICIPANT_PAGE_SIZE) + 1;
        let skip = desiredOffset % PROVIDER_PARTICIPANT_PAGE_SIZE;
        let total: number | null = null;
        const items: Record<string, unknown>[] = [];

        while (items.length < pageSize) {
            const payload = await this.client.listParticipants(
                credential.accessToken,
                credential.openId,
                meetingId,
                providerPage,
                PROVIDER_PARTICIPANT_PAGE_SIZE,
            );
            total ??= firstNumber(payload, ['total_count', 'total']) ?? null;
            const pageItems = findArray(payload, ['participants', 'participant_list', 'user_list']).filter(isRecord);
            const available = pageItems.slice(skip);
            items.push(...available.slice(0, pageSize - items.length).map((item) => safeParticipant(item, meetingId)));
            if (pageItems.length < PROVIDER_PARTICIPANT_PAGE_SIZE || available.length === 0) break;
            providerPage += 1;
            skip = 0;
        }

        return { items, page, pageSize, total: total ?? desiredOffset + items.length };
    }

    private async recordings(meetingId: string, credential: TencentMeetingAuthorizedCredential): Promise<Record<string, unknown>> {
        const meetingPayload = await this.client.getMeeting(credential.accessToken, credential.openId, meetingId);
        const meeting = meetingRecord(meetingPayload);
        const meetingStart = unixSeconds(firstScalar(meeting, ['start_time', 'startTime']));
        const meetingEnd = unixSeconds(firstScalar(meeting, ['end_time', 'endTime'])) ?? meetingStart;
        if (meetingStart === null) {
            throw new HttpException({ code: 'PROVIDER_UNAVAILABLE', message: '腾讯会议未返回录制查询所需的会议时间' }, HttpStatus.BAD_GATEWAY);
        }
        const startTime = Math.max(0, meetingStart - 3600);
        const naturalEnd = Math.max(meetingEnd ?? meetingStart, meetingStart) + 3600;
        const endTime = Math.min(naturalEnd, startTime + RECORDING_WINDOW_SECONDS);
        const items: Record<string, unknown>[] = [];

        for (let page = 1; page <= PROVIDER_RECORDING_PAGE_LIMIT; page += 1) {
            const payload = await this.client.listRecordings(
                credential.accessToken,
                credential.openId,
                meetingId,
                startTime,
                endTime,
                page,
            );
            const groups = findArray(payload, ['record_meetings', 'recording_list', 'records']).filter(isRecord);
            items.push(...groups.flatMap((group) => {
                const files = findArray(group, ['record_files', 'files', 'recordings']).filter(isRecord);
                return files.length > 0
                    ? files.map((file) => safeRecording({ ...group, ...file }, meetingId))
                    : [safeRecording(group, meetingId)];
            }));
            const totalPages = firstNumber(payload, ['total_page']) ?? 1;
            if (page >= totalPages) break;
            if (page === PROVIDER_RECORDING_PAGE_LIMIT) {
                throw new HttpException({ code: 'PROVIDER_UNAVAILABLE', message: '腾讯会议录制结果超过安全分页限制' }, HttpStatus.BAD_GATEWAY);
            }
        }
        return { items, total: items.length };
    }

    private writeAudit(
        action: string,
        outcome: AuditOutcome,
        resourceId: string | null,
        metadata: Prisma.InputJsonValue,
    ) {
        const context = this.tenantContext.require();
        return this.prisma.auditLog.create({
            data: {
                tenantId: context.tenantId,
                actorUserId: context.userId,
                actorMembershipId: context.membershipId,
                action,
                outcome,
                resourceType: RESOURCE_TYPE,
                resourceId,
                requestId: context.requestId,
                metadata,
            },
        });
    }
}

function safeMeeting(value: Record<string, unknown>): Record<string, unknown> {
    return compact({
        meetingId: firstIdentifier(value, ['meeting_id', 'meetingId', 'id']),
        meetingCode: firstString(value, ['meeting_code', 'meetingCode']),
        subject: firstString(value, ['subject', 'meeting_subject', 'title']),
        meetingType: firstScalar(value, ['type', 'meeting_type', 'meetingType']),
        status: firstScalar(value, ['status', 'meeting_status']),
        startTime: normalizedTime(firstScalar(value, ['start_time', 'startTime'])) ?? null,
        endTime: normalizedTime(firstScalar(value, ['end_time', 'endTime'])) ?? null,
        currentSubMeetingId: firstString(value, ['current_sub_meeting_id', 'currentSubMeetingId']),
    });
}

function safeParticipant(value: Record<string, unknown>, meetingId: string): Record<string, unknown> {
    const externalId = firstIdentifier(value, ['ms_open_id', 'user_id', 'userid', 'open_id', 'participant_id'])
        ?? `${firstString(value, ['user_name', 'username', 'display_name']) ?? 'unknown'}:${String(firstScalar(value, ['join_time']) ?? '')}`;
    return compact({
        participantKey: createHash('sha256').update(`${meetingId}:${externalId}`, 'utf8').digest('hex'),
        displayName: firstString(value, ['user_name', 'username', 'display_name', 'name']),
        role: firstScalar(value, ['role', 'user_role']),
        joinTime: normalizedTime(firstScalar(value, ['join_time', 'joinTime'])) ?? null,
        leftTime: normalizedTime(firstScalar(value, ['left_time', 'leave_time', 'leftTime'])) ?? null,
        state: firstScalar(value, ['state', 'status']),
    });
}

function safeRecording(value: Record<string, unknown>, meetingId: string): Record<string, unknown> {
    return compact({
        recordingId: firstIdentifier(value, ['record_file_id', 'record_id', 'meeting_record_id', 'id']),
        meetingId,
        startTime: normalizedTime(firstScalar(value, ['start_time', 'record_start_time'])) ?? null,
        endTime: normalizedTime(firstScalar(value, ['end_time', 'record_end_time'])) ?? null,
        durationSeconds: recordingDuration(value),
        fileType: firstString(value, ['file_type', 'record_file_type', 'format']),
        fileSize: firstNumber(value, ['record_size', 'file_size', 'size']),
        status: firstScalar(value, ['state', 'status', 'record_status']),
        hasSummary: Boolean(value.has_summary ?? value.ai_minutes ?? value.summary),
    });
}

function overlaps(meetingStart: unknown, meetingEnd: unknown, requestedStart: number | null, requestedEnd: number | null): boolean {
    const start = optionalTimestamp(meetingStart);
    const end = optionalTimestamp(meetingEnd) ?? start;
    if (start === null && end === null) return true;
    if (requestedStart !== null && end !== null && end < requestedStart) return false;
    if (requestedEnd !== null && start !== null && start > requestedEnd) return false;
    return true;
}

function optionalTimestamp(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}

function normalizedTime(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return new Date(value >= 1_000_000_000_000 ? value : value * 1000).toISOString();
    }
    if (typeof value === 'string' && value.trim()) {
        if (/^\d+$/.test(value)) return normalizedTime(Number(value));
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return null;
}

function findArray(value: Record<string, unknown>, keys: string[]): unknown[] {
    for (const key of keys) if (Array.isArray(value[key])) return value[key];
    return isRecord(value.data) ? findArray(value.data, keys) : [];
}

function findRecord(value: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
    for (const key of keys) if (isRecord(value[key])) return value[key];
    return isRecord(value.data) ? findRecord(value.data, keys) : null;
}

function meetingRecord(payload: Record<string, unknown>): Record<string, unknown> {
    const direct = findRecord(payload, ['meeting_info', 'meeting']);
    if (direct) return direct;
    const listed = findArray(payload, ['meeting_info_list', 'meeting_list', 'meetings']).find(isRecord);
    return listed ?? payload;
}

function firstString(value: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
        const candidate = value[key];
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return null;
}

function firstIdentifier(value: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
        const candidate = value[key];
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
        if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate);
    }
    return null;
}

function firstScalar(value: Record<string, unknown>, keys: string[]): string | number | boolean | null {
    for (const key of keys) {
        const candidate = value[key];
        if (typeof candidate === 'string' || typeof candidate === 'number' || typeof candidate === 'boolean') return candidate;
    }
    return null;
}

function firstNumber(value: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
        const candidate = value[key];
        if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
        if (typeof candidate === 'string' && candidate.trim() && Number.isFinite(Number(candidate))) return Number(candidate);
    }
    return isRecord(value.data) ? firstNumber(value.data, keys) : null;
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function unixSeconds(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.floor(value >= 1_000_000_000_000 ? value / 1000 : value);
    }
    if (typeof value === 'string' && value.trim()) {
        if (/^\d+$/.test(value)) return unixSeconds(Number(value));
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
    }
    return null;
}

function recordingDuration(value: Record<string, unknown>): number | null {
    const direct = firstNumber(value, ['duration', 'duration_seconds', 'recording_duration']);
    if (direct !== null) return direct;
    const start = unixSeconds(firstScalar(value, ['record_start_time', 'start_time']));
    const end = unixSeconds(firstScalar(value, ['record_end_time', 'end_time']));
    return start !== null && end !== null && end >= start ? end - start : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function gatewayException(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    if (error instanceof TencentMeetingProviderError) {
        return new HttpException({ code: error.providerCode, message: error.message }, error.status);
    }
    return new HttpException({ code: 'PROVIDER_UNAVAILABLE', message: '腾讯会议服务暂时不可用' }, HttpStatus.BAD_GATEWAY);
}

function exceptionCode(error: HttpException): string {
    const response = error.getResponse();
    return typeof response === 'object' && response !== null && typeof (response as { code?: unknown }).code === 'string'
        ? (response as { code: string }).code
        : 'PROVIDER_UNAVAILABLE';
}
