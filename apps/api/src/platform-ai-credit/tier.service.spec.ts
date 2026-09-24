import {
    AICreditCapabilityKind,
    AICreditConfigStatus,
    AICreditSubscriptionDuration,
    Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PlatformAuthenticatedPrincipal } from '../platform-auth/platform-auth.types';
import { AICreditTierService } from './tier.service';

describe('AICreditTierService', () => {
    it('lists tiers with prices and capability codes', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditTier.findMany.mockResolvedValue([tierRecord({})]);

        const service = new AICreditTierService(prisma as unknown as PrismaService);
        const result = await service.listTiers();

        expect(prisma.aICreditTier.findMany).toHaveBeenCalledWith({
            where: { deletedAt: null },
            include: expect.objectContaining({ prices: expect.anything(), capabilities: expect.anything() }),
            orderBy: [{ createdAt: 'asc' }, { code: 'asc' }],
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].capabilityCodes).toEqual(['chat', 'rag']);
        expect(result.items[0].prices).toEqual([
            { duration: AICreditSubscriptionDuration.ONE_MONTH, tierPrice: '100.00', unitPrice: '10.00' },
        ]);
    });

    it('rejects getTier for a missing tier', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditTier.findFirst.mockResolvedValue(null);

        const service = new AICreditTierService(prisma as unknown as PrismaService);
        await expect(service.getTier(TIER_ID)).rejects.toMatchObject({
            response: { code: 'AI_CREDIT_TIER_NOT_FOUND' },
        });
    });

    it('creates a tier with prices and tier-gated capabilities and writes an audit event', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditTier.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(tierRecord({ code: 'TIER_PRO' }));
        prisma.aICreditCapability.findMany.mockResolvedValue([
            { id: 'c0000000-0000-0000-0000-000000000001', code: 'chat', capabilityKind: AICreditCapabilityKind.TIER_GATED },
        ]);
        prisma.aICreditTier.create.mockImplementation(
            async ({ data }: { data: Record<string, unknown> }) => tierRecord({ code: data.code as string }),
        );

        const service = new AICreditTierService(prisma as unknown as PrismaService);
        const result = await service.createTier(
            {
                code: ' TIER_PRO ',
                name: ' 专业版 ',
                description: ' 说明 ',
                monthlyBaseCredits: '20000.00',
                prices: [
                    { duration: AICreditSubscriptionDuration.ONE_MONTH, tierPrice: '200.00', unitPrice: '20.00' },
                ],
                capabilityCodes: ['chat'],
            },
            principal(),
            { requestId: 'request-id' },
        );

        expect(result.code).toBe('TIER_PRO');
        expect(result.name).toBe('专业版');
        expect(prisma.aICreditTier.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                code: 'TIER_PRO',
                name: '专业版',
                description: '说明',
                monthlyBaseCredits: '20000.00',
                createdBy: principal().id,
            }),
        });
        expect(prisma.aICreditTierPrice.createMany).toHaveBeenCalledWith({
            data: [expect.objectContaining({ tierId: TIER_ID, duration: AICreditSubscriptionDuration.ONE_MONTH })],
        });
        expect(prisma.aICreditTierCapability.createMany).toHaveBeenCalledWith({
            data: [{ tierId: TIER_ID, capabilityId: 'c0000000-0000-0000-0000-000000000001' }],
        });
        expect(prisma.platformAuditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'AI_CREDIT_TIER_CREATED' }),
        });
    });

    it('rejects duplicate tier code on create', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditTier.findFirst.mockResolvedValue(tierRecord({}));

        const service = new AICreditTierService(prisma as unknown as PrismaService);
        await expect(service.createTier(
            {
                code: 'TIER_PRO',
                name: '专业版',
                monthlyBaseCredits: '20000.00',
                prices: [
                    { duration: AICreditSubscriptionDuration.ONE_MONTH, tierPrice: '200.00', unitPrice: '20.00' },
                ],
            },
            principal(),
            { requestId: 'request-id' },
        )).rejects.toMatchObject({ response: { code: 'AI_CREDIT_TIER_CODE_CONFLICT' } });
    });

    it('rejects duplicate durations in prices', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditTier.findFirst.mockResolvedValue(null);

        const service = new AICreditTierService(prisma as unknown as PrismaService);
        await expect(service.createTier(
            {
                code: 'TIER_PRO',
                name: '专业版',
                monthlyBaseCredits: '20000.00',
                prices: [
                    { duration: AICreditSubscriptionDuration.ONE_MONTH, tierPrice: '200.00', unitPrice: '20.00' },
                    { duration: AICreditSubscriptionDuration.ONE_MONTH, tierPrice: '300.00', unitPrice: '30.00' },
                ],
            },
            principal(),
            { requestId: 'request-id' },
        )).rejects.toMatchObject({ response: { code: 'AI_CREDIT_TIER_DUPLICATE_DURATION' } });
    });

    it('rejects capability codes that do not exist', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditTier.findFirst.mockResolvedValue(null);
        prisma.aICreditCapability.findMany.mockResolvedValue([]);

        const service = new AICreditTierService(prisma as unknown as PrismaService);
        await expect(service.createTier(
            {
                code: 'TIER_PRO',
                name: '专业版',
                monthlyBaseCredits: '20000.00',
                prices: [
                    { duration: AICreditSubscriptionDuration.ONE_MONTH, tierPrice: '200.00', unitPrice: '20.00' },
                ],
                capabilityCodes: ['missing'],
            },
            principal(),
            { requestId: 'request-id' },
        )).rejects.toMatchObject({ response: { code: 'AI_CREDIT_TIER_INVALID_CAPABILITIES' } });
    });

    it('rejects universal capabilities in the tier feature set', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditTier.findFirst.mockResolvedValue(null);
        prisma.aICreditCapability.findMany.mockResolvedValue([
            { id: 'c0000000-0000-0000-0000-000000000001', code: 'chat', capabilityKind: AICreditCapabilityKind.UNIVERSAL },
        ]);

        const service = new AICreditTierService(prisma as unknown as PrismaService);
        await expect(service.createTier(
            {
                code: 'TIER_PRO',
                name: '专业版',
                monthlyBaseCredits: '20000.00',
                prices: [
                    { duration: AICreditSubscriptionDuration.ONE_MONTH, tierPrice: '200.00', unitPrice: '20.00' },
                ],
                capabilityCodes: ['chat'],
            },
            principal(),
            { requestId: 'request-id' },
        )).rejects.toMatchObject({ response: { code: 'AI_CREDIT_TIER_INVALID_CAPABILITIES' } });
    });

    it('updates a tier replacing prices and capabilities wholesale with optimistic locking', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditTier.findFirst.mockResolvedValue(tierRecord({}));
        prisma.aICreditTier.updateMany.mockResolvedValue({ count: 1 });
        prisma.aICreditCapability.findMany.mockResolvedValue([
            { id: 'c0000000-0000-0000-0000-000000000001', code: 'rag', capabilityKind: AICreditCapabilityKind.TIER_GATED },
        ]);

        const service = new AICreditTierService(prisma as unknown as PrismaService);
        await service.updateTier(
            TIER_ID,
            {
                version: 3,
                name: ' 新名称 ',
                status: AICreditConfigStatus.INACTIVE,
                prices: [{ duration: AICreditSubscriptionDuration.SIX_MONTHS, tierPrice: '300.00', unitPrice: '30.00' }],
                capabilityCodes: ['rag'],
            },
            principal(),
            { requestId: 'request-id' },
        );

        expect(prisma.aICreditTier.updateMany).toHaveBeenCalledWith({
            where: { id: TIER_ID, version: 3, deletedAt: null },
            data: expect.objectContaining({ name: '新名称', status: AICreditConfigStatus.INACTIVE, version: { increment: 1 } }),
        });
        expect(prisma.aICreditTierPrice.deleteMany).toHaveBeenCalledWith({ where: { tierId: TIER_ID } });
        expect(prisma.aICreditTierPrice.createMany).toHaveBeenCalledWith({
            data: [expect.objectContaining({ tierId: TIER_ID, duration: AICreditSubscriptionDuration.SIX_MONTHS })],
        });
        expect(prisma.aICreditTierCapability.deleteMany).toHaveBeenCalledWith({ where: { tierId: TIER_ID } });
        expect(prisma.platformAuditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'AI_CREDIT_TIER_UPDATED' }),
        });
    });

    it('rejects update when the version is stale', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditTier.findFirst.mockResolvedValue(tierRecord({}));
        prisma.aICreditTier.updateMany.mockResolvedValue({ count: 0 });

        const service = new AICreditTierService(prisma as unknown as PrismaService);
        await expect(service.updateTier(
            TIER_ID,
            { name: '新名称', version: 2 },
            principal(),
            { requestId: 'request-id' },
        )).rejects.toMatchObject({ response: { code: 'RESOURCE_VERSION_CONFLICT' } });
    });

    it('soft deletes a tier and writes an audit event', async () => {
        const prisma = createPrismaMock();
        prisma.aICreditTier.findFirst.mockResolvedValue(tierRecord({}));
        prisma.aICreditTier.updateMany.mockResolvedValue({ count: 1 });

        const service = new AICreditTierService(prisma as unknown as PrismaService);
        await service.deleteTier(TIER_ID, principal(), { requestId: 'request-id' });

        expect(prisma.aICreditTier.updateMany).toHaveBeenCalledWith({
            where: { id: TIER_ID, deletedAt: null },
            data: expect.objectContaining({ deletedAt: expect.any(Date), version: { increment: 1 } }),
        });
        expect(prisma.platformAuditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'AI_CREDIT_TIER_DELETED' }),
        });
    });
});

const TIER_ID = 'b0000000-0000-0000-0000-000000000001';

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        aICreditTier: {
            findMany: jest.fn(),
            findFirst: jest.fn(),
            create: jest.fn(),
            updateMany: jest.fn(),
        },
        aICreditTierPrice: {
            createMany: jest.fn(),
            deleteMany: jest.fn(),
        },
        aICreditTierCapability: {
            createMany: jest.fn(),
            deleteMany: jest.fn(),
        },
        aICreditCapability: { findMany: jest.fn() },
        platformAuditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function tierRecord(overrides: { code?: string }): Record<string, unknown> {
    return {
        id: TIER_ID,
        code: overrides.code ?? 'TIER_PRO',
        name: '专业版',
        description: null,
        monthlyBaseCredits: { toFixed: () => '20000.00' },
        status: AICreditConfigStatus.ACTIVE,
        prices: [
            {
                duration: AICreditSubscriptionDuration.ONE_MONTH,
                tierPrice: { toFixed: () => '100.00' },
                unitPrice: { toFixed: () => '10.00' },
            },
        ],
        capabilities: [
            { capability: { code: 'chat' } },
            { capability: { code: 'rag' } },
        ],
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
