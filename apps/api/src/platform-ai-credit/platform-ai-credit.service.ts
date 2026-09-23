import {
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import {
    AICreditCapability,
    AuditOutcome,
    Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PlatformAuthenticatedPrincipal } from '../platform-auth/platform-auth.types';
import { PlatformRequestMetadata } from '../platform-auth/platform-auth.service';
import {
    CreateAICreditCapabilityDto,
    UpdateAICreditCapabilityDto,
} from './dto';
import {
    AICreditCapabilityListResult,
    AICreditCapabilityResult,
} from './platform-ai-credit.types';

@Injectable()
export class AICreditCapabilityService {
    constructor(private readonly prisma: PrismaService) { }

    async listCapabilities(): Promise<AICreditCapabilityListResult> {
        const capabilities = await this.prisma.aICreditCapability.findMany({
            where: { deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        });
        return { items: capabilities.map(toCapabilityResult) };
    }

    async getCapability(capabilityId: string): Promise<AICreditCapabilityResult> {
        return toCapabilityResult(await this.requireCapability(capabilityId));
    }

    async createCapability(
        input: CreateAICreditCapabilityDto,
        principal: PlatformAuthenticatedPrincipal,
        metadata: PlatformRequestMetadata,
    ): Promise<AICreditCapabilityResult> {
        const code = input.code.trim();
        const name = input.name.trim();
        const existing = await this.prisma.aICreditCapability.findFirst({
            where: { code, deletedAt: null },
            select: { id: true },
        });
        if (existing) throw this.capabilityCodeConflict();

        try {
            const created = await this.prisma.$transaction(async (transaction) => {
                const capability = await transaction.aICreditCapability.create({
                    data: {
                        code,
                        name,
                        description: input.description?.trim() || null,
                        meterType: input.meterType,
                        capabilityKind: input.capabilityKind,
                        permissionCode: input.permissionCode?.trim() || null,
                        sortOrder: input.sortOrder,
                        createdBy: principal.id,
                        updatedBy: principal.id,
                    },
                });
                await writeCapabilityAudit(
                    transaction,
                    principal,
                    metadata,
                    capability.id,
                    'AI_CREDIT_CAPABILITY_CREATED',
                    { code, name },
                );
                return capability;
            });
            return toCapabilityResult(created);
        } catch (error) {
            if (isPrismaError(error, 'P2002')) throw this.capabilityCodeConflict();
            throw error;
        }
    }

    async updateCapability(
        capabilityId: string,
        input: UpdateAICreditCapabilityDto,
        principal: PlatformAuthenticatedPrincipal,
        metadata: PlatformRequestMetadata,
    ): Promise<AICreditCapabilityResult> {
        const current = await this.requireCapability(capabilityId);
        const code = input.code?.trim();
        if (code && code !== current.code) {
            const conflict = await this.prisma.aICreditCapability.findFirst({
                where: { code, deletedAt: null, id: { not: capabilityId } },
                select: { id: true },
            });
            if (conflict) throw this.capabilityCodeConflict();
        }

        try {
            await this.prisma.$transaction(async (transaction) => {
                const result = await transaction.aICreditCapability.updateMany({
                    where: { id: capabilityId, version: input.version, deletedAt: null },
                    data: {
                        ...(code !== undefined ? { code } : {}),
                        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
                        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
                        ...(input.meterType !== undefined ? { meterType: input.meterType } : {}),
                        ...(input.capabilityKind !== undefined ? { capabilityKind: input.capabilityKind } : {}),
                        ...(input.permissionCode !== undefined ? { permissionCode: input.permissionCode?.trim() || null } : {}),
                        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
                        ...(input.status !== undefined ? { status: input.status } : {}),
                        updatedBy: principal.id,
                        version: { increment: 1 },
                    },
                });
                if (result.count !== 1) throw this.versionConflict();
                await writeCapabilityAudit(
                    transaction,
                    principal,
                    metadata,
                    capabilityId,
                    'AI_CREDIT_CAPABILITY_UPDATED',
                    { before: { code: current.code, name: current.name }, ...(code !== undefined ? { code } : {}) },
                );
            });
            return this.getCapability(capabilityId);
        } catch (error) {
            if (isPrismaError(error, 'P2002')) throw this.capabilityCodeConflict();
            throw error;
        }
    }

    async deleteCapability(
        capabilityId: string,
        principal: PlatformAuthenticatedPrincipal,
        metadata: PlatformRequestMetadata,
    ): Promise<void> {
        await this.requireCapability(capabilityId);
        await this.prisma.$transaction(async (transaction) => {
            const tierReferenceCount = await transaction.aICreditTierCapability.count({
                where: { capabilityId, tier: { deletedAt: null } },
            });
            if (tierReferenceCount > 0) {
                throw new ConflictException({
                    code: 'AI_CREDIT_CAPABILITY_REFERENCED',
                    message: '能力仍被档位功能集引用，不可删除',
                });
            }
            const rateCardCount = await transaction.aICreditRateCard.count({
                where: { capabilityId, deletedAt: null },
            });
            if (rateCardCount > 0) {
                throw new ConflictException({
                    code: 'AI_CREDIT_CAPABILITY_REFERENCED',
                    message: '能力仍被费率表引用，不可删除',
                });
            }
            const deleted = await transaction.aICreditCapability.updateMany({
                where: { id: capabilityId, deletedAt: null },
                data: { deletedAt: new Date(), updatedBy: principal.id, version: { increment: 1 } },
            });
            if (deleted.count !== 1) {
                throw new NotFoundException({ code: 'AI_CREDIT_CAPABILITY_NOT_FOUND', message: 'AI 计费能力不存在' });
            }
            await writeCapabilityAudit(
                transaction,
                principal,
                metadata,
                capabilityId,
                'AI_CREDIT_CAPABILITY_DELETED',
                {},
            );
        });
    }

    private async requireCapability(capabilityId: string): Promise<AICreditCapability> {
        const capability = await this.prisma.aICreditCapability.findFirst({
            where: { id: capabilityId, deletedAt: null },
        });
        if (!capability) {
            throw new NotFoundException({ code: 'AI_CREDIT_CAPABILITY_NOT_FOUND', message: 'AI 计费能力不存在' });
        }
        return capability;
    }

    private capabilityCodeConflict(): ConflictException {
        return new ConflictException({ code: 'AI_CREDIT_CAPABILITY_CODE_CONFLICT', message: '能力 code 已存在' });
    }

    private versionConflict(): ConflictException {
        return new ConflictException({ code: 'RESOURCE_VERSION_CONFLICT', message: '数据已被其他请求修改，请刷新后重试' });
    }
}

function toCapabilityResult(capability: AICreditCapability): AICreditCapabilityResult {
    return {
        id: capability.id,
        code: capability.code,
        name: capability.name,
        description: capability.description,
        meterType: capability.meterType,
        capabilityKind: capability.capabilityKind,
        permissionCode: capability.permissionCode,
        sortOrder: capability.sortOrder,
        status: capability.status,
        version: capability.version,
        createdAt: capability.createdAt,
        updatedAt: capability.updatedAt,
    };
}

async function writeCapabilityAudit(
    transaction: Prisma.TransactionClient,
    principal: PlatformAuthenticatedPrincipal,
    metadata: PlatformRequestMetadata,
    capabilityId: string,
    action: string,
    details: Record<string, unknown>,
): Promise<void> {
    await transaction.platformAuditLog.create({
        data: {
            actorUserId: principal.id,
            actorPlatformAdministratorId: principal.platformAdministratorId,
            action,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'AI_CREDIT_CAPABILITY',
            resourceId: capabilityId,
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
