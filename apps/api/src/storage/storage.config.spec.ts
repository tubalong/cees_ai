import { loadStorageConfig } from './storage.config';

describe('loadStorageConfig', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = {
            ...originalEnv,
            NODE_ENV: 'test',
            TENCENT_COS_SECRET_ID: 'test-secret-id',
            TENCENT_COS_SECRET_KEY: 'test-secret-key',
            TENCENT_COS_REGION: 'ap-chengdu',
            TENCENT_COS_BUCKET: 'cees-ai-1403013862',
            TENCENT_COS_OBJECT_PREFIX: 'cees/staging',
            TENCENT_COS_SIGNED_URL_TTL_SECONDS: '600',
            TENCENT_COS_UPLOAD_MAX_BYTES: '104857600',
        };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('loads the documented staging storage configuration', () => {
        expect(loadStorageConfig()).toEqual(expect.objectContaining({
            provider: 'TENCENT_COS',
            objectPrefix: 'cees/staging',
            signedUrlTtlSeconds: 600,
            maxUploadBytes: 104_857_600,
        }));
    });

    it('rejects object prefixes outside the three CEES environments', () => {
        process.env.TENCENT_COS_OBJECT_PREFIX = 'cees/other';
        expect(() => loadStorageConfig()).toThrow('TENCENT_COS_OBJECT_PREFIX');
    });
});
