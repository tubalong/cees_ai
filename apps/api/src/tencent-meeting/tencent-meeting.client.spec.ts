import { TencentMeetingClient, TencentMeetingProviderError } from './tencent-meeting.client';
import { TencentMeetingConfig } from './tencent-meeting.config';

describe('TencentMeetingClient', () => {
    const settings = {
        sdkId: 'sdk-1',
        secret: 'secret-1',
        redirectUri: 'https://cees.test/api/v1/connectors/tencent-meeting/oauth/callback',
        authorizeUrl: 'https://meeting.test/oauth2/authorize',
        tokenUrl: 'https://meeting.test/access-token',
        refreshTokenUrl: 'https://meeting.test/refresh-token',
        userInfoUrl: 'https://meeting.test/user-info',
        requestTimeoutMs: 1000,
    };
    const config = { assertConfigured: jest.fn(() => settings) } as unknown as TencentMeetingConfig;
    const client = new TencentMeetingClient(config);
    const fetchMock = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    it('使用官方 auth_code 请求换取 Token 并解析绝对过期时间', async () => {
        fetchMock.mockResolvedValue(jsonResponse({
            access_token: 'access-1',
            refresh_token: 'refresh-1',
            user_id: 'user-1',
            open_id: 'open-1',
            expires_in: 1_800_000_000,
            scope: 'meeting.read user.read',
        }));

        const result = await client.exchangeAuthorizationCode('auth-code-1');

        expect(fetchMock).toHaveBeenCalledWith('https://meeting.test/access-token', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ sdk_id: 'sdk-1', secret: 'secret-1', auth_code: 'auth-code-1' }),
        }));
        expect(result).toMatchObject({
            accessToken: 'access-1',
            refreshToken: 'refresh-1',
            externalUserId: 'user-1',
            openId: 'open-1',
            scopes: ['meeting.read', 'user.read'],
            accessTokenExpiresAt: new Date(1_800_000_000 * 1000),
        });
    });

    it('查询用户信息时通过 Header 传递 AccessToken 和 OpenId', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ data: { userid: 'user-1', username: '张三', open_corp_id: 'corp-open-1' } }));

        await expect(client.getUserInfo('access-1', 'open-1', 'fallback')).resolves.toEqual({
            externalUserId: 'user-1',
            displayName: '张三',
            organizationId: 'corp-open-1',
            organizationName: null,
        });
        expect(fetchMock).toHaveBeenCalledWith('https://meeting.test/user-info', expect.objectContaining({
            headers: expect.objectContaining({ AccessToken: 'access-1', OpenId: 'open-1' }),
        }));
    });

    it('不向调用方透传提供方原始错误信息', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ code: 40001, message: 'secret provider detail' }, false, 400));

        const error = await client.exchangeAuthorizationCode('bad-code').catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(TencentMeetingProviderError);
        expect(error).toMatchObject({ providerCode: 'PROVIDER_UNAVAILABLE', message: '腾讯会议开放平台调用失败' });
        expect(JSON.stringify(error)).not.toContain('secret provider detail');
    });
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
    return {
        ok,
        status,
        text: async () => JSON.stringify(body),
    } as Response;
}
