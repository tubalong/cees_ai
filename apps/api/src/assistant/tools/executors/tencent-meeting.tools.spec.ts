import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { TenantContext } from '../../../tenant/tenant-context';
import { TencentMeetingGatewayService } from '../../../tencent-meeting/tencent-meeting-gateway.service';
import { ToolRegistryService } from '../tool-registry';
import { ToolExecutionError, type ToolExecutionContext } from '../tool.types';
import { TencentMeetingTools } from './tencent-meeting.tools';

const TENANT_ID = '1e1c1f0e-0000-4000-8000-000000000001';
const context: ToolExecutionContext = {
    tenantId: TENANT_ID,
    userId: 'user-1',
    membershipId: 'membership-1',
    requestId: 'request-1',
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    toolCallId: 'tool-call-1',
    executionOwner: 'api-1',
    executionToken: 'token-1',
    permissions: [],
    roles: ['member'],
    knowledgeBaseEnabled: false,
    webSearchEnabled: false,
};

describe('TencentMeetingTools', () => {
    let registry: ToolRegistryService;
    let gateway: { execute: jest.Mock };
    let tenantContext: TenantContext;
    let prisma: { tenant: { findFirst: jest.Mock } };

    beforeEach(() => {
        registry = new ToolRegistryService();
        gateway = { execute: jest.fn() };
        tenantContext = new TenantContext();
        prisma = { tenant: { findFirst: jest.fn().mockResolvedValue({ timezone: 'Asia/Shanghai' }) } };
        new TencentMeetingTools(
            registry,
            gateway as unknown as TencentMeetingGatewayService,
            tenantContext,
            prisma as unknown as PrismaService,
        ).onModuleInit();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('registers five member-level read-only tools', () => {
        const names = [
            'tencent_meeting_get_profile',
            'tencent_meeting_list_meetings',
            'tencent_meeting_get_meeting',
            'tencent_meeting_list_participants',
            'tencent_meeting_list_recordings',
        ];
        expect(names.map((name) => registry.get(name)?.name)).toEqual(names);
        for (const name of names) {
            expect(registry.get(name)).toMatchObject({ riskLevel: 'READ', requiredPermissions: [] });
        }
        expect(registry.get('tencent_meeting_list_meetings')?.description).toContain('CEES 内部会议');
        expect(registry.get('tencent_meeting_list_meetings')?.description).toContain('前文已明确');
        expect(registry.get('tencent_meeting_list_meetings')?.description).toContain('同名会议');
    });

    it('executes profile lookup inside the current tenant context', async () => {
        gateway.execute.mockImplementation(async () => {
            expect(tenantContext.require()).toEqual(expect.objectContaining({
                tenantId: TENANT_ID,
                membershipId: 'membership-1',
                roles: ['member'],
            }));
            return result({ displayName: '张三', organizationName: '示例公司', externalUserId: 'must-not-leak' });
        });

        const response = await registry.get('tencent_meeting_get_profile')!.execute(context, {});

        expect(gateway.execute).toHaveBeenCalledWith({
            calls: [{ toolId: 'tencent_meeting.profile.get', arguments: {} }],
        });
        expect(JSON.parse(response.summary)).toEqual({
            type: 'tencent_meeting_profile',
            account: { display_name: '张三', organization_name: '示例公司' },
        });
        expect(response.summary).not.toContain('must-not-leak');
    });

    it('converts TODAY to tenant-local day boundaries and preserves meeting ids for follow-up', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-09-23T04:30:00.000Z'));
        gateway.execute.mockResolvedValue(result({
            items: [{
                meetingId: 'meeting-1',
                meetingCode: '123456',
                subject: '项目周会',
                status: 'MEETING_STATE_STARTED',
                startTime: '2026-09-23T01:00:00.000Z',
                endTime: '2026-09-23T02:00:00.000Z',
            }],
            page: 1,
            pageSize: 20,
            total: 1,
            hasMore: false,
        }));

        const definition = registry.get('tencent_meeting_list_meetings')!;
        const parsed = definition.validate({ range: 'TODAY' });
        const response = await definition.execute(context, parsed);

        expect(gateway.execute).toHaveBeenCalledWith({
            calls: [{
                toolId: 'tencent_meeting.meetings.list',
                arguments: {
                    startTime: '2026-09-22T16:00:00.000Z',
                    endTime: '2026-09-23T16:00:00.000Z',
                    page: 1,
                    pageSize: 20,
                },
            }],
        });
        const summary = JSON.parse(response.summary) as {
            meetings: Array<{ meeting_id: string }>;
            query_time: string;
            tenant_timezone: string;
            instruction: string;
        };
        expect(summary.meetings[0].meeting_id).toBe('meeting-1');
        expect(summary.query_time).toBe('2026-09-23T04:30:00.000Z');
        expect(summary.tenant_timezone).toBe('Asia/Shanghai');
        expect(summary.instruction).toContain('不要主动展示内部 ID');
    });

    it('validates relative and explicit meeting ranges', () => {
        const validate = registry.get('tencent_meeting_list_meetings')!.validate;
        expect(() => validate({ range: 'TODAY', start_time: '2026-09-23T00:00:00Z' }))
            .toThrow('range 不能与 start_time/end_time 同时使用');
        expect(() => validate({ start_time: 'invalid' })).toThrow('start_time 必须是 ISO 8601 时间');
        expect(() => validate({
            start_time: '2026-09-24T00:00:00Z',
            end_time: '2026-09-23T00:00:00Z',
        })).toThrow('start_time 不能晚于 end_time');
        expect(validate({
            start_time: '2026-09-23T00:00:00+08:00',
            end_time: '2026-09-24T00:00:00+08:00',
            page_size: 50,
        })).toEqual({
            start_time: '2026-09-22T16:00:00.000Z',
            end_time: '2026-09-23T16:00:00.000Z',
            page: 1,
            page_size: 50,
        });
    });

    it('uses an exact current-time boundary and identifies the next meeting', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-09-23T04:30:00.000Z'));
        gateway.execute.mockResolvedValue(result({
            items: [
                {
                    meetingId: 'meeting-later',
                    subject: '项目周会',
                    startTime: '2026-09-23T07:00:00.000Z',
                    endTime: '2026-09-23T08:00:00.000Z',
                },
                {
                    meetingId: 'meeting-next',
                    subject: '项目周会',
                    startTime: '2026-09-23T05:00:00.000Z',
                    endTime: '2026-09-23T06:00:00.000Z',
                },
            ],
            page: 1,
            pageSize: 20,
            total: 2,
            hasMore: false,
        }));

        const definition = registry.get('tencent_meeting_list_meetings')!;
        const response = await definition.execute(context, definition.validate({ range: 'UPCOMING_7_DAYS' }));

        expect(gateway.execute).toHaveBeenCalledWith({
            calls: [{
                toolId: 'tencent_meeting.meetings.list',
                arguments: {
                    startTime: '2026-09-23T04:30:00.000Z',
                    endTime: '2026-09-30T04:30:00.000Z',
                    page: 1,
                    pageSize: 20,
                },
            }],
        });
        const summary = JSON.parse(response.summary) as {
            meetings: Array<{ meeting_id: string }>;
            next_meeting_id: string;
            instruction: string;
        };
        expect(summary.meetings.map((meeting) => meeting.meeting_id)).toEqual(['meeting-next', 'meeting-later']);
        expect(summary.next_meeting_id).toBe('meeting-next');
        expect(summary.instruction).toContain('主题和开始时间让用户选择');
    });

    it('maps detail, participant and recording calls to provider tool ids', async () => {
        gateway.execute
            .mockResolvedValueOnce(result({ meetingId: 'meeting-1', subject: '项目周会' }))
            .mockResolvedValueOnce(result({
                items: [{ displayName: '李四', role: 'MEMBER', participantKey: 'must-not-leak' }],
                page: 2,
                pageSize: 10,
                total: 11,
            }))
            .mockResolvedValueOnce(result({
                items: [{ recordingId: 'recording-1', meetingId: 'meeting-1', fileType: 'MP4', hasSummary: true }],
                total: 1,
            }));

        const detail = registry.get('tencent_meeting_get_meeting')!;
        const participants = registry.get('tencent_meeting_list_participants')!;
        const recordings = registry.get('tencent_meeting_list_recordings')!;
        const detailResult = await detail.execute(context, detail.validate({ meeting_id: 'meeting-1' }));
        const participantResult = await participants.execute(context, participants.validate({
            meeting_id: 'meeting-1',
            page: 2,
            page_size: 10,
        }));
        const recordingResult = await recordings.execute(context, recordings.validate({ meeting_id: 'meeting-1' }));

        expect(gateway.execute).toHaveBeenNthCalledWith(1, {
            calls: [{ toolId: 'tencent_meeting.meetings.get', arguments: { meetingId: 'meeting-1' } }],
        });
        expect(gateway.execute).toHaveBeenNthCalledWith(2, {
            calls: [{
                toolId: 'tencent_meeting.participants.list',
                arguments: { meetingId: 'meeting-1', page: 2, pageSize: 10 },
            }],
        });
        expect(gateway.execute).toHaveBeenNthCalledWith(3, {
            calls: [{ toolId: 'tencent_meeting.recordings.list', arguments: { meetingId: 'meeting-1' } }],
        });
        expect(JSON.parse(detailResult.summary).meeting.meeting_id).toBe('meeting-1');
        expect(participantResult.summary).not.toContain('participantKey');
        expect(participantResult.summary).not.toContain('must-not-leak');
        expect(recordingResult.summary).not.toContain('recording-1');
        expect(JSON.parse(recordingResult.summary).meeting_id).toBe('meeting-1');
    });

    it('validates meeting ids and participant pagination', () => {
        expect(() => registry.get('tencent_meeting_get_meeting')!.validate({ meeting_id: '../secret' }))
            .toThrow('meeting_id 格式无效');
        expect(() => registry.get('tencent_meeting_list_participants')!.validate({
            meeting_id: 'meeting-1',
            page_size: 101,
        })).toThrow('page_size 超出允许范围');
    });

    it.each([
        [new ConflictException({ code: 'AUTH_REQUIRED', message: 'access_token=secret' }), 'AUTH_REQUIRED', '连接或重新授权'],
        [new ForbiddenException({ code: 'INSUFFICIENT_SCOPE', message: 'scope=secret' }), 'INSUFFICIENT_SCOPE', '授权范围不足'],
        [new ConflictException({ code: 'access_token=secret', message: 'provider detail' }), 'PROVIDER_UNAVAILABLE', '暂时不可用'],
    ])('maps gateway errors to safe model-facing summaries', async (gatewayError, code, expectedSummary) => {
        gateway.execute.mockRejectedValue(gatewayError);

        const execution = registry.get('tencent_meeting_get_profile')!.execute(context, {});

        await expect(execution).rejects.toMatchObject({ code, userFacingSummary: expect.stringContaining(expectedSummary) });
        await expect(execution).rejects.not.toThrow('secret');
        await execution.catch((error: unknown) => {
            expect(error).toBeInstanceOf(ToolExecutionError);
            expect((error as ToolExecutionError).message).not.toContain('secret');
        });
    });
});

function result(data: Record<string, unknown>) {
    return {
        contexts: [{
            provider: 'TENCENT_MEETING' as const,
            toolId: 'tencent_meeting.profile.get' as const,
            toolName: '腾讯会议工具',
            fetchedAt: '2026-09-23T00:00:00.000Z',
            data,
        }],
    };
}
