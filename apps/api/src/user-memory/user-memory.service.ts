import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { AuditOutcome, MemoryType, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RequestTenantContext, TenantContext } from '../tenant/tenant-context';
import { UpdateUserMemoryDto } from './dto';
import type { UserMemoryResult } from './user-memory.types';

const memorySelect = {
    id: true,
    type: true,
    content: true,
    version: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.UserMemorySelect;

type MemoryRecord = Prisma.UserMemoryGetPayload<{ select: typeof memorySelect }>;

type MemoryDatabase = PrismaService | Prisma.TransactionClient;

/**
 * 用户级记忆的成员本人 CRUD 入口。记忆只属于成员本人：AI 仅提议记忆内容
 * （见 ai-service 提炼链路），写入与删除一律以本人操作为准并记录审计。
 */
@Injectable()
export class UserMemoryService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
    ) { }

    async list(): Promise<UserMemoryResult[]> {
        const context = this.tenantContext.require();
        const memories = await this.prisma.userMemory.findMany({
            where: {
                tenantId: context.tenantId,
                membershipId: context.membershipId,
                deletedAt: null,
            },
            select: memorySelect,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        return memories.map(toUserMemoryResult);
    }

    async update(memoryId: string, input: UpdateUserMemoryDto): Promise<UserMemoryResult> {
        const context = this.tenantContext.require();
        const changes = resolveChanges(input);
        return this.prisma.$transaction(async (transaction) => {
            const current = await requireMemberMemory(transaction, context, memoryId);
            if (
                (changes.content === undefined || changes.content === current.content)
                && (changes.type === undefined || changes.type === current.type)
            ) {
                return toUserMemoryResult(current);
            }

            const updated = await transaction.userMemory.updateMany({
                where: {
                    id: memoryId,
                    tenantId: context.tenantId,
                    membershipId: context.membershipId,
                    version: input.version,
                    deletedAt: null,
                },
                data: {
                    ...changes,
                    version: { increment: 1 },
                },
            });
            if (updated.count !== 1) {
                throw versionConflict();
            }
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'USER_MEMORY_UPDATED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'USER_MEMORY',
                    resourceId: memoryId,
                    requestId: context.requestId,
                    metadata: {
                        before: { type: current.type, content: current.content, version: current.version },
                        after: {
                            type: changes.type ?? current.type,
                            content: changes.content ?? current.content,
                            version: current.version + 1,
                        },
                    },
                },
            });

            const refreshed = await transaction.userMemory.findUniqueOrThrow({
                where: { id: memoryId },
                select: memorySelect,
            });
            return toUserMemoryResult(refreshed);
        });
    }

    async remove(memoryId: string, version: number): Promise<void> {
        const context = this.tenantContext.require();
        await this.prisma.$transaction(async (transaction) => {
            const current = await requireMemberMemory(transaction, context, memoryId);
            const now = new Date();
            const deleted = await transaction.userMemory.updateMany({
                where: {
                    id: memoryId,
                    tenantId: context.tenantId,
                    membershipId: context.membershipId,
                    version,
                    deletedAt: null,
                },
                data: { deletedAt: now, version: { increment: 1 } },
            });
            if (deleted.count !== 1) {
                throw versionConflict();
            }
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'USER_MEMORY_DELETED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'USER_MEMORY',
                    resourceId: memoryId,
                    requestId: context.requestId,
                    metadata: { type: current.type, content: current.content, version: current.version },
                },
            });
        });
    }
}

/** 校验记忆属于当前成员；不属于或已软删除统一按不存在处理。 */
async function requireMemberMemory(
    database: MemoryDatabase,
    context: RequestTenantContext,
    memoryId: string,
): Promise<MemoryRecord> {
    const memory = await database.userMemory.findFirst({
        where: {
            id: memoryId,
            tenantId: context.tenantId,
            membershipId: context.membershipId,
            deletedAt: null,
        },
        select: memorySelect,
    });
    if (!memory) {
        throw new NotFoundException({
            code: 'USER_MEMORY_NOT_FOUND',
            message: '记忆不存在或不属于当前成员',
        });
    }
    return memory;
}

function resolveChanges(input: UpdateUserMemoryDto): { content?: string; type?: MemoryType } {
    const trimmed = input.content?.trim();
    if (input.content !== undefined && !trimmed) {
        throw new BadRequestException({
            code: 'USER_MEMORY_CONTENT_INVALID',
            message: '记忆内容不能为空',
        });
    }
    if (trimmed === undefined && input.type === undefined) {
        throw new BadRequestException({
            code: 'USER_MEMORY_UPDATE_EMPTY',
            message: 'content 与 type 至少提供一个',
        });
    }
    return {
        ...(trimmed !== undefined ? { content: trimmed } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
    };
}

function versionConflict(): ConflictException {
    return new ConflictException({
        code: 'USER_MEMORY_VERSION_CONFLICT',
        message: '记忆已被修改，请刷新后重试',
    });
}

function toUserMemoryResult(memory: MemoryRecord): UserMemoryResult {
    return {
        id: memory.id,
        type: memory.type,
        content: memory.content,
        version: memory.version,
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
    };
}
