import { AuditOutcome } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { TencentMeetingClient, TencentMeetingProviderError } from './tencent-meeting.client';
import { TencentMeetingConfig } from './tencent-meeting.config';
import { TencentMeetingGatewayService } from './tencent-meeting-gateway.service';
import { TencentMeetingService } from './tencent-meeting.service';

describe('TencentMeetingGatewayService', () => {
    const context = {
        tenantId: '00000000-0000-4000-8000-000000000001',
        userId: '00000000-0000-4000-8000-000000000002',
        membershipId: '00000000-0000-4000-8000-000000000003',
        requestId: 'request-1',
        roles: [],
        permissions: [],
    };
    const tenantContext = { require: jest.fn(() => context) } as unknown as TenantContext;
    const auditCreate = jest.fn().mockResolvedValue({});
    const prisma = { auditLog: { create: auditCreate } } as unknown as PrismaService;
    const settings = { executionResponseMaxBytes: 262144 };
    const config = { settings: jest.fn(() => settings) } as unknown as TencentMeetingConfig;
    const requireAuthorizedCredential = jest.fn();
    const meetingService = { requireAuthorizedCredential } as unknown as TencentMeetingService;
    const getUserInfo = jest.fn();
    const listMeetings = jest.fn();
    const getMeeting = jest.fn();
    const listParticipants = jest.fn();
    const listRecordings = jest.fn();
    const client = {
        getUserInfo,
        listMeetings,
        getMeeting,
        listParticipants,
        listRecordings,
    } as unknown as TencentMeetingClient;
    const service = new TencentMeetingGatewayService(prisma, tenantContext, config, client, meetingService);

    beforeEach(() => {
        jest.clearAllMocks();
        settings.executionResponseMaxBytes = 262144;
        requireAuthorizedCredential.mockResolvedValue(credential([]));
        getUserInfo.mockResolvedValue({
            externalUserId: 'open-1',
            displayName: '张三',
            organizationId: 'corp-1',
            organizationName: '示例公司',
        });
    });

    it('按 Scope 过滤工具目录并兼容历史空 Scope', async () => {
        requireAuthorizedCredential.mockResolvedValueOnce(credential(['VIEW_USER_INFO']));
        await expect(service.listTools()).resolves.toEqual({
            tools: [expect.objectContaining({ toolId: 'tencent_meeting.profile.get' })],
        });

        requireAuthorizedCredential.mockResolvedValueOnce(credential([]));
        await expect(service.listTools()).resolves.toMatchObject({ tools: expect.arrayContaining([
            expect.objectContaining({ toolId: 'tencent_meeting.profile.get' }),
            expect.objectContaining({ toolId: 'tencent_meeting.recordings.list' }),
        ]) });
    });

    it.each([
        [{ calls: [] }],
        [{ calls: [{ toolId: 'unknown', arguments: {} }] }],
        [{ calls: [{ toolId: 'tencent_meeting.profile.get', arguments: { extra: true } }] }],
        [{ calls: [{ toolId: 'tencent_meeting.meetings.list', arguments: { startTime: 'bad-date' } }] }],
        [{ calls: [{ toolId: 'tencent_meeting.meetings.list', arguments: { pageSize: 101 } }] }],
    ])('拒绝非法调用 %#', async (input) => {
        await expect(service.execute(input)).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'INVALID_ARGUMENTS' }),
        });
        expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ action: 'TENCENT_MEETING_READ_FAILED', outcome: AuditOutcome.FAILURE }),
        }));
    });

    it('顺序执行并只返回会议字段白名单', async () => {
        listMeetings.mockResolvedValue({ remaining: 0, meeting_info_list: [{
            meeting_id: 'meeting-1',
            meeting_code: '123456',
            subject: '周会',
            start_time: 1_800_000_000,
            end_time: 1_800_003_600,
            phone: '13800000000',
            email: 'secret@example.com',
            download_url: 'https://secret.test/file',
        }] });

        const result = await service.execute({ calls: [
            { toolId: 'tencent_meeting.profile.get', arguments: {} },
            { toolId: 'tencent_meeting.meetings.list', arguments: { page: 1, pageSize: 20 } },
        ] });

        expect(result.contexts.map((item) => item.toolId)).toEqual([
            'tencent_meeting.profile.get',
            'tencent_meeting.meetings.list',
        ]);
        expect(JSON.stringify(result)).not.toContain('13800000000');
        expect(JSON.stringify(result)).not.toContain('secret@example.com');
        expect(JSON.stringify(result)).not.toContain('download_url');
        expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                action: 'TENCENT_MEETING_READ_EXECUTED',
                metadata: expect.objectContaining({ callCount: 2, resultBytes: expect.any(Number) }),
            }),
        }));
    });

    it('将 pageSize 100 的参会成员请求拆成两个上游分页', async () => {
        listParticipants
            .mockResolvedValueOnce({ total_count: 100, participants: participants(0, 50) })
            .mockResolvedValueOnce({ total_count: 100, participants: participants(50, 50) });

        const result = await service.execute({ calls: [{
            toolId: 'tencent_meeting.participants.list',
            arguments: { meetingId: 'meeting-1', page: 1, pageSize: 100 },
        }] });

        expect(listParticipants).toHaveBeenNthCalledWith(1, 'access-token', 'open-1', 'meeting-1', 1, 50);
        expect(listParticipants).toHaveBeenNthCalledWith(2, 'access-token', 'open-1', 'meeting-1', 2, 50);
        const data = result.contexts[0].data as { items: Record<string, unknown>[] };
        expect(data.items).toHaveLength(100);
        expect(JSON.stringify(data)).not.toContain('secret@example.com');
        expect(data.items[0]).toEqual(expect.objectContaining({ participantKey: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    });

    it('录制结果不返回播放或下载地址', async () => {
        getMeeting.mockResolvedValue({ meeting_info_list: [{ meeting_id: 'meeting-1', start_time: 1_800_000_000, end_time: 1_800_003_600 }] });
        listRecordings.mockResolvedValue({ total_page: 1, record_meetings: [{
            meeting_record_id: 'record-group-1',
            record_files: [{
                record_id: 101,
                file_type: 'mp4',
                record_size: 1024,
                state: 3,
                download_url: 'https://secret.test/download',
                play_url: 'https://secret.test/play',
            }],
        }] });

        const result = await service.execute({ calls: [{
            toolId: 'tencent_meeting.recordings.list',
            arguments: { meetingId: 'meeting-1' },
        }] });

        expect(result.contexts[0].data).toEqual({
            items: [expect.objectContaining({ recordingId: '101', meetingId: 'meeting-1', fileType: 'mp4', fileSize: 1024, status: 3 })],
            total: 1,
        });
        expect(listRecordings).toHaveBeenCalledWith('access-token', 'open-1', 'meeting-1', 1_799_996_400, 1_800_007_200, 1);
        expect(JSON.stringify(result)).not.toContain('secret.test');
    });

    it('映射上游限流并且审计中不包含凭据', async () => {
        listMeetings.mockRejectedValue(new TencentMeetingProviderError('PROVIDER_RATE_LIMITED', '请求过于频繁', 429));

        await expect(service.execute({ calls: [{
            toolId: 'tencent_meeting.meetings.list',
            arguments: {},
        }] })).rejects.toMatchObject({ status: 429 });

        expect(JSON.stringify(auditCreate.mock.calls)).not.toContain('access-token');
        expect(JSON.stringify(auditCreate.mock.calls)).not.toContain('refresh-token');
    });

    it('拒绝超过执行响应大小限制的结果', async () => {
        settings.executionResponseMaxBytes = 100;
        getUserInfo.mockResolvedValue({
            externalUserId: 'open-1',
            displayName: '很长'.repeat(100),
            organizationId: null,
            organizationName: null,
        });

        await expect(service.execute({ calls: [{
            toolId: 'tencent_meeting.profile.get',
            arguments: {},
        }] })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
        });
    });
});

function credential(grantedScopes: string[]) {
    return {
        connectionId: '00000000-0000-4000-8000-000000000020',
        accessToken: 'access-token',
        openId: 'open-1',
        grantedScopes,
        account: {
            externalUserId: 'open-1',
            displayName: '张三',
            organizationId: 'corp-1',
            organizationName: '示例公司',
        },
    };
}

function participants(offset: number, count: number) {
    return Array.from({ length: count }, (_, index) => ({
        user_id: `user-${offset + index}`,
        user_name: `成员${offset + index}`,
        join_time: 1_800_000_000 + index,
        email: 'secret@example.com',
        ip: '127.0.0.1',
    }));
}
