import type { StorageConfig } from './storage.types';

const OBJECT_PREFIX_PATTERN = /^cees\/(local|staging|prod)$/;

export function loadStorageConfig(): StorageConfig {
    const secretId = required('TENCENT_COS_SECRET_ID');
    const secretKey = required('TENCENT_COS_SECRET_KEY');
    const region = required('TENCENT_COS_REGION');
    const bucket = required('TENCENT_COS_BUCKET');
    const objectPrefix = required('TENCENT_COS_OBJECT_PREFIX');
    if (!OBJECT_PREFIX_PATTERN.test(objectPrefix)) {
        throw new Error('TENCENT_COS_OBJECT_PREFIX must be cees/local, cees/staging, or cees/prod');
    }
    if (process.env.NODE_ENV === 'production' && (secretId.startsWith('change_me') || secretKey.startsWith('change_me'))) {
        throw new Error('Tencent COS example credentials must be replaced in production');
    }

    return {
        provider: 'TENCENT_COS',
        secretId,
        secretKey,
        region,
        bucket,
        objectPrefix: objectPrefix as StorageConfig['objectPrefix'],
        signedUrlTtlSeconds: positiveInteger('TENCENT_COS_SIGNED_URL_TTL_SECONDS', 600, 60, 3_600),
        maxUploadBytes: positiveInteger('TENCENT_COS_UPLOAD_MAX_BYTES', 104_857_600, 1, 524_288_000),
    };
}

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function positiveInteger(name: string, fallback: number, minimum: number, maximum: number): number {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
    return value;
}
