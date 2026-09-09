import COS = require('cos-nodejs-sdk-v5');
import { createTencentCosClient } from './storage.module';
import type { StorageConfig } from './storage.types';

describe('createTencentCosClient', () => {
    it('constructs the CommonJS COS SDK without relying on a default export', () => {
        const config: StorageConfig = {
            provider: 'TENCENT_COS',
            secretId: 'test-secret-id',
            secretKey: 'test-secret-key',
            region: 'ap-chengdu',
            bucket: 'test-1403013862',
            objectPrefix: 'cees/staging',
            signedUrlTtlSeconds: 600,
            maxUploadBytes: 104_857_600,
        };

        expect(createTencentCosClient(config)).toBeInstanceOf(COS);
    });
});