import {
    BadGatewayException,
    BadRequestException,
    ConflictException,
    GoneException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    PayloadTooLargeException,
} from '@nestjs/common';
import { AuditOutcome, FilePurpose, Prisma, UploadSessionStatus } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { CosObjectKeyFactory } from '../storage/cos-object-key.factory';
import { STORAGE_PROVIDER, STORAGE_SETTINGS } from '../storage/storage.tokens';
import {
    StorageObjectNotFoundError,
    StorageProvider,
    StorageProviderError,
    StorageSettings,
} from '../storage/storage.types';
import { TenantContext } from '../tenant/tenant-context';
import { CreateUploadSessionDto } from './dto';
import { FileMetadataResult, UploadSessionResult } from './file.types';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const ALLOWED_ATTACHMENT_CONTENT_TYPES = new Set([
    'application/json',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/csv',
    'text/markdown',
    'text/plain',
]);

class UploadCompletionRaceError extends Error { }

@Injectable()
export class FileService {
    private readonly logger = new Logger(FileService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
        @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
        @Inject(STORAGE_SETTINGS) private readonly storageConfig: StorageSettings,
        private readonly objectKeys: CosObjectKeyFactory,
    ) { }

    async createUploadSession(
        idempotencyKey: string | undefined,
        input: CreateUploadSessionDto,
    ): Promise<UploadSessionResult> {
        const context = this.tenantContext.require();
        const normalizedKey = validateIdempotencyKey(idempotencyKey);
        const normalizedInput = normalizeInput(input);
        this.validateUploadPolicy(normalizedInput.contentType, normalizedInput.sizeBytes);
        const fingerprint = requestFingerprint(normalizedInput);

        const existing = await this.prisma.uploadSession.findUnique({
            where: {
                tenantId_createdByMembershipId_idempotencyKey: {
                    tenantId: context.tenantId,
                    createdByMembershipId: context.membershipId,
                    idempotencyKey: normalizedKey,
                },
            },
        });
        if (existing) return this.resumeExistingSession(existing, fingerprint);

        const fileId = randomUUID();
        const uploadSessionId = randomUUID();
        const objectKey = this.objectKeys.buildSourceKey({ tenantId: context.tenantId, fileId });
        const upload = await this.createSignedUpload(objectKey, normalizedInput.contentType);

        try {
            const session = await this.prisma.$transaction(async (transaction) => {
                const created = await transaction.uploadSession.create({
                    data: {
                        id: uploadSessionId,
                        tenantId: context.tenantId,
                        fileId,
                        createdBy: context.userId,
                        createdByMembershipId: context.membershipId,
                        idempotencyKey: normalizedKey,
                        requestFingerprint: fingerprint,
                        purpose: FilePurpose.ATTACHMENT,
                        originalName: normalizedInput.fileName,
                        mimeType: normalizedInput.contentType,
                        expectedSizeBytes: BigInt(normalizedInput.sizeBytes),
                        storageProvider: this.storageConfig.provider,
                        bucket: this.storageConfig.bucket,
                        region: this.storageConfig.region,
                        objectKey,
                        expiresAt: upload.expiresAt,
                    },
                });
                await transaction.auditLog.create({
                    data: {
                        tenantId: context.tenantId,
                        actorUserId: context.userId,
                        actorMembershipId: context.membershipId,
                        action: 'FILE_UPLOAD_SESSION_CREATED',
                        outcome: AuditOutcome.SUCCESS,
                        resourceType: 'FILE',
                        resourceId: fileId,
                        requestId: context.requestId,
                        metadata: {
                            uploadSessionId,
                            purpose: 'attachment',
                            fileName: normalizedInput.fileName,
                            contentType: normalizedInput.contentType,
                            sizeBytes: normalizedInput.sizeBytes,
                            objectKey,
                        },
                    },
                });
                return created;
            });
            return toUploadSessionResult(session, upload);
        } catch (error) {
            if (!isUniqueConstraintError(error)) throw error;
            const raced = await this.prisma.uploadSession.findUnique({
                where: {
                    tenantId_createdByMembershipId_idempotencyKey: {
                        tenantId: context.tenantId,
                        createdByMembershipId: context.membershipId,
                        idempotencyKey: normalizedKey,
                    },
                },
            });
            if (!raced) throw error;
            return this.resumeExistingSession(raced, fingerprint);
        }
    }

    async completeUploadSession(uploadSessionId: string): Promise<FileMetadataResult> {
        const context = this.tenantContext.require();
        const session = await this.prisma.uploadSession.findFirst({
            where: {
                id: uploadSessionId,
                tenantId: context.tenantId,
                createdByMembershipId: context.membershipId,
            },
        });
        if (!session) throw new NotFoundException({
            code: 'UPLOAD_SESSION_NOT_FOUND',
            message: '上传会话不存在',
        });
        if (session.status === UploadSessionStatus.COMPLETED) return this.requireCompletedFile(session.fileId);
        if (session.status !== UploadSessionStatus.PENDING) throw this.sessionStateConflict(session.status);
        if (session.expiresAt.getTime() <= Date.now()) {
            await this.expireSession(session.id, session.fileId);
            throw new GoneException({ code: 'UPLOAD_SESSION_EXPIRED', message: '上传会话已过期' });
        }
        this.assertSessionStorageMatchesEnvironment(session);

        const metadata = await this.readObjectMetadata(session.objectKey);
        const expectedSize = Number(session.expectedSizeBytes);
        const actualContentType = normalizeContentType(metadata.contentType ?? '');
        if (metadata.sizeBytes !== expectedSize || actualContentType !== session.mimeType) {
            await this.rejectMismatchedObject(session, metadata.sizeBytes, actualContentType);
            throw new ConflictException({
                code: 'UPLOAD_OBJECT_METADATA_MISMATCH',
                message: 'COS 对象大小或 Content-Type 与上传会话不一致',
                details: {
                    expectedSizeBytes: expectedSize,
                    actualSizeBytes: metadata.sizeBytes,
                    expectedContentType: session.mimeType,
                    actualContentType: actualContentType || null,
                },
            });
        }

        try {
            const file = await this.prisma.$transaction(async (transaction) => {
                const completed = await transaction.uploadSession.updateMany({
                    where: { id: session.id, status: UploadSessionStatus.PENDING },
                    data: { status: UploadSessionStatus.COMPLETED, completedAt: new Date() },
                });
                if (completed.count !== 1) throw new UploadCompletionRaceError();
                const created = await transaction.fileObject.create({
                    data: {
                        id: session.fileId,
                        tenantId: context.tenantId,
                        originalName: session.originalName,
                        purpose: session.purpose,
                        storageProvider: session.storageProvider,
                        bucket: session.bucket,
                        region: session.region,
                        objectKey: session.objectKey,
                        mimeType: session.mimeType,
                        sizeBytes: session.expectedSizeBytes,
                        etag: metadata.etag,
                        createdBy: context.userId,
                        updatedBy: context.userId,
                    },
                });
                await transaction.auditLog.create({
                    data: {
                        tenantId: context.tenantId,
                        actorUserId: context.userId,
                        actorMembershipId: context.membershipId,
                        action: 'FILE_UPLOAD_COMPLETED',
                        outcome: AuditOutcome.SUCCESS,
                        resourceType: 'FILE',
                        resourceId: session.fileId,
                        requestId: context.requestId,
                        metadata: {
                            uploadSessionId: session.id,
                            fileName: session.originalName,
                            contentType: session.mimeType,
                            sizeBytes: expectedSize,
                            objectKey: session.objectKey,
                            etag: metadata.etag,
                        },
                    },
                });
                return created;
            });
            return toFileMetadataResult(file);
        } catch (error) {
            if (!(error instanceof UploadCompletionRaceError)) throw error;
            return this.requireCompletedFile(session.fileId);
        }
    }

    /**
     * 服务端物化文本快照为正式 FileObject（知识库转存链路，块 7c）：写入 COS 后落库并写审计。
     * 不经过上传会话，只供服务端生成内容（AI 文档 / 对话消息快照）落库使用；
     * 身份上下文显式传入，后台执行（工具链）不依赖 AsyncLocalStorage。
     */
    async createMaterializedFile(input: {
        tenantId: string;
        userId: string;
        membershipId: string;
        requestId: string;
        name: string;
        mimeType: string;
        content: Buffer;
    }): Promise<string> {
        const fileId = randomUUID();
        const objectKey = this.objectKeys.buildSourceKey({ tenantId: input.tenantId, fileId });
        let metadata;
        try {
            metadata = await this.storage.putObject({
                objectKey,
                body: input.content,
                contentType: input.mimeType,
            });
        } catch (error) {
            if (error instanceof StorageProviderError || error instanceof TypeError) {
                throw new BadGatewayException({ code: 'COS_PUT_FAILED', message: '暂时无法写入 COS 对象' });
            }
            throw error;
        }
        await this.prisma.$transaction(async (transaction) => {
            await transaction.fileObject.create({
                data: {
                    id: fileId,
                    tenantId: input.tenantId,
                    originalName: input.name,
                    purpose: FilePurpose.ATTACHMENT,
                    storageProvider: this.storageConfig.provider,
                    bucket: this.storageConfig.bucket,
                    region: this.storageConfig.region,
                    objectKey,
                    mimeType: input.mimeType,
                    sizeBytes: BigInt(input.content.length),
                    etag: metadata.etag,
                    createdBy: input.userId,
                    updatedBy: input.userId,
                },
            });
            await transaction.auditLog.create({
                data: {
                    tenantId: input.tenantId,
                    actorUserId: input.userId,
                    actorMembershipId: input.membershipId,
                    action: 'FILE_MATERIALIZED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'FILE',
                    resourceId: fileId,
                    requestId: input.requestId,
                    metadata: {
                        purpose: 'knowledge-snapshot',
                        fileName: input.name,
                        contentType: input.mimeType,
                        sizeBytes: input.content.length,
                        objectKey,
                    },
                },
            });
        });
        return fileId;
    }

    private async resumeExistingSession(
        session: Prisma.UploadSessionGetPayload<Record<string, never>>,
        fingerprint: string,
    ): Promise<UploadSessionResult> {
        if (session.requestFingerprint !== fingerprint) throw new ConflictException({
            code: 'UPLOAD_IDEMPOTENCY_KEY_REUSED',
            message: '该幂等键已经用于不同的上传请求',
        });
        if (session.status !== UploadSessionStatus.PENDING) throw this.sessionStateConflict(session.status);
        const remainingSeconds = Math.floor((session.expiresAt.getTime() - Date.now()) / 1_000);
        if (remainingSeconds <= 0) {
            await this.expireSession(session.id, session.fileId);
            throw new GoneException({ code: 'UPLOAD_SESSION_EXPIRED', message: '上传会话已过期' });
        }
        this.assertSessionStorageMatchesEnvironment(session);
        const upload = await this.createSignedUpload(session.objectKey, session.mimeType, remainingSeconds);
        return toUploadSessionResult(session, upload);
    }

    private validateUploadPolicy(contentType: string, sizeBytes: number): void {
        if (!ALLOWED_ATTACHMENT_CONTENT_TYPES.has(contentType)) throw new BadRequestException({
            code: 'UPLOAD_CONTENT_TYPE_UNSUPPORTED',
            message: '当前基础上传接口不支持该文件类型',
            details: { contentType },
        });
        if (sizeBytes > this.storageConfig.maxUploadBytes) throw new PayloadTooLargeException({
            code: 'UPLOAD_FILE_TOO_LARGE',
            message: '文件超过当前环境允许的单文件大小',
            details: { maxUploadBytes: this.storageConfig.maxUploadBytes },
        });
    }

    private async createSignedUpload(objectKey: string, contentType: string, ttlSeconds?: number) {
        try {
            return await this.storage.createUploadUrl({ objectKey, contentType, ttlSeconds });
        } catch (error) {
            if (!(error instanceof StorageProviderError) && !(error instanceof TypeError)) throw error;
            throw new BadGatewayException({ code: 'COS_SIGNING_FAILED', message: '暂时无法创建 COS 上传地址' });
        }
    }

    private async readObjectMetadata(objectKey: string) {
        try {
            return await this.storage.headObject(objectKey);
        } catch (error) {
            if (error instanceof StorageObjectNotFoundError) throw new ConflictException({
                code: 'UPLOAD_OBJECT_NOT_FOUND',
                message: 'COS 中尚未找到本次上传对象',
            });
            if (error instanceof StorageProviderError) throw new BadGatewayException({
                code: 'COS_HEAD_FAILED',
                message: '暂时无法校验 COS 上传对象',
            });
            throw error;
        }
    }

    private async rejectMismatchedObject(
        session: Prisma.UploadSessionGetPayload<Record<string, never>>,
        actualSizeBytes: number,
        actualContentType: string,
    ): Promise<void> {
        const context = this.tenantContext.require();
        await this.prisma.$transaction(async (transaction) => {
            await transaction.uploadSession.updateMany({
                where: { id: session.id, status: UploadSessionStatus.PENDING },
                data: { status: UploadSessionStatus.FAILED, failureCode: 'OBJECT_METADATA_MISMATCH' },
            });
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'FILE_UPLOAD_REJECTED',
                    outcome: AuditOutcome.FAILURE,
                    resourceType: 'FILE',
                    resourceId: session.fileId,
                    requestId: context.requestId,
                    metadata: {
                        uploadSessionId: session.id,
                        reason: 'OBJECT_METADATA_MISMATCH',
                        expectedSizeBytes: Number(session.expectedSizeBytes),
                        actualSizeBytes,
                        expectedContentType: session.mimeType,
                        actualContentType: actualContentType || null,
                        objectKey: session.objectKey,
                    },
                },
            });
        });
        try {
            await this.storage.deleteObject(session.objectKey);
        } catch (error) {
            this.logger.error(`Unable to remove rejected COS object for upload session ${session.id}: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
    }

    private async expireSession(sessionId: string, fileId: string): Promise<void> {
        const context = this.tenantContext.require();
        await this.prisma.$transaction(async (transaction) => {
            const expired = await transaction.uploadSession.updateMany({
                where: { id: sessionId, status: UploadSessionStatus.PENDING },
                data: { status: UploadSessionStatus.EXPIRED, failureCode: 'SESSION_EXPIRED' },
            });
            if (expired.count === 0) return;
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'FILE_UPLOAD_EXPIRED',
                    outcome: AuditOutcome.FAILURE,
                    resourceType: 'FILE',
                    resourceId: fileId,
                    requestId: context.requestId,
                    metadata: { uploadSessionId: sessionId },
                },
            });
        });
    }

    private async requireCompletedFile(fileId: string): Promise<FileMetadataResult> {
        const { tenantId } = this.tenantContext.require();
        const file = await this.prisma.fileObject.findFirst({ where: { id: fileId, tenantId, deletedAt: null } });
        if (!file) throw new ConflictException({
            code: 'UPLOAD_COMPLETION_INCONSISTENT',
            message: '上传完成状态与文件记录不一致',
        });
        return toFileMetadataResult(file);
    }

    private assertSessionStorageMatchesEnvironment(session: {
        storageProvider: string;
        bucket: string;
        region: string;
        objectKey: string;
    }): void {
        const expectedPrefix = `${this.storageConfig.objectPrefix}/`;
        if (
            session.storageProvider !== this.storageConfig.provider
            || session.bucket !== this.storageConfig.bucket
            || session.region !== this.storageConfig.region
            || !session.objectKey.startsWith(expectedPrefix)
        ) {
            throw new ConflictException({
                code: 'UPLOAD_STORAGE_CONTEXT_CHANGED',
                message: '上传会话与当前 COS 环境配置不一致，请重新创建会话',
            });
        }
    }

    private sessionStateConflict(status: UploadSessionStatus): ConflictException {
        return new ConflictException({
            code: 'UPLOAD_SESSION_STATE_INVALID',
            message: '上传会话当前状态不可继续操作',
            details: { status },
        });
    }
}

function normalizeInput(input: CreateUploadSessionDto): CreateUploadSessionDto {
    const fileName = input.fileName.trim().normalize('NFC');
    if (!fileName || /[\u0000-\u001f\u007f]/u.test(fileName)) throw new BadRequestException({
        code: 'UPLOAD_FILE_NAME_INVALID',
        message: '文件名不能为空或包含控制字符',
    });
    return {
        purpose: input.purpose,
        fileName,
        contentType: normalizeContentType(input.contentType),
        sizeBytes: input.sizeBytes,
    };
}

function normalizeContentType(value: string): string {
    return value.trim().toLowerCase().split(';', 1)[0] ?? '';
}

function validateIdempotencyKey(value: string | undefined): string {
    const normalized = value?.trim();
    if (!normalized || !IDEMPOTENCY_KEY_PATTERN.test(normalized)) throw new BadRequestException({
        code: 'UPLOAD_IDEMPOTENCY_KEY_INVALID',
        message: 'Idempotency-Key 必须是 8～128 位字母、数字、点、下划线、冒号或连字符',
    });
    return normalized;
}

function requestFingerprint(input: CreateUploadSessionDto): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function toUploadSessionResult(
    session: { id: string; fileId: string; expiresAt: Date },
    upload: { method: 'PUT'; url: string; headers: Record<string, string>; expiresAt: Date },
): UploadSessionResult {
    return {
        uploadSessionId: session.id,
        fileId: session.fileId,
        purpose: 'attachment',
        uploadMode: 'single',
        status: 'PENDING',
        expiresAt: upload.expiresAt < session.expiresAt ? upload.expiresAt : session.expiresAt,
        upload: { method: upload.method, url: upload.url, headers: upload.headers },
    };
}

function toFileMetadataResult(file: {
    id: string;
    purpose: FilePurpose;
    originalName: string;
    mimeType: string;
    sizeBytes: bigint;
    etag: string | null;
    createdAt: Date;
}): FileMetadataResult {
    return {
        id: file.id,
        purpose: 'attachment',
        fileName: file.originalName,
        contentType: file.mimeType,
        sizeBytes: Number(file.sizeBytes),
        etag: file.etag,
        createdAt: file.createdAt,
    };
}

function isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
