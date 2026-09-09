import { Inject, Injectable } from '@nestjs/common';
import type COS = require('cos-nodejs-sdk-v5');
import { STORAGE_SETTINGS, TENCENT_COS_CLIENT } from './storage.tokens';
import {
    CreateSignedUploadInput,
    SignedUploadInstruction,
    StorageObjectNotFoundError,
    StorageProvider,
    StorageProviderError,
    StorageSettings,
    StoredObjectMetadata,
} from './storage.types';

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

@Injectable()
export class TencentCosStorageProvider implements StorageProvider {
    constructor(
        @Inject(STORAGE_SETTINGS) private readonly config: StorageSettings,
        @Inject(TENCENT_COS_CLIENT) private readonly cos: COS,
    ) { }

    /**
     * 只为一个精确对象键签名 PUT 请求。不会暴露 SecretId/SecretKey，也不允许
     * 调用方选择 Bucket、Region、租户前缀或通配路径。
     */
    async createUploadUrl(input: CreateSignedUploadInput): Promise<SignedUploadInstruction> {
        this.assertSourceObjectKey(input.objectKey);
        const contentType = normalizeContentType(input.contentType);
        if (!contentType || /[\u0000-\u001f\u007f\s]/u.test(contentType)) {
            throw new TypeError('COS upload Content-Type must be a normalized MIME type');
        }
        const ttlSeconds = this.resolveTtl(input.ttlSeconds);
        const expiresAt = new Date(Date.now() + ttlSeconds * 1_000);
        try {
            const url = this.cos.getObjectUrl({
                Bucket: this.config.bucket,
                Region: this.config.region,
                Key: input.objectKey,
                Method: 'PUT',
                Sign: true,
                Expires: ttlSeconds,
                Protocol: 'https:',
                Headers: { 'Content-Type': contentType },
            });
            if (!url) throw new Error('COS SDK returned an empty signed URL');
            return {
                method: 'PUT',
                url,
                headers: { 'Content-Type': contentType },
                expiresAt,
            };
        } catch (error) {
            throw new StorageProviderError('Unable to create Tencent COS upload URL', { cause: error });
        }
    }

    /**
     * 直接从 COS 读取对象元数据。完成上传时必须使用这里返回的结果，不能信任
     * 客户端提交的大小、MIME 或“上传成功”标志。
     */
    async headObject(objectKey: string): Promise<StoredObjectMetadata> {
        this.assertObjectKeyInEnvironment(objectKey);
        try {
            const result = await this.cos.headObject({
                Bucket: this.config.bucket,
                Region: this.config.region,
                Key: objectKey,
            });
            const contentLength = header(result.headers, 'content-length');
            const sizeBytes = Number(contentLength);
            if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
                throw new Error('COS returned an invalid Content-Length');
            }
            return {
                sizeBytes,
                contentType: header(result.headers, 'content-type'),
                etag: result.ETag ?? header(result.headers, 'etag'),
            };
        } catch (error) {
            if (isNotFound(error)) throw new StorageObjectNotFoundError();
            if (error instanceof StorageProviderError) throw error;
            throw new StorageProviderError('Unable to read Tencent COS object metadata', { cause: error });
        }
    }

    /** 上层业务授权成功后，为私有对象生成临时 GET URL。 */
    async createDownloadUrl(objectKey: string, ttlSeconds?: number): Promise<string> {
        this.assertObjectKeyInEnvironment(objectKey);
        try {
            const url = this.cos.getObjectUrl({
                Bucket: this.config.bucket,
                Region: this.config.region,
                Key: objectKey,
                Method: 'GET',
                Sign: true,
                Expires: this.resolveTtl(ttlSeconds),
                Protocol: 'https:',
            });
            if (!url) throw new Error('COS SDK returned an empty signed URL');
            return url;
        } catch (error) {
            throw new StorageProviderError('Unable to create Tencent COS download URL', { cause: error });
        }
    }

    /** 从配置的私有 Bucket 中删除一个由服务端选定的精确对象键。 */
    async deleteObject(objectKey: string): Promise<void> {
        this.assertObjectKeyInEnvironment(objectKey);
        try {
            await this.cos.deleteObject({
                Bucket: this.config.bucket,
                Region: this.config.region,
                Key: objectKey,
            });
        } catch (error) {
            if (isNotFound(error)) return;
            throw new StorageProviderError('Unable to delete Tencent COS object', { cause: error });
        }
    }

    private resolveTtl(requested?: number): number {
        if (requested === undefined) return this.config.signedUrlTtlSeconds;
        if (!Number.isSafeInteger(requested) || requested <= 0) throw new TypeError('Signed URL TTL must be positive');
        return Math.min(requested, this.config.signedUrlTtlSeconds);
    }

    /**
     * 限制所有 COS 操作只能访问当前运行环境的对象前缀，避免错误配置或被篡改的
     * 数据库记录跨越 local、staging、prod 的存储边界。
     */
    private assertObjectKeyInEnvironment(objectKey: string): void {
        const prefix = `${this.config.objectPrefix}/`;
        if (
            !objectKey.startsWith(prefix)
            || objectKey.includes('\\')
            || /[\u0000-\u001f\u007f]/u.test(objectKey)
            || objectKey.slice(prefix.length).split('/').some((segment) => !segment || segment === '.' || segment === '..')
        ) {
            throw new TypeError('COS object key must stay inside the configured CEES environment prefix');
        }
    }

    /**
     * 基础上传当前只允许写入 CEES 原文件路径：
     * cees/{environment}/tenants/{tenantId}/files/{yyyy}/{mm}/{fileId}/source。
     * tenantId 与 fileId 必须是 UUID，月份使用 UTC 的两位格式。
     */
    private assertSourceObjectKey(objectKey: string): void {
        this.assertObjectKeyInEnvironment(objectKey);
        const prefix = escapeRegExp(this.config.objectPrefix);
        const sourceKeyPattern = new RegExp(
            `^${prefix}/tenants/${UUID_SOURCE}/files/[0-9]{4}/(?:0[1-9]|1[0-2])/${UUID_SOURCE}/source$`,
            'i',
        );
        if (!sourceKeyPattern.test(objectKey)) {
            throw new TypeError('COS upload object key must match the documented CEES source-file path');
        }
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function header(headers: COS.Headers | undefined, name: string): string | null {
    if (!headers) return null;
    const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
    if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
    return value === undefined || value === null ? null : String(value);
}

function normalizeContentType(value: string): string {
    return value.trim().toLowerCase().split(';', 1)[0] ?? '';
}

function isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as { code?: string; statusCode?: number };
    return candidate.statusCode === 404 || candidate.code === 'NoSuchKey' || candidate.code === 'NotFound';
}
