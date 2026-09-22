import { TencentMeetingConfig } from './tencent-meeting.config';

describe('TencentMeetingConfig', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = {
            ...originalEnv,
            NODE_ENV: 'production',
            TENCENT_MEETING_SDK_ID: 'sdk-1',
            TENCENT_MEETING_SECRET: 'secret-1',
            TENCENT_MEETING_REDIRECT_URI: 'https://cees.test/api/v1/connectors/tencent-meeting/oauth/callback',
            TENCENT_MEETING_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
        };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('生产配置完整时启用连接器', () => {
        const config = new TencentMeetingConfig();

        expect(config.isConfigured()).toBe(true);
        expect(config.settings()).toMatchObject({ sdkId: 'sdk-1', secret: 'secret-1' });
        expect(config.encryptionKey()).toHaveLength(32);
    });

    it('拒绝示例占位 Secret', () => {
        process.env.TENCENT_MEETING_SECRET = 'change_me';
        const config = new TencentMeetingConfig();

        expect(config.isConfigured()).toBe(false);
        expect(() => config.assertConfigured()).toThrow();
    });

    it('生产环境拒绝非 HTTPS 回调', () => {
        process.env.TENCENT_MEETING_REDIRECT_URI = 'http://localhost/callback';
        const config = new TencentMeetingConfig();

        expect(config.isConfigured()).toBe(false);
    });
});
