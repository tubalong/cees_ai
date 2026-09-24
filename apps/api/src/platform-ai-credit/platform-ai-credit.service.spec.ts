import {
    AICreditCapabilityKind,
    AICreditConfigStatus,
    AICreditMeterType,
    Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PlatformAuthenticatedPrincipal } from '../platform-auth/platform-auth.types';
import { AICreditCapabilityService } from './platform-ai-credit.service';

describe('AICreditCapabilityService', () => {
    it('lists active capabilities ordered by sortOrder and code', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditCapability.findMany.mockResolvedValue([capabilityRecord({ code: 'chat', sortOrder: 1 })]);

        const service = new AICreditCapabilityService(prisma as unknown as PrismaService);
        const result = await service.listCapabilities();

        expect(prisma.aICreditCapability.findMany).toHaveBeenCalledWith({
            where: { deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].code).toBe('chat');
    });

    it('rejects getCapability for a missing capability', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditCapability.findFirst.mockResolvedValue(null);

        const service = new AICreditCapabilityService(prisma as unknown as PrismaService);
        await expect(service.getCapability(CAPABILITY_ID)).rejects.toMatchObject({
            response: { code: 'AI_CREDIT_CAPABILITY_NOT_FOUND' },
        });
    });

    it('creates a capability with trimmed fields and default values', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditCapability.findFirst.mockResolvedValue(null);
        prisma.aICreditCapability.create.mockImplementation(
            async ({ data }: { data: Record<string, unknown> }) => capabilityRecord({ code: data.code as string }),
        );

        const service = new AICreditCapabilityService(prisma as unknown as PrismaService);
        const result = await service.createCapability(
            {
                code: ' chat-2 ',
                name: ' AI 对话 ',
                description: ' 说明 ',
                meterType: AICreditMeterType.TOKEN,
                capabilityKind: AICreditCapabilityKind.UNIVERSAL,
                permissionCode: undefined,
                sortOrder: 0,
            },
            principal(),
            { requestId: 'request-id' },
        );

        expect(result.code).toBe('chat-2');
        expect(result.name).toBe('AI 对话');
        expect(prisma.aICreditCapability.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                code: 'chat-2',
                name: 'AI 对话',
                description: '说明',
                capabilityKind: AICreditCapabilityKind.UNIVERSAL,
                createdBy: principal().id,
            }),
        });
        expect(prisma.platformAuditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'AI_CREDIT_CAPABILITY_CREATED' }),
        });
    });

    it('rejects duplicate capability code on create', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditCapability.findFirst.mockResolvedValue(capabilityRecord({}));

        const service = new AICreditCapabilityService(prisma as unknown as PrismaService);
        await expect(service.createCapability(
            {
                code: 'chat',
                name: 'AI 对话',
                meterType: AICreditMeterType.TOKEN,
                capabilityKind: AICreditCapabilityKind.UNIVERSAL,
                sortOrder: 0,
            },
            principal(),
            { requestId: 'request-id' },
        )).rejects.toMatchObject({ response: { code: 'AI_CREDIT_CAPABILITY_CODE_CONFLICT' } });
    });

    it('maps the partial unique index race (P2002) to a code conflict', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditCapability.findFirst.mockResolvedValue(null);
        prisma.aICreditCapability.create.mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('unique constraint', { code: 'P2002', clientVersion: 'test' }),
        );

        const service = new AICreditCapabilityService(prisma as unknown as PrismaService);
        await expect(service.createCapability(
            {
                code: 'chat',
                name: 'AI 对话',
                meterType: AICreditMeterType.TOKEN,
                capabilityKind: AICreditCapabilityKind.UNIVERSAL,
                sortOrder: 0,
            },
            principal(),
            { requestId: 'request-id' },
        )).rejects.toMatchObject({ response: { code: 'AI_CREDIT_CAPABILITY_CODE_CONFLICT' } });
    });

    it('updates a capability with optimistic locking and writes an audit event', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditCapability.findFirst.mockResolvedValue(capabilityRecord({}));
        prisma.aICreditCapability.updateMany.mockResolvedValue({ count: 1 });

        const service = new AICreditCapabilityService(prisma as unknown as PrismaService);
        await service.updateCapability(
            CAPABILITY_ID,
            { name: ' 新名称 ', status: AICreditConfigStatus.INACTIVE, version: 3 },
            principal(),
            { requestId: 'request-id' },
        );

        expect(prisma.aICreditCapability.updateMany).toHaveBeenCalledWith({
            where: { id: CAPABILITY_ID, version: 3, deletedAt: null },
            data: expect.objectContaining({ name: '新名称', status: AICreditConfigStatus.INACTIVE, version: { increment: 1 } }),
        });
        expect(prisma.platformAuditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'AI_CREDIT_CAPABILITY_UPDATED' }),
        });
    });

    it('rejects update when the version is stale', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditCapability.findFirst.mockResolvedValue(capabilityRecord({}));
        prisma.aICreditCapability.updateMany.mockResolvedValue({ count: 0 });

        const service = new AICreditCapabilityService(prisma as unknown as PrismaService);
        await expect(service.updateCapability(
            CAPABILITY_ID,
            { name: '新名称', version: 2 },
            principal(),
            { requestId: 'request-id' },
        )).rejects.toMatchObject({ response: { code: 'RESOURCE_VERSION_CONFLICT' } });
    });

    it('rejects deleting a capability referenced by an active tier', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditCapability.findFirst.mockResolvedValue(capabilityRecord({}));
        prisma.aICreditTierCapability.count.mockResolvedValue(1);

        const service = new AICreditCapabilityService(prisma as unknown as PrismaService);
        await expect(service.deleteCapability(CAPABILITY_ID, principal(), { requestId: 'request-id' }))
            .rejects.toMatchObject({ response: { code: 'AI_CREDIT_CAPABILITY_REFERENCED' } });
    });

    it('rejects deleting a capability referenced by a rate card', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditCapability.findFirst.mockResolvedValue(capabilityRecord({}));
        prisma.aICreditTierCapability.count.mockResolvedValue(0);
        prisma.aICreditRateCard.count.mockResolvedValue(1);

        const service = new AICreditCapabilityService(prisma as unknown as PrismaService);
        await expect(service.deleteCapability(CAPABILITY_ID, principal(), { requestId: 'request-id' }))
            .rejects.toMatchObject({ response: { code: 'AI_CREDIT_CAPABILITY_REFERENCED' } });
    });

    it('soft deletes a capability and writes an audit event', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditCapability.findFirst.mockResolvedValue(capabilityRecord({}));
        prisma.aICreditTierCapability.count.mockResolvedValue(0);
        prisma.aICreditRateCard.count.mockResolvedValue(0);
        prisma.aICreditCapability.updateMany.mockResolvedValue({ count: 1 });

        const service = new AICreditCapabilityService(prisma as unknown as PrismaService);
        await service.deleteCapability(CAPABILITY_ID, principal(), { requestId: 'request-id' });

        expect(prisma.aICreditCapability.updateMany).toHaveBeenCalledWith({
            where: { id: CAPABILITY_ID, deletedAt: null },
            data: expect.objectContaining({ deletedAt: expect.any(Date), version: { increment: 1 } }),
        });
        expect(prisma.platformAuditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'AI_CREDIT_CAPABILITY_DELETED' }),
        });
    });
});

const CAPABILITY_ID = 'a0000000-0000-0000-0000-000000000001';

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        aICreditCapability: {
            findMany: jest.fn(),
            findFirst: jest.fn(),
            create: jest.fn(),
            updateMany: jest.fn(),
        },
        aICreditTierCapability: { count: jest.fn() },
        aICreditRateCard: { count: jest.fn() },
        platformAuditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function capabilityRecord(overrides: { code?: string; sortOrder?: number }): Record<string, unknown> {
    return {
        id: CAPABILITY_ID,
        code: overrides.code ?? 'chat',
        name: 'AI 对话',
        description: null,
        meterType: AICreditMeterType.TOKEN,
        capabilityKind: AICreditCapabilityKind.UNIVERSAL,
        permissionCode: null,
        sortOrder: overrides.sortOrder ?? 0,
        status: AICreditConfigStatus.ACTIVE,
        version: 1,
        createdAt: new Date('2026-09-23T00:00:00.000Z'),
        updatedAt: new Date('2026-09-23T00:00:00.000Z'),
        deletedAt: null,
    };
}

function principal(): PlatformAuthenticatedPrincipal {
    return {
        id: '60000000-0000-0000-0000-000000000001',
        platformAdministratorId: '70000000-0000-0000-0000-000000000001',
        sessionId: '80000000-0000-0000-0000-000000000001',
        account: 'superadmin',
        displayName: 'Platform Administrator',
        role: 'SUPER_ADMIN',
        permissions: ['platform.aiCredit.write'],
    };
}
