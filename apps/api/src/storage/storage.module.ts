import { Module } from '@nestjs/common';
import COS from 'cos-nodejs-sdk-v5';
import { CosObjectKeyFactory } from './cos-object-key.factory';
import { loadStorageConfig } from './storage.config';
import { STORAGE_CONFIG, STORAGE_PROVIDER, STORAGE_SETTINGS, TENCENT_COS_CLIENT } from './storage.tokens';
import type { StorageConfig, StorageSettings } from './storage.types';
import { TencentCosStorageProvider } from './tencent-cos-storage.provider';

@Module({
    providers: [
        {
            provide: STORAGE_CONFIG,
            useFactory: loadStorageConfig,
        },
        {
            provide: TENCENT_COS_CLIENT,
            inject: [STORAGE_CONFIG],
            useFactory: (config: StorageConfig): COS => new COS({
                SecretId: config.secretId,
                SecretKey: config.secretKey,
            }),
        },
        {
            provide: STORAGE_SETTINGS,
            inject: [STORAGE_CONFIG],
            useFactory: (config: StorageConfig): StorageSettings => ({
                provider: config.provider,
                region: config.region,
                bucket: config.bucket,
                objectPrefix: config.objectPrefix,
                signedUrlTtlSeconds: config.signedUrlTtlSeconds,
                maxUploadBytes: config.maxUploadBytes,
            }),
        },
        TencentCosStorageProvider,
        {
            provide: STORAGE_PROVIDER,
            useExisting: TencentCosStorageProvider,
        },
        CosObjectKeyFactory,
    ],
    exports: [STORAGE_SETTINGS, STORAGE_PROVIDER, CosObjectKeyFactory],
})
export class StorageModule { }
