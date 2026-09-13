import { AuditOutcome, DraftStatus, FilePurpose, ResourceType } from '@prisma/client';
import { ImageService } from './image.service';
import type { PrismaService } from '../database/prisma.service';
import type { AiServiceGateway } from '../ai-orchestration/ai-service-gateway.service';
import type { StorageProvider, StorageSettings } from '../storage/storage.types';
import type { CosObjectKeyFactory } from '../storage/cos-object-key.factory';
import type { TenantContext } from '../tenant/tenant-context';

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const OBJECT_KEY = 'cees/local/source/10000000-0000-0000-0000-000000000001/file-1';

interface TransactionMock {
    fileObject: { create: jest.Mock };
    resource: { create: jest.Mock };
    managedImage: { create: jest.Mock };
    aIActionDraft: { create: jest.Mock };
    auditLog: { create: jest.Mock };
}

function createHarness(overrides: {
    executedDraft?: { executedResourceId: string } | null;
} = {}) {
    let transaction: TransactionMock | undefined;
    const prisma = {
        aIActionDraft: {
            findFirst: jest.fn().mockResolvedValue(overrides.executedDraft ?? null),
        },
        managedImage: {
            findFirst: jest.fn().mockResolvedValue(null),
        },
        fileObject: {
            findUnique: jest.fn().mockResolvedValue(null),
        },
        $transaction: jest.fn(async (arg: unknown) => {
            transaction = {
                fileObject: { create: jest.fn().mockResolvedValue({}) },
                resource: { create: jest.fn().mockResolvedValue({}) },
                managedImage: { create: jest.fn().mockResolvedValue({}) },
                aIActionDraft: { create: jest.fn().mockResolvedValue({}) },
                auditLog: { create: jest.fn().mockResolvedValue({}) },
            };
            return (arg as (tx: unknown) => unknown)(transaction);
        }),
    };
    const gateway = {
        generateImage: jest.fn().mockResolvedValue({
            request_id: 'request-1',
            content_type: 'image/png',
            data_base64: Buffer.from('fake-image-bytes').toString('base64'),
            execution: {
                profile: 'image',
                provider: 'openai_compatible',
                model: 'image-model',
                fallback_count: 0,
                latency_ms: 800,
                token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
            },
        }),
    };
    const storage = {
        putObject: jest.fn().mockResolvedValue({ sizeBytes: 16, contentType: 'image/png', etag: 'etag-1' }),
        createDownloadUrl: jest.fn().mockResolvedValue('https://cos.example/signed'),
    };
    const storageSettings: StorageSettings = {
        provider: 'TENCENT_COS',
        region: 'ap-guangzhou',
        bucket: 'bucket-1',
        objectPrefix: 'cees/local',
        signedUrlTtlSeconds: 900,
        maxUploadBytes: 10485760,
    };
    const objectKeys = {
        buildSourceKey: jest.fn().mockReturnValue(OBJECT_KEY),
    };
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            permissions: ['image.read'],
        }),
    };
    const service = new ImageService(
        prisma as unknown as PrismaService,
        gateway as unknown as AiServiceGateway,
        tenantContext as unknown as TenantContext,
        storage as unknown as StorageProvider,
        storageSettings,
        objectKeys as unknown as CosObjectKeyFactory,
    );
    return { service, prisma, gateway, storage, objectKeys, getTransaction: () => transaction! };
}

function command(overrides: Partial<Parameters<ImageService['generateImage']>[0]> = {}) {
    return {
        tenantId: TENANT_ID,
        userId: USER_ID,
        membershipId: MEMBERSHIP_ID,
        requestId: 'request-1',
        turnId: 'turn-1',
        toolCallId: 'tc-1',
        prompt: '一只猫',
        size: 'auto' as const,
        ...overrides,
    };
}

describe('ImageService', () => {
    it('generates upstream, uploads to COS and persists file/resource/image/draft/audit in one transaction', async () => {
        const harness = createHarness();

        const result = await harness.service.generateImage(command());

        expect(harness.gateway.generateImage).toHaveBeenCalledWith(
            expect.objectContaining({
                request_id: 'request-1',
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                prompt: '一只猫',
                size: 'auto',
            }),
            { membershipId: MEMBERSHIP_ID, turnId: 'turn-1', toolCallId: 'tc-1' },
        );
        expect(harness.objectKeys.buildSourceKey).toHaveBeenCalledWith({
            tenantId: TENANT_ID,
            fileId: expect.any(String),
        });
        expect(harness.storage.putObject).toHaveBeenCalledWith({
            objectKey: OBJECT_KEY,
            body: Buffer.from('fake-image-bytes'),
            contentType: 'image/png',
        });

        const tx = harness.getTransaction();
        expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(tx.fileObject.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: TENANT_ID,
                originalName: expect.stringMatching(/^generated-.*\.png$/),
                purpose: FilePurpose.GENERATED_IMAGE,
                bucket: 'bucket-1',
                region: 'ap-guangzhou',
                objectKey: OBJECT_KEY,
                mimeType: 'image/png',
                sizeBytes: BigInt(16),
                etag: 'etag-1',
                createdBy: USER_ID,
            }),
        });
        expect(tx.resource.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: TENANT_ID,
                type: ResourceType.IMAGE,
                ownerMembershipId: MEMBERSHIP_ID,
            }),
        });
        expect(tx.managedImage.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: TENANT_ID,
                provider: 'openai_compatible',
                model: 'image-model',
                prompt: '一只猫',
                contentType: 'image/png',
            }),
        });
        expect(tx.aIActionDraft.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: TENANT_ID,
                userId: USER_ID,
                actionType: 'ai.image.generate',
                status: DraftStatus.EXECUTED,
                toolCallId: 'tc-1',
                executedResourceType: 'IMAGE',
                executedResourceId: expect.any(String),
            }),
        });
        expect(tx.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: TENANT_ID,
                actorUserId: USER_ID,
                actorMembershipId: MEMBERSHIP_ID,
                action: 'IMAGE_GENERATED',
                outcome: AuditOutcome.SUCCESS,
                resourceType: 'IMAGE',
                resourceId: expect.any(String),
                requestId: 'request-1',
            }),
        });

        expect(harness.storage.createDownloadUrl).toHaveBeenCalledWith(OBJECT_KEY);
        expect(result).toEqual({
            imageId: expect.any(String),
            contentType: 'image/png',
            sizeBytes: 16,
            provider: 'openai_compatible',
            model: 'image-model',
            url: 'https://cos.example/signed',
        });
    });

    it('replays an already executed tool call idempotently without regenerating', async () => {
        const harness = createHarness({
            executedDraft: { executedResourceId: 'image-1' },
        });
        harness.prisma.managedImage.findFirst.mockResolvedValue({
            id: 'image-1',
            contentType: 'image/png',
            fileObjectId: 'file-1',
            provider: 'openai_compatible',
            model: 'image-model',
        });
        harness.prisma.fileObject.findUnique.mockResolvedValue({
            objectKey: OBJECT_KEY,
            sizeBytes: BigInt(2048),
        });

        const result = await harness.service.generateImage(command());

        expect(result).toEqual({
            imageId: 'image-1',
            contentType: 'image/png',
            sizeBytes: 2048,
            provider: 'openai_compatible',
            model: 'image-model',
            url: 'https://cos.example/signed',
        });
        expect(harness.storage.createDownloadUrl).toHaveBeenCalledWith(OBJECT_KEY);
        expect(harness.gateway.generateImage).not.toHaveBeenCalled();
        expect(harness.storage.putObject).not.toHaveBeenCalled();
        expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    });

    describe('getImageAccess', () => {
        it('returns metadata and a fresh signed URL for the owning member', async () => {
            const harness = createHarness();
            const createdAt = new Date('2026-09-11T00:00:00Z');
            harness.prisma.managedImage.findFirst.mockResolvedValue({
                id: 'image-1',
                createdAt,
                prompt: '一只猫',
                model: 'image-model',
                contentType: 'image/png',
                fileObjectId: 'file-1',
                resource: { id: 'resource-1', ownerMembershipId: MEMBERSHIP_ID, deletedAt: null },
            });
            harness.prisma.fileObject.findUnique.mockResolvedValue({
                objectKey: OBJECT_KEY,
                sizeBytes: BigInt(2048),
            });

            const result = await harness.service.getImageAccess('image-1');

            expect(harness.prisma.managedImage.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT_ID, id: 'image-1' }) }),
            );
            expect(harness.storage.createDownloadUrl).toHaveBeenCalledWith(OBJECT_KEY);
            expect(result).toEqual({
                id: 'image-1',
                resourceId: 'resource-1',
                mimeType: 'image/png',
                sizeBytes: 2048,
                url: 'https://cos.example/signed',
                prompt: '一只猫',
                model: 'image-model',
                createdAt,
            });
        });

        it('denies access for a member who is not the resource owner', async () => {
            const harness = createHarness();
            harness.prisma.managedImage.findFirst.mockResolvedValue({
                id: 'image-1',
                createdAt: new Date(),
                prompt: null,
                model: null,
                contentType: 'image/png',
                fileObjectId: 'file-1',
                resource: { id: 'resource-1', ownerMembershipId: '50000000-0000-0000-0000-000000000099', deletedAt: null },
            });

            await expect(harness.service.getImageAccess('image-1')).rejects.toMatchObject({
                response: { code: 'IMAGE_ACCESS_DENIED' },
            });
            expect(harness.storage.createDownloadUrl).not.toHaveBeenCalled();
        });

        it('returns 404 for a missing image', async () => {
            const harness = createHarness();
            harness.prisma.managedImage.findFirst.mockResolvedValue(null);

            await expect(harness.service.getImageAccess('image-404')).rejects.toMatchObject({
                response: { code: 'IMAGE_NOT_FOUND' },
            });
        });
    });
});
