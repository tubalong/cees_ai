import { TencentMeetingClient, TencentMeetingProviderError } from './tencent-meeting.client';
import { TencentMeetingConfig } from './tencent-meeting.config';

describe('TencentMeetingClient', () => {
    const settings = {
        sdkId: 'sdk-1',
        corpId: 'corp-1',
        secret: 'secret-1',
        redirectUri: 'https://cees.test/api/v1/connectors/tencent-meeting/oauth/callback',
        authorizeUrl: 'https://meeting.test/marketplace/oauth/authorize.html',
        tokenUrl: 'https://meeting.test/access-token',
        refreshTokenUrl: 'https://meeting.test/refresh-token',
        userInfoUrl: 'https://meeting.test/user-info',
        apiBaseUrl: 'https://api.meeting.test',
        requestTimeoutMs: 1000,
        providerResponseMaxBytes: 524288,
        executionResponseMaxBytes: 262144,
    };
    const config = { assertConfigured: jest.fn(() => settings) } as unknown as TencentMeetingConfig;
    const client = new TencentMeetingClient(config);
    const fetchMock = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    it('使用 open_id、scopes 和绝对 expires 解析 Token', async () => {
        fetchMock.mockResolvedValue(jsonResponse({
            access_token: 'access-1',
            refresh_token: 'refresh-1',
            open_id: 'open-1',
            open_corp_id: 'open-corp-1',
            expires: 1_800_000_000,
            scopes: ['VIEW_USER_INFO', 'VIEW_VIDEO'],
        }));

        const result = await client.exchangeAuthorizationCode('auth-code-1');

        expect(fetchMock).toHaveBeenCalledWith('https://meeting.test/access-token', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ sdk_id: 'sdk-1', secret: 'secret-1', auth_code: 'auth-code-1' }),
        }));
        expect(result).toMatchObject({
            accessToken: 'access-1',
            refreshToken: 'refresh-1',
            externalUserId: 'open-1',
            openId: 'open-1',
            openCorpId: 'open-corp-1',
            scopes: ['VIEW_USER_INFO', 'VIEW_VIDEO'],
            accessTokenExpiresAt: new Date(1_800_000_000 * 1000),
        });
    });

    it('刷新 Token 时发送 open_id 而不是应用 Secret', async () => {
        fetchMock.mockResolvedValue(jsonResponse({
            access_token: 'access-2',
            refresh_token: 'refresh-2',
            open_id: 'open-1',
            expires: 1_800_000_000,
        }));

        await client.refresh('refresh-1', 'open-1');

        expect(fetchMock).toHaveBeenCalledWith('https://meeting.test/refresh-token', expect.objectContaining({
            body: JSON.stringify({ sdk_id: 'sdk-1', refresh_token: 'refresh-1', open_id: 'open-1' }),
        }));
        expect(fetchMock.mock.calls[0][1].body).not.toContain('secret-1');
    });

    it('查询用户信息时通过 JSON Body 传递 Access Token 和 OpenId', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ data: { open_id: 'open-1', username: '张三', open_corp_id: 'corp-open-1' } }));

        await expect(client.getUserInfo('access-1', 'open-1', 'fallback')).resolves.toEqual({
            externalUserId: 'open-1',
            displayName: '张三',
            organizationId: 'corp-open-1',
            organizationName: null,
        });
        expect(fetchMock).toHaveBeenCalledWith('https://meeting.test/user-info', expect.objectContaining({
            body: JSON.stringify({ access_token: 'access-1', open_id: 'open-1' }),
        }));
    });

    it('开放 API 使用 OAuth Header 且不把 Token 放入 URL', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ meeting_info_list: [] }));

        await client.listMeetings('access-1', 'open-1');

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://api.meeting.test/v1/meetings?userid=open-1&instanceid=1');
        expect(url).not.toContain('access-1');
        expect(init.headers).toEqual(expect.objectContaining({
            AccessToken: 'access-1',
            OpenId: 'open-1',
            'X-TC-Registered': '1',
            'X-TC-Timestamp': expect.any(String),
            'X-TC-Nonce': expect.stringMatching(/^\d+$/),
        }));
    });

    it('会议列表游标和录制必填时间窗由固定客户端构造', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ meeting_info_list: [] }));
        await client.listMeetings('access-1', 'open-1', { pos: 1_800_000_000, cursory: 20 });
        expect(fetchMock.mock.calls[0][0]).toBe(
            'https://api.meeting.test/v1/meetings?userid=open-1&instanceid=1&pos=1800000000&cursory=20',
        );

        fetchMock.mockResolvedValueOnce(jsonResponse({ record_meetings: [] }));
        await client.listRecordings('access-1', 'open-1', 'meeting-1', 1_800_000_000, 1_800_003_600, 2);
        expect(fetchMock.mock.calls[1][0]).toBe(
            'https://api.meeting.test/v1/records?meeting_id=meeting-1&operator_id=open-1&operator_id_type=2&start_time=1800000000&end_time=1800003600&page=2&page_size=20',
        );
    });

    it('映射上游权限错误且不透传原始详情', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ error_info: { error_code: 9042, message: 'secret provider detail' } }, false, 500));

        const error = await client.getMeeting('access-1', 'open-1', 'meeting-1').catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(TencentMeetingProviderError);
        expect(error).toMatchObject({ providerCode: 'RESOURCE_FORBIDDEN', status: 403 });
        expect(JSON.stringify(error)).not.toContain('secret provider detail');
    });
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
    return { ok, status, text: async () => JSON.stringify(body) } as Response;
}
