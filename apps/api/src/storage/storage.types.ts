export interface StorageConfig {
    provider: 'TENCENT_COS';
    secretId: string;
    secretKey: string;
    region: string;
    bucket: string;
    objectPrefix: `cees/${'local' | 'staging' | 'production'}`;
    signedUrlTtlSeconds: number;
    maxUploadBytes: number;
}

export type StorageSettings = Omit<StorageConfig, 'secretId' | 'secretKey'>;

export interface CreateSignedUploadInput {
    objectKey: string;
    contentType: string;
    ttlSeconds?: number;
}

export interface PutObjectInput {
    objectKey: string;
    body: Buffer;
    contentType: string;
}

export interface SignedUploadInstruction {
    method: 'PUT';
    url: string;
    headers: Record<string, string>;
    expiresAt: Date;
}

export interface StoredObjectMetadata {
    sizeBytes: number;
    contentType: string | null;
    etag: string | null;
}

/**
 * 供业务模块调用的对象存储抽象。COS 长期凭据只能封装在具体 Provider 内部，
 * 任何实现都不得把 SecretId 或 SecretKey 返回给 API 调用方。
 */
export interface StorageProvider {
    /** 为服务端生成的单一对象键签发短时 PUT URL，不允许使用通配前缀。 */
    createUploadUrl(input: CreateSignedUploadInput): Promise<SignedUploadInstruction>;

    /** 客户端直传后，从存储服务读取可信对象元数据，不能使用客户端上报值替代。 */
    headObject(objectKey: string): Promise<StoredObjectMetadata>;

    /** 服务端直传：把内存字节写入明确对象键并返回可信对象元数据。 */
    putObject(input: PutObjectInput): Promise<StoredObjectMetadata>;

    /** 在上层完成业务授权后，为私有对象签发短时下载 URL。 */
    createDownloadUrl(objectKey: string, ttlSeconds?: number): Promise<string>;

    /** 永久删除一个明确对象；调用前必须由上层完成租户和业务授权。 */
    deleteObject(objectKey: string): Promise<void>;
}

export class StorageObjectNotFoundError extends Error {
    constructor() {
        super('Storage object was not found');
        this.name = 'StorageObjectNotFoundError';
    }
}

export class StorageProviderError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'StorageProviderError';
    }
}
