import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../../database/prisma.service';
import { TenantContext } from '../../../tenant/tenant-context';
import type { TencentMeetingClient } from '../../../tencent-meeting/tencent-meeting.client';
import type { TencentMeetingConfig } from '../../../tencent-meeting/tencent-meeting.config';
import { TencentMeetingGatewayService } from '../../../tencent-meeting/tencent-meeting-gateway.service';
import type { TencentMeetingService } from '../../../tencent-meeting/tencent-meeting.service';
import { ToolPolicyService } from '../tool-policy.service';
import { ToolRegistryService } from '../tool-registry';
import { ToolExecutionError, type ToolExecutionContext } from '../tool.types';
import { TencentMeetingTools } from './tencent-meeting.tools';

const TENANT_A = '10000000-0000-4000-8000-000000000001';
const TENANT_B = '20000000-0000-4000-8000-000000000001';

describe('Tencent Meeting Assistant integration', () => {
    let registry: ToolRegistryService;
    let policy: ToolPolicyService;
    let tenantContext: TenantContext;
    let requireAuthorizedCredential: jest.Mock;
    let listMeetings: jest.Mock;
    let getMeeting: jest.Mock;
    let listParticipants: jest.Mock;
    let listRecordings: jest.Mock;
    let auditCreate: jest.Mock;

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-09-23T04:30:00.000Z'));
        tenantContext = new TenantContext();
        auditCreate = jest.fn().mockResolvedValue({});
        const prisma = {
            tenant: {
                findFirst: jest.fn(async (input: { where: { id: string } }) => ({
                    timezone: input.where.id === TENANT_B ? 'UTC' : 'Asia/Shanghai',
                })),
            },
            auditLog: { create: auditCreate },
        } as unknown as PrismaService;
        requireAuthorizedCredential = jest.fn(async () => credentialFor(tenantContext.require().membershipId));
        listMeetings = jest.fn();
        getMeeting = jest.fn();
        listParticipants = jest.fn();
        listRecordings = jest.fn();
        const client = {
            getUserInfo: jest.fn(),
            listMeetings,
            getMeeting,
            listParticipants,
            listRecordings,
        } as unknown as TencentMeetingClient;
        const gateway = new TencentMeetingGatewayService(
            prisma,
            tenantContext,
            { settings: () => ({ executionResponseMaxBytes: 262144 }) } as unknown as TencentMeetingConfig,
            client,
            { requireAuthorizedCredential } as unknown as TencentMeetingService,
        );
        registry = new ToolRegistryService();
        policy = new ToolPolicyService(registry);
        new TencentMeetingTools(registry, gateway, tenantContext, prisma).onModuleInit();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('exposes member-level tools and executes the next-meeting path through the real gateway', async () => {
        listMeetings.mockResolvedValue({
            remaining: 0,
            meeting_info_list: [
                {
                    meeting_id: 'meeting-later',
                    meeting_code: '200002',
                    subject: '项目周会',
                    start_time: '2026-09-23T07:00:00.000Z',
                    end_time: '2026-09-23T08:00:00.000Z',
                    phone: '13800000000',
                },
                {
                    meeting_id: 'meeting-next',
                    meeting_code: '200001',
                    subject: '项目周会',
                    start_time: '2026-09-23T05:00:00.000Z',
                    end_time: '2026-09-23T06:00:00.000Z',
                    email: 'secret@example.com',
                },
            ],
        });

        expect(registry.listAllowed([]).map((tool) => tool.name)).toEqual(expect.arrayContaining([
            'tencent_meeting_get_profile',
            'tencent_meeting_list_meetings',
            'tencent_meeting_get_meeting',
            'tencent_meeting_list_participants',
            'tencent_meeting_list_recordings',
        ]));
        const result = await execute(
            policy,
            context(TENANT_A, 'membership-a'),
            'tencent_meeting_list_meetings',
            { range: 'UPCOMING_7_DAYS' },
        );
        const summary = JSON.parse(result.summary) as {
            meetings: Array<{ meeting_id: string; subject: string }>;
            next_meeting_id: string;
        };

        expect(listMeetings).toHaveBeenCalledWith('access-membership-a', 'open-membership-a', {
            pos: expect.any(Number),
            cursory: 0,
        });
        expect(summary.meetings.map((meeting) => meeting.meeting_id)).toEqual(['meeting-next', 'meeting-later']);
        expect(summary.next_meeting_id).toBe('meeting-next');
        expect(result.summary).not.toContain('13800000000');
        expect(result.summary).not.toContain('secret@example.com');
        expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                tenantId: TENANT_A,
                actorMembershipId: 'membership-a',
                action: 'TENCENT_MEETING_READ_EXECUTED',
            }),
        }));
    });

    it('keeps the meeting id across detail, participant and recording follow-up calls', async () => {
        getMeeting.mockResolvedValue({
            meeting_info_list: [{
                meeting_id: 'meeting-next',
                subject: '项目周会',
                start_time: 1_790_136_000,
                end_time: 1_790_139_600,
                password: 'must-not-leak',
            }],
        });
        listParticipants.mockResolvedValue({
            total_count: 1,
            participants: [{
                user_id: 'provider-user-1',
                user_name: '李四',
                join_time: 1_790_136_100,
                phone: '13800000000',
                email: 'secret@example.com',
                ip: '127.0.0.1',
            }],
        });
        listRecordings.mockResolvedValue({
            total_page: 1,
            record_meetings: [{
                record_files: [{
                    record_id: 'recording-1',
                    file_type: 'mp4',
                    state: 3,
                    has_summary: true,
                    download_url: 'https://secret.test/download',
                }],
            }],
        });
        const executionContext = context(TENANT_A, 'membership-a');

        const detail = await execute(policy, executionContext, 'tencent_meeting_get_meeting', {
            meeting_id: 'meeting-next',
        });
        const participants = await execute(policy, executionContext, 'tencent_meeting_list_participants', {
            meeting_id: 'meeting-next',
        });
        const recordings = await execute(policy, executionContext, 'tencent_meeting_list_recordings', {
            meeting_id: 'meeting-next',
        });

        expect(JSON.parse(detail.summary).meeting.meeting_id).toBe('meeting-next');
        expect(JSON.parse(participants.summary).meeting_id).toBe('meeting-next');
        expect(JSON.parse(recordings.summary).meeting_id).toBe('meeting-next');
        const combined = `${detail.summary}${participants.summary}${recordings.summary}`;
        expect(combined).not.toContain('provider-user-1');
        expect(combined).not.toContain('13800000000');
        expect(combined).not.toContain('secret@example.com');
        expect(combined).not.toContain('127.0.0.1');
        expect(combined).not.toContain('secret.test');
        expect(combined).not.toContain('must-not-leak');
    });

    it('uses the execution-time tenant and member for credentials, timezone and audit isolation', async () => {
        listMeetings.mockResolvedValue({ remaining: 0, meeting_info_list: [] });

        const first = await execute(policy, context(TENANT_A, 'membership-a'), 'tencent_meeting_list_meetings', {
            range: 'TODAY',
        });
        const second = await execute(policy, context(TENANT_B, 'membership-b'), 'tencent_meeting_list_meetings', {
            range: 'TODAY',
        });

        expect(JSON.parse(first.summary).tenant_timezone).toBe('Asia/Shanghai');
        expect(JSON.parse(second.summary).tenant_timezone).toBe('UTC');
        expect(requireAuthorizedCredential).toHaveBeenCalledTimes(2);
        expect(listMeetings).toHaveBeenNthCalledWith(1, 'access-membership-a', 'open-membership-a', expect.any(Object));
        expect(listMeetings).toHaveBeenNthCalledWith(2, 'access-membership-b', 'open-membership-b', expect.any(Object));
        expect(auditCreate.mock.calls.map((call) => call[0].data.tenantId)).toEqual([TENANT_A, TENANT_B]);
        expect(auditCreate.mock.calls.map((call) => call[0].data.actorMembershipId)).toEqual(['membership-a', 'membership-b']);
    });

    it('returns controlled reconnect and scope messages after disconnect or insufficient authorization', async () => {
        requireAuthorizedCredential.mockRejectedValueOnce(new ConflictException({
            code: 'AUTH_REQUIRED',
            message: 'access_token=must-not-leak',
        }));
        const disconnected = execute(policy, context(TENANT_A, 'membership-a'), 'tencent_meeting_get_profile', {});
        await expect(disconnected).rejects.toMatchObject({
            code: 'AUTH_REQUIRED',
            userFacingSummary: expect.stringContaining('连接或重新授权腾讯会议'),
        });
        await disconnected.catch((error: unknown) => {
            expect(error).toBeInstanceOf(ToolExecutionError);
            expect((error as ToolExecutionError).message).not.toContain('must-not-leak');
        });

        requireAuthorizedCredential.mockResolvedValueOnce({
            ...credentialFor('membership-a'),
            grantedScopes: ['VIEW_USER_INFO'],
        });
        const insufficient = execute(policy, context(TENANT_A, 'membership-a'), 'tencent_meeting_list_meetings', {
            range: 'TODAY',
        });
        await expect(insufficient).rejects.toMatchObject({
            code: 'INSUFFICIENT_SCOPE',
            userFacingSummary: expect.stringContaining('授权范围不足'),
        });
        expect(listMeetings).not.toHaveBeenCalled();
    });
});

async function execute(
    policy: ToolPolicyService,
    executionContext: ToolExecutionContext,
    name: string,
    argumentsValue: Record<string, unknown>,
) {
    const approval = policy.approve({ name, arguments: argumentsValue, permissions: [] });
    return approval.definition.execute(executionContext, approval.parsedArguments);
}

function context(tenantId: string, membershipId: string): ToolExecutionContext {
    return {
        tenantId,
        userId: `user-${membershipId}`,
        membershipId,
        requestId: `request-${membershipId}`,
        conversationId: `conversation-${membershipId}`,
        turnId: `turn-${membershipId}`,
        toolCallId: `tool-${membershipId}`,
        executionOwner: 'api-1',
        executionToken: `token-${membershipId}`,
        permissions: [],
        roles: ['member'],
        knowledgeBaseEnabled: false,
        webSearchEnabled: false,
    };
}

function credentialFor(membershipId: string) {
    return {
        connectionId: `connection-${membershipId}`,
        accessToken: `access-${membershipId}`,
        openId: `open-${membershipId}`,
        grantedScopes: [],
        account: {
            externalUserId: `open-${membershipId}`,
            displayName: membershipId,
            organizationId: null,
            organizationName: null,
        },
    };
}
