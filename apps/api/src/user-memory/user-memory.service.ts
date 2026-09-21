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

/** 记忆条目数量封顶；达到上限后按更新时间最旧淘汰（与设计文档 4.5 一致）。 */
const MAX_USER_MEMORIES = 30;

/** 代码层敏感内容兜底：命中即丢弃候选（prompt 已先约束，见设计文档 4.2 第 5 点）。 */
const SENSITIVE_PATTERNS: RegExp[] = [
    /(?:密码|口令|验证码|password|passwd)\s*(?:是|为|：|:|=)\s*\S+/i,
    /\b\d{17}[\dXx]\b/,
    /\b1[3-9]\d{9}\b/,
    /\b\d{16,19}\b/,
    /(?:工资|月薪|年薪|收入)\s*(?:是|为|约|大约|：|:)\s*\d/i,
];

export interface UserMemoryCandidateInput {
    type: MemoryType;
    content: string;
    /** create 新增；update 配合 replaces 覆盖已有条目（建议权/执行权分离，见设计文档 4.3）。 */
    action?: 'create' | 'update';
    /** update 时定位被覆盖条目的原文片段；未命中时降级为 create。 */
    replaces?: string | null;
}

export interface UserMemoryCandidateSource {
    conversationId: string;
    /** 随回答提炼时有轮次 ID；压缩提炼时无。 */
    turnId?: string;
}

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

    /**
     * 应用 AI 提炼的记忆候选（ai-service 只提议，NestJS 校验并执行写入）：
     * 完全相同的条目去重；update 命中 replaces 时覆盖旧条目；达到 30 条上限
     * 时先淘汰最久未更新的条目；敏感内容兜底拒绝。全部记录审计。
     */
    async applyCandidates(
        candidates: UserMemoryCandidateInput[],
        source: UserMemoryCandidateSource,
    ): Promise<void> {
        const context = this.tenantContext.require();
        const valid = candidates
            .map(normalizeCandidate)
            .filter((candidate): candidate is UserMemoryCandidateInput => candidate !== null);
        if (valid.length === 0) return;

        await this.prisma.$transaction(async (transaction) => {
            const existing = await transaction.userMemory.findMany({
                where: {
                    tenantId: context.tenantId,
                    membershipId: context.membershipId,
                    deletedAt: null,
                },
                select: { id: true, type: true, content: true, version: true, updatedAt: true },
                orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
            });

            for (const candidate of valid) {
                if (candidate.action === 'update' && candidate.replaces) {
                    const replaced = existing.find((memory) => memory.content.includes(candidate.replaces!));
                    if (replaced) {
                        existing.splice(existing.indexOf(replaced), 1);
                        await upsertReplacement(transaction, context, candidate, replaced, source);
                        existing.push({ ...replaced, type: candidate.type, content: candidate.content, version: replaced.version + 1 });
                        continue;
                    }
                    // replaces 未命中任何条目：降级为新增，不丢弃用户表达的信息。
                }

                const duplicate = existing.some(
                    (memory) => memory.type === candidate.type && memory.content === candidate.content,
                );
                if (duplicate) continue;

                await evictOldestIfNeeded(transaction, context, existing);
                const created = await transaction.userMemory.create({
                    data: {
                        tenantId: context.tenantId,
                        membershipId: context.membershipId,
                        type: candidate.type,
                        content: candidate.content,
                        sourceConversationId: source.conversationId,
                        sourceTurnId: source.turnId ?? null,
                    },
                    select: { id: true, type: true, content: true, version: true, updatedAt: true },
                });
                await transaction.auditLog.create({
                    data: {
                        tenantId: context.tenantId,
                        actorUserId: context.userId,
                        actorMembershipId: context.membershipId,
                        action: 'USER_MEMORY_CREATED',
                        outcome: AuditOutcome.SUCCESS,
                        resourceType: 'USER_MEMORY',
                        resourceId: created.id,
                        requestId: context.requestId,
                        metadata: {
                            origin: 'ai_suggestion',
                            type: created.type,
                            content: created.content,
                            sourceConversationId: source.conversationId,
                            sourceTurnId: source.turnId ?? null,
                        },
                    },
                });
                existing.push(created);
            }
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

/** 清洗候选：trim、长度、敏感内容兜底；不合法返回 null（调用方丢弃）。 */
function normalizeCandidate(candidate: UserMemoryCandidateInput): UserMemoryCandidateInput | null {
    const content = candidate.content.trim();
    if (!content || content.length > 1000) return null;
    if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(content))) {
        return null;
    }
    return {
        ...candidate,
        content,
        action: candidate.action === 'update' ? 'update' : 'create',
        replaces: candidate.action === 'update' ? candidate.replaces?.trim() || null : null,
    };
}

/** update 候选命中已有条目：覆盖内容并更新来源，乐观锁失败则静默放弃（AI 建议不阻断主流程）。 */
async function upsertReplacement(
    transaction: Prisma.TransactionClient,
    context: RequestTenantContext,
    candidate: UserMemoryCandidateInput,
    replaced: { id: string; version: number; content: string; type: MemoryType },
    source: UserMemoryCandidateSource,
): Promise<void> {
    const updated = await transaction.userMemory.updateMany({
        where: {
            id: replaced.id,
            tenantId: context.tenantId,
            membershipId: context.membershipId,
            version: replaced.version,
            deletedAt: null,
        },
        data: {
            type: candidate.type,
            content: candidate.content,
            sourceConversationId: source.conversationId,
            sourceTurnId: source.turnId ?? null,
            version: { increment: 1 },
        },
    });
    if (updated.count !== 1) return;
    await transaction.auditLog.create({
        data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            actorMembershipId: context.membershipId,
            action: 'USER_MEMORY_UPDATED',
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'USER_MEMORY',
            resourceId: replaced.id,
            requestId: context.requestId,
            metadata: {
                origin: 'ai_suggestion',
                before: { type: replaced.type, content: replaced.content, version: replaced.version },
                after: { type: candidate.type, content: candidate.content, version: replaced.version + 1 },
                sourceConversationId: source.conversationId,
                sourceTurnId: source.turnId ?? null,
            },
        },
    });
}

/** 达到 30 条上限时软删除更新时间最旧的条目并审计。 */
async function evictOldestIfNeeded(
    transaction: Prisma.TransactionClient,
    context: RequestTenantContext,
    existing: { id: string; version: number; updatedAt: Date }[],
): Promise<void> {
    if (existing.length < MAX_USER_MEMORIES) return;
    const oldest = existing.shift();
    if (!oldest) return;
    const evicted = await transaction.userMemory.updateMany({
        where: {
            id: oldest.id,
            tenantId: context.tenantId,
            membershipId: context.membershipId,
            version: oldest.version,
            deletedAt: null,
        },
        data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    if (evicted.count !== 1) return;
    await transaction.auditLog.create({
        data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            actorMembershipId: context.membershipId,
            action: 'USER_MEMORY_EVICTED',
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'USER_MEMORY',
            resourceId: oldest.id,
            requestId: context.requestId,
            metadata: { reason: 'capacity_limit', limit: MAX_USER_MEMORIES },
        },
    });
}
