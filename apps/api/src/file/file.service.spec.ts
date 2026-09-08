import { ConflictException } from '@nestjs/common';
import { FilePurpose, UploadSessionStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CosObjectKeyFactory } from '../storage/cos-object-key.factory';
import type { StorageProvider, StorageSettings } from '../storage/storage.types';
import { TenantContext } from '../tenant/tenant-context';
import { FileService } from './file.service';

const context = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    membershipId: '33333333-3333-4333-8333-333333333333',
    requestId: 'request-1',
    roles: [],
    permissions: [],
};

describe('FileService', () => {
    beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-09-08T02:03:04.000Z')));
    afterEach(() => jest.useRealTimers());

    it('creates a tenant-scoped upload session using the documented COS path', async () => {
        const transaction = {
            uploadSession: {
                create: jest.fn().mockImplementation(({ data }) => ({ ...data, id: data.id })),
            },
            auditLog: { create: jest.fn().mockResolvedValue({}) },
        };
        const prisma = createPrisma({
            uploadSession: { findUnique: jest.fn().mockResolvedValue(null) },
            $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
        });
        const storage = createStorage({
            createUploadUrl: jest.fn().mockResolvedValue({
                method: 'PUT',
                url: 'https://signed.example/upload',
                headers: { 'Content-Type': 'application/pdf' },
                expiresAt: new Date('2026-09-08T02:13:04.000Z'),
            }),
        });
        const service = createService(prisma, storage);

        const result = await service.createUploadSession('desktop-request-1', {
            purpose: 'attachment',
            fileName: ' 项目方案.pdf ',
            contentType: 'Application/PDF',
            sizeBytes: 42,
        });

        const data = transaction.uploadSession.create.mock.calls[0][0].data;
        expect(data.objectKey).toBe(
            `cees/staging/tenants/${context.tenantId}/files/2026/09/${data.fileId}/source`,
        );
        expect(data.originalName).toBe('项目方案.pdf');
        expect(data.mimeType).toBe('application/pdf');
        expect(result).toEqual(expect.objectContaining({
            uploadSessionId: data.id,
            fileId: data.fileId,
            uploadMode: 'single',
            status: 'PENDING',
        }));
        expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ action: 'FILE_UPLOAD_SESSION_CREATED', resourceId: data.fileId }),
        }));
    });

    it('completes a session only after trusted COS metadata matches', async () => {
        const session = uploadSession();
        const file = {
            id: session.fileId,
            purpose: FilePurpose.ATTACHMENT,
            originalName: session.originalName,
            mimeType: session.mimeType,
            sizeBytes: session.expectedSizeBytes,
            etag: '"etag"',
            createdAt: new Date('2026-09-08T02:03:04.000Z'),
        };
        const transaction = {
            uploadSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            fileObject: { create: jest.fn().mockResolvedValue(file) },
            auditLog: { create: jest.fn().mockResolvedValue({}) },
        };
        const prisma = createPrisma({
            uploadSession: { findFirst: jest.fn().mockResolvedValue(session) },
            $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
        });
        const storage = createStorage({
            headObject: jest.fn().mockResolvedValue({
                sizeBytes: 42,
                contentType: 'application/pdf',
                etag: '"etag"',
            }),
        });

        await expect(createService(prisma, storage).completeUploadSession(session.id)).resolves.toEqual({
            id: session.fileId,
            purpose: 'attachment',
            fileName: '项目方案.pdf',
            contentType: 'application/pdf',
            sizeBytes: 42,
            etag: '"etag"',
            createdAt: new Date('2026-09-08T02:03:04.000Z'),
        });
        expect(storage.headObject).toHaveBeenCalledWith(session.objectKey);
        expect(transaction.fileObject.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ id: session.fileId, objectKey: session.objectKey }),
        }));
    });

    it('deletes and rejects an uploaded object when metadata does not match', async () => {
        const session = uploadSession();
        const transaction = {
            uploadSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            auditLog: { create: jest.fn().mockResolvedValue({}) },
        };
        const prisma = createPrisma({
            uploadSession: { findFirst: jest.fn().mockResolvedValue(session) },
            $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
        });
        const storage = createStorage({
            headObject: jest.fn().mockResolvedValue({ sizeBytes: 99, contentType: 'application/pdf', etag: null }),
            deleteObject: jest.fn().mockResolvedValue(undefined),
        });

        await expect(createService(prisma, storage).completeUploadSession(session.id)).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'UPLOAD_OBJECT_METADATA_MISMATCH' }),
        });
        expect(storage.deleteObject).toHaveBeenCalledWith(session.objectKey);
        expect(transaction.uploadSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: UploadSessionStatus.FAILED }),
        }));
    });

    it('rejects reuse of an idempotency key for different file metadata', async () => {
        const session = uploadSession({ requestFingerprint: 'different' });
        const prisma = createPrisma({ uploadSession: { findUnique: jest.fn().mockResolvedValue(session) } });

        await expect(createService(prisma, createStorage()).createUploadSession('desktop-request-1', {
            purpose: 'attachment',
            fileName: '项目方案.pdf',
            contentType: 'application/pdf',
            sizeBytes: 42,
        })).rejects.toBeInstanceOf(ConflictException);
    });
});

function createService(prisma: PrismaService, storage: StorageProvider): FileService {
    const config = storageConfig();
    return new FileService(
        prisma,
        { require: () => context } as unknown as TenantContext,
        storage,
        config,
        new CosObjectKeyFactory(config),
    );
}

function createPrisma(overrides: Record<string, unknown>): PrismaService {
    return { ...overrides } as unknown as PrismaService;
}

function createStorage(overrides: Partial<StorageProvider> = {}): StorageProvider {
    return {
        createUploadUrl: jest.fn(),
        headObject: jest.fn(),
        createDownloadUrl: jest.fn(),
        deleteObject: jest.fn(),
        ...overrides,
    };
}

function storageConfig(): StorageSettings {
    return {
        provider: 'TENCENT_COS',
        region: 'ap-chengdu',
        bucket: 'cees-ai-1403013862',
        objectPrefix: 'cees/staging',
        signedUrlTtlSeconds: 600,
        maxUploadBytes: 104_857_600,
    };
}

function uploadSession(overrides: Record<string, unknown> = {}) {
    return {
        id: '44444444-4444-4444-8444-444444444444',
        tenantId: context.tenantId,
        fileId: '55555555-5555-4555-8555-555555555555',
        createdBy: context.userId,
        createdByMembershipId: context.membershipId,
        idempotencyKey: 'desktop-request-1',
        requestFingerprint: 'fingerprint',
        purpose: FilePurpose.ATTACHMENT,
        originalName: '项目方案.pdf',
        mimeType: 'application/pdf',
        expectedSizeBytes: 42n,
        storageProvider: 'TENCENT_COS',
        bucket: 'cees-ai-1403013862',
        region: 'ap-chengdu',
        objectKey: `cees/staging/tenants/${context.tenantId}/files/2026/09/55555555-5555-4555-8555-555555555555/source`,
        status: UploadSessionStatus.PENDING,
        expiresAt: new Date('2026-09-08T02:13:04.000Z'),
        completedAt: null,
        failureCode: null,
        createdAt: new Date('2026-09-08T02:03:04.000Z'),
        updatedAt: new Date('2026-09-08T02:03:04.000Z'),
        ...overrides,
    };
}
