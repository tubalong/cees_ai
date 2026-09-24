import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import {
    AICreditCapabilityKind,
    AICreditTier,
    AICreditTierCapability,
    AICreditTierPrice,
    AuditOutcome,
    Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PlatformAuthenticatedPrincipal } from '../platform-auth/platform-auth.types';
import { PlatformRequestMetadata } from '../platform-auth/platform-auth.service';
import {
    AICreditTierPriceInputDto,
    CreateAICreditTierDto,
    UpdateAICreditTierDto,
} from './tier.dto';
import {
    AICreditTierListResult,
    AICreditTierResult,
} from './tier.types';

type TierWithRelations = AICreditTier & {
    prices: AICreditTierPrice[];
    capabilities: (AICreditTierCapability & { capability: { code: string } })[];
};

const TIER_INCLUDE = {
    prices: { orderBy: { duration: 'asc' } },
    capabilities: { include: { capability: { select: { code: true } } } },
} as const;

@Injectable()
export class AICreditTierService {
    constructor(private readonly prisma: PrismaService) { }

    async listTiers(): Promise<AICreditTierListResult> {
        const tiers = await this.prisma.aICreditTier.findMany({
            where: { deletedAt: null },
            include: TIER_INCLUDE,
            orderBy: [{ createdAt: 'asc' }, { code: 'asc' }],
        });
        return { items: tiers.map(toTierResult) };
    }

    async getTier(tierId: string): Promise<AICreditTierResult> {
        return toTierResult(await this.requireTier(tierId));
    }

    async createTier(
        input: CreateAICreditTierDto,
        principal: PlatformAuthenticatedPrincipal,
        metadata: PlatformRequestMetadata,
    ): Promise<AICreditTierResult> {
        const code = input.code.trim();
        const name = input.name.trim();
        const existing = await this.prisma.aICreditTier.findFirst({
            where: { code, deletedAt: null },
            select: { id: true },
        });
        if (existing) throw this.tierCodeConflict();

        this.assertPricesValid(input.prices);
        const capabilityIds = await this.resolveCapabilityIds(input.capabilityCodes ?? []);

        try {
            const created = await this.prisma.$transaction(async (transaction) => {
                const tier = await transaction.aICreditTier.create({
                    data: {
                        code,
                        name,
                        description: input.description?.trim() || null,
                        monthlyBaseCredits: input.monthlyBaseCredits,
                        createdBy: principal.id,
                        updatedBy: principal.id,
                    },
                });
                await transaction.aICreditTierPrice.createMany({
                    data: input.prices.map((price) => ({
                        tierId: tier.id,
                        duration: price.duration,
                        tierPrice: price.tierPrice,
                        unitPrice: price.unitPrice,
                    })),
                });
                if (capabilityIds.length > 0) {
                    await transaction.aICreditTierCapability.createMany({
                        data: capabilityIds.map((capabilityId) => ({ tierId: tier.id, capabilityId })),
                    });
                }
                await writeTierAudit(
                    transaction,
                    principal,
                    metadata,
                    tier.id,
                    'AI_CREDIT_TIER_CREATED',
                    { code, name },
                );
                const withRelations = await transaction.aICreditTier.findFirst({
                    where: { id: tier.id },
                    include: TIER_INCLUDE,
                });
                if (!withRelations) {
                    throw new NotFoundException({ code: 'AI_CREDIT_TIER_NOT_FOUND', message: 'AI 计费档位不存在' });
                }
                return withRelations;
            });
            return toTierResult(created);
        } catch (error) {
            if (isPrismaError(error, 'P2002')) throw this.tierCodeConflict();
            throw error;
        }
    }

    async updateTier(
        tierId: string,
        input: UpdateAICreditTierDto,
        principal: PlatformAuthenticatedPrincipal,
        metadata: PlatformRequestMetadata,
    ): Promise<AICreditTierResult> {
        const current = await this.requireTier(tierId);
        if (input.prices !== undefined) this.assertPricesValid(input.prices);
        const capabilityIds = input.capabilityCodes !== undefined
            ? await this.resolveCapabilityIds(input.capabilityCodes)
            : undefined;

        await this.prisma.$transaction(async (transaction) => {
            const result = await transaction.aICreditTier.updateMany({
                where: { id: tierId, version: input.version, deletedAt: null },
                data: {
                    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
                    ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
                    ...(input.monthlyBaseCredits !== undefined ? { monthlyBaseCredits: input.monthlyBaseCredits } : {}),
                    ...(input.status !== undefined ? { status: input.status } : {}),
                    updatedBy: principal.id,
                    version: { increment: 1 },
                },
            });
            if (result.count !== 1) throw this.versionConflict();
            if (input.prices !== undefined) {
                await transaction.aICreditTierPrice.deleteMany({ where: { tierId } });
                await transaction.aICreditTierPrice.createMany({
                    data: input.prices.map((price) => ({
                        tierId,
                        duration: price.duration,
                        tierPrice: price.tierPrice,
                        unitPrice: price.unitPrice,
                    })),
                });
            }
            if (capabilityIds !== undefined) {
                await transaction.aICreditTierCapability.deleteMany({ where: { tierId } });
                if (capabilityIds.length > 0) {
                    await transaction.aICreditTierCapability.createMany({
                        data: capabilityIds.map((capabilityId) => ({ tierId, capabilityId })),
                    });
                }
            }
            await writeTierAudit(
                transaction,
                principal,
                metadata,
                tierId,
                'AI_CREDIT_TIER_UPDATED',
                { before: { name: current.name, status: current.status } },
            );
        });
        return this.getTier(tierId);
    }

    async deleteTier(
        tierId: string,
        principal: PlatformAuthenticatedPrincipal,
        metadata: PlatformRequestMetadata,
    ): Promise<void> {
        await this.requireTier(tierId);
        await this.prisma.$transaction(async (transaction) => {
            const deleted = await transaction.aICreditTier.updateMany({
                where: { id: tierId, deletedAt: null },
                data: { deletedAt: new Date(), updatedBy: principal.id, version: { increment: 1 } },
            });
            if (deleted.count !== 1) {
                throw new NotFoundException({ code: 'AI_CREDIT_TIER_NOT_FOUND', message: 'AI 计费档位不存在' });
            }
            await writeTierAudit(
                transaction,
                principal,
                metadata,
                tierId,
                'AI_CREDIT_TIER_DELETED',
                {},
            );
        });
    }

    private async requireTier(tierId: string): Promise<TierWithRelations> {
        const tier = await this.prisma.aICreditTier.findFirst({
            where: { id: tierId, deletedAt: null },
            include: TIER_INCLUDE,
        });
        if (!tier) {
            throw new NotFoundException({ code: 'AI_CREDIT_TIER_NOT_FOUND', message: 'AI 计费档位不存在' });
        }
        return tier;
    }

    private assertPricesValid(prices: AICreditTierPriceInputDto[]): void {
        const durations = prices.map((price) => price.duration);
        if (new Set(durations).size !== durations.length) {
            throw new BadRequestException({
                code: 'AI_CREDIT_TIER_DUPLICATE_DURATION',
                message: '价格列表中存在重复的订阅持续时间',
            });
        }
    }

    private async resolveCapabilityIds(codes: string[]): Promise<string[]> {
        const uniqueCodes = [...new Set(codes.map((code) => code.trim()))];
        if (uniqueCodes.length === 0) return [];
        const capabilities = await this.prisma.aICreditCapability.findMany({
            where: { code: { in: uniqueCodes }, deletedAt: null },
            select: { id: true, code: true, capabilityKind: true },
        });
        const foundCodes = new Set(capabilities.map((capability) => capability.code));
        const missing = uniqueCodes.filter((code) => !foundCodes.has(code));
        if (missing.length > 0) {
            throw new BadRequestException({
                code: 'AI_CREDIT_TIER_INVALID_CAPABILITIES',
                message: `能力不存在：${missing.join(', ')}`,
            });
        }
        const nonTierGated = capabilities.filter((capability) => capability.capabilityKind !== AICreditCapabilityKind.TIER_GATED);
        if (nonTierGated.length > 0) {
            throw new BadRequestException({
                code: 'AI_CREDIT_TIER_INVALID_CAPABILITIES',
                message: `仅功能开关类能力可加入档位功能集：${nonTierGated.map((capability) => capability.code).join(', ')}`,
            });
        }
        return capabilities.map((capability) => capability.id);
    }

    private tierCodeConflict(): ConflictException {
        return new ConflictException({ code: 'AI_CREDIT_TIER_CODE_CONFLICT', message: '档位 code 已存在' });
    }

    private versionConflict(): ConflictException {
        return new ConflictException({ code: 'RESOURCE_VERSION_CONFLICT', message: '数据已被其他请求修改，请刷新后重试' });
    }
}

function toTierResult(tier: TierWithRelations): AICreditTierResult {
    return {
        id: tier.id,
        code: tier.code,
        name: tier.name,
        description: tier.description,
        monthlyBaseCredits: tier.monthlyBaseCredits.toFixed(2),
        status: tier.status,
        prices: tier.prices.map((price) => ({
            duration: price.duration,
            tierPrice: price.tierPrice.toFixed(2),
            unitPrice: price.unitPrice.toFixed(2),
        })),
        capabilityCodes: tier.capabilities.map((link) => link.capability.code).sort(),
        version: tier.version,
        createdAt: tier.createdAt,
        updatedAt: tier.updatedAt,
    };
}

async function writeTierAudit(
    transaction: Prisma.TransactionClient,
    principal: PlatformAuthenticatedPrincipal,
    metadata: PlatformRequestMetadata,
    tierId: string,
    action: string,
    details: Record<string, unknown>,
): Promise<void> {
    await transaction.platformAuditLog.create({
        data: {
            actorUserId: principal.id,
            actorPlatformAdministratorId: principal.platformAdministratorId,
            action,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'AI_CREDIT_TIER',
            resourceId: tierId,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            metadata: details as Prisma.InputJsonValue,
        },
    });
}

function isPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
