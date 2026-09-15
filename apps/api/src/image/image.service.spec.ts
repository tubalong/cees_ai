import { AuditOutcome, DraftStatus, FilePurpose, ManagedImageStatus, ResourceType, ToolCallStatus } from '@prisma/client';
import { ImageService, type GenerateImageCommand } from './image.service';
import type { PrismaService } from '../database/prisma.service';
import type { AiServiceGateway } from '../ai-orchestration/ai-service-gateway.service';
import type { StorageProvider, StorageSettings } from '../storage/storage.types';
import type { CosObjectKeyFactory } from '../storage/cos-object-key.factory';
import type { TenantContext } from '../tenant/tenant-context';

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const TOOL_CALL_ID = '60000000-0000-0000-0000-000000000001';
const OBJECT_KEY = `cees/local/tenants/${TENANT_ID}/generated-images/${TOOL_CALL_ID}/source`;

function createHarness() {
    const prisma: Record<string, any> = {
        managedImage: {
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findMany: jest.fn().mockResolvedValue([]),
        },
        toolCall: {
            findFirst: jest.fn().mockResolvedValue({ id: TOOL_CALL_ID }),
        },
        resource: {
            create: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        fileObject: { upsert: jest.fn().mockResolvedValue({}) },
        aIActionDraft: {
            create: jest.fn().mockResolvedValue({}),
            upsert: jest.fn().mockResolvedValue({}),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: unknown) => unknown) => callback(prisma));

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
        putObject: jest.fn().mockResolvedValue({ sizeBytes: 16, etag: 'etag-1' }),
        createDownloadUrl: jest.fn().mockResolvedValue('https://cos.example/signed'),
        deleteObject: jest.fn().mockResolvedValue(undefined),
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
        buildGeneratedImageKey: jest.fn().mockReturnValue(OBJECT_KEY),
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
    return { service, prisma, gateway, storage, objectKeys };
}

function command(overrides: Partial<GenerateImageCommand> = {}): GenerateImageCommand {
    return {
        tenantId: TENANT_ID,
        userId: USER_ID,
        membershipId: MEMBERSHIP_ID,
        requestId: 'request-1',
        conversationId: '60000000-0000-0000-0000-000000000001',
        turnId: '70000000-0000-0000-0000-000000000001',
        toolCallId: TOOL_CALL_ID,
        executionOwner: 'api:test',
        executionToken: '80000000-0000-0000-0000-000000000001',
        prompt: '一只猫',
        size: 'auto',
        ...overrides,
    };
}

describe('ImageService', () => {
    it('claims the tool call, generates, uploads and finalizes the formal image resource', async () => {
        const harness = createHarness();

        const result = await harness.service.generateImage(command());

        expect(harness.prisma.toolCall.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                id: TOOL_CALL_ID,
                status: ToolCallStatus.EXECUTING,
                executionToken: '80000000-0000-0000-0000-000000000001',
            }),
        }));
        expect(harness.objectKeys.buildGeneratedImageKey).toHaveBeenCalledWith({
            tenantId: TENANT_ID,
            toolCallId: TOOL_CALL_ID,
        });
        expect(harness.gateway.generateImage).toHaveBeenCalledWith(
            expect.objectContaining({
                request_id: 'request-1',
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                prompt: '一只猫',
                size: 'auto',
            }),
            {
                membershipId: MEMBERSHIP_ID,
                conversationId: command().conversationId,
                turnId: command().turnId,
                toolCallId: TOOL_CALL_ID,
            },
        );
        expect(harness.storage.putObject).toHaveBeenCalledWith({
            objectKey: OBJECT_KEY,
            body: Buffer.from('fake-image-bytes'),
            contentType: 'image/png',
        });
        expect(harness.prisma.resource.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ tenantId: TENANT_ID, type: ResourceType.IMAGE }),
        });
        expect(harness.prisma.managedImage.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: TENANT_ID,
                toolCallId: TOOL_CALL_ID,
                status: ManagedImageStatus.PENDING,
                objectKey: OBJECT_KEY,
            }),
        });
        expect(harness.prisma.fileObject.upsert).toHaveBeenCalledWith({
            where: { id: expect.any(String) },
            create: expect.objectContaining({
                purpose: FilePurpose.GENERATED_IMAGE,
                bucket: 'bucket-1',
                region: 'ap-guangzhou',
                objectKey: OBJECT_KEY,
                sizeBytes: BigInt(16),
            }),
            update: expect.any(Object),
        });
        expect(harness.prisma.aIActionDraft.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                actionType: 'ai.image.generate',
                status: DraftStatus.DRAFT,
                toolCallId: TOOL_CALL_ID,
            }),
        });
        expect(harness.prisma.aIActionDraft.upsert).toHaveBeenCalledWith({
            where: { toolCallId: TOOL_CALL_ID },
            update: expect.objectContaining({ status: DraftStatus.EXECUTED, executedResourceType: 'IMAGE' }),
            create: expect.objectContaining({ status: DraftStatus.EXECUTED }),
        });
        expect(harness.prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'IMAGE_GENERATED', outcome: AuditOutcome.SUCCESS }),
        });
        expect(harness.storage.createDownloadUrl).toHaveBeenCalledWith(OBJECT_KEY);
        expect(harness.prisma.managedImage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ status: ManagedImageStatus.UPLOADING }),
            data: expect.objectContaining({ status: ManagedImageStatus.READY }),
        }));
        expect(result).toEqual({
            imageId: expect.any(String),
            contentType: 'image/png',
            sizeBytes: 16,
            provider: 'openai_compatible',
            model: 'image-model',
            url: 'https://cos.example/signed',
            urlTtlSeconds: 900,
        });
    });

    it('does not upload when the execution claim is lost while the provider is running', async () => {
        const harness = createHarness();
        harness.prisma.toolCall.findFirst
            .mockResolvedValueOnce({ id: TOOL_CALL_ID })
            .mockResolvedValueOnce({ id: TOOL_CALL_ID })
            .mockResolvedValueOnce(null);

        await expect(harness.service.generateImage(command())).rejects.toThrow('工具执行权已失效');

        expect(harness.gateway.generateImage).toHaveBeenCalledTimes(1);
        expect(harness.storage.putObject).not.toHaveBeenCalled();
        expect(harness.prisma.resource.updateMany).toHaveBeenCalled();
    });

    it('does not hide a READY resource when a concurrent failure observes no mutable image row', async () => {
        const harness = createHarness();
        harness.prisma.managedImage.updateMany.mockResolvedValueOnce({ count: 0 });

        await expect((harness.service as any).markImageFailure(
            command(),
            '90000000-0000-0000-0000-000000000001',
            new Error('late provider error'),
            false,
        )).resolves.toBeUndefined();

        expect(harness.prisma.resource.updateMany).not.toHaveBeenCalled();
        expect(harness.prisma.aIActionDraft.upsert).not.toHaveBeenCalled();
        expect(harness.prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('replays a READY image for the same tool call without invoking the provider again', async () => {
        const harness = createHarness();
        harness.prisma.managedImage.findFirst.mockResolvedValue({
            id: '90000000-0000-0000-0000-000000000001',
            tenantId: TENANT_ID,
            status: ManagedImageStatus.READY,
            contentType: 'image/png',
            provider: 'openai_compatible',
            model: 'image-model',
            fileObject: { sizeBytes: BigInt(2048), objectKey: OBJECT_KEY },
            resource: { deletedAt: null },
        });

        const result = await harness.service.generateImage(command());

        expect(result).toEqual({
            imageId: '90000000-0000-0000-0000-000000000001',
            contentType: 'image/png',
            sizeBytes: 2048,
            provider: 'openai_compatible',
            model: 'image-model',
            url: 'https://cos.example/signed',
            urlTtlSeconds: 900,
        });
        expect(harness.gateway.generateImage).not.toHaveBeenCalled();
        expect(harness.storage.putObject).not.toHaveBeenCalled();
        // 回放时重新签发短期 URL，让调用者拿到的是新鲜签名。
        expect(harness.storage.createDownloadUrl).toHaveBeenCalledWith(OBJECT_KEY);
        expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    });

    describe('getImageAccess', () => {
        it('returns metadata with a fresh signed URL only at read time', async () => {
            const harness = createHarness();
            const createdAt = new Date('2026-09-11T00:00:00Z');
            harness.prisma.managedImage.findFirst.mockResolvedValue({
                id: '90000000-0000-0000-0000-000000000001',
                createdAt,
                prompt: '一只猫',
                model: 'image-model',
                contentType: 'image/png',
                status: ManagedImageStatus.READY,
                resource: { id: 'resource-1', ownerMembershipId: MEMBERSHIP_ID, deletedAt: null },
                fileObject: { objectKey: OBJECT_KEY, sizeBytes: BigInt(2048) },
            });

            const result = await harness.service.getImageAccess('90000000-0000-0000-0000-000000000001');

            expect(harness.storage.createDownloadUrl).toHaveBeenCalledWith(OBJECT_KEY);
            expect(result).toEqual({
                id: '90000000-0000-0000-0000-000000000001',
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
                id: '90000000-0000-0000-0000-000000000001',
                status: ManagedImageStatus.READY,
                contentType: 'image/png',
                resource: { id: 'resource-1', ownerMembershipId: '50000000-0000-0000-0000-000000000099', deletedAt: null },
                fileObject: { objectKey: OBJECT_KEY, sizeBytes: BigInt(2048) },
            });

            await expect(harness.service.getImageAccess('90000000-0000-0000-0000-000000000001'))
                .rejects.toMatchObject({ response: { code: 'IMAGE_ACCESS_DENIED' } });
            expect(harness.storage.createDownloadUrl).not.toHaveBeenCalled();
        });

        it('returns 404 for a missing or non-ready image', async () => {
            const harness = createHarness();

            await expect(harness.service.getImageAccess('90000000-0000-0000-0000-000000000001'))
                .rejects.toMatchObject({ response: { code: 'IMAGE_NOT_FOUND' } });
        });
    });
});
