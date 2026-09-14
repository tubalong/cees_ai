import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { AuditOutcome, MembershipStatus, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import {
    CreateKnowledgeBaseDto,
    CreateKnowledgeBaseMemberDto,
    DeleteKnowledgeBaseQueryDto,
    ListKnowledgeBaseMembersQueryDto,
    ListKnowledgeBasesQueryDto,
    UpdateKnowledgeBaseDto,
    UpdateKnowledgeBaseMemberDto,
} from './dto';
import {
    KNOWLEDGE_BASE_MEMBER_PERMISSIONS,
    KnowledgeBaseMemberListResult,
    KnowledgeBaseMemberPermission,
    KnowledgeBaseMemberResult,
    KnowledgeBaseListResult,
    KnowledgeBaseResult,
} from './knowledge.types';

const knowledgeBaseSelect = {
    id: true,
    tenantId: true,
    name: true,
    description: true,
    createdBy: true,
    updatedBy: true,
    version: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.KnowledgeBaseSelect;

const knowledgeBaseMemberSelect = {
    id: true,
    tenantId: true,
    knowledgeBaseId: true,
    userId: true,
    permission: true,
    createdAt: true,
} satisfies Prisma.KnowledgeBaseMemberSelect;

const membershipSelect = {
    id: true,
    userId: true,
    account: true,
    displayName: true,
    user: { select: { displayName: true, status: true, deletedAt: true } },
} satisfies Prisma.TenantMembershipSelect;

type KnowledgeBaseRecord = Prisma.KnowledgeBaseGetPayload<{ select: typeof knowledgeBaseSelect }>;
type KnowledgeBaseMemberRecord = Prisma.KnowledgeBaseMemberGetPayload<{ select: typeof knowledgeBaseMemberSelect }>;
type MembershipRecord = Prisma.TenantMembershipGetPayload<{ select: typeof membershipSelect }>;

const permissionRank: Record<KnowledgeBaseMemberPermission, number> = {
    READER: 1,
    EDITOR: 2,
    MANAGER: 3,
};

@Injectable()
export class KnowledgeService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
    ) { }

    async listKnowledgeBases(query: ListKnowledgeBasesQueryDto): Promise<KnowledgeBaseListResult> {
        const context = this.tenantContext.require();
        const visibleIds = context.permissions.includes('knowledge_base.manage_all')
            ? undefined
            : await this.listVisibleKnowledgeBaseIds(context.tenantId, context.userId);
        if (visibleIds && visibleIds.length === 0) return { items: [], nextCursor: null };
        if (query.cursor) {
            const cursorExists = await this.prisma.knowledgeBase.findFirst({
                where: {
                    tenantId: context.tenantId,
                    deletedAt: null,
                    AND: [
                        { id: query.cursor },
                        ...(visibleIds ? [{ id: { in: visibleIds } }] : []),
                    ],
                },
                select: { id: true },
            });
            if (!cursorExists) throw this.invalidCursor();
        }
        const keyword = query.keyword?.trim();
        const records = await this.prisma.knowledgeBase.findMany({
            where: {
                tenantId: context.tenantId,
                deletedAt: null,
                id: visibleIds ? { in: visibleIds } : undefined,
                OR: keyword
                    ? [
                        { name: { contains: keyword, mode: 'insensitive' } },
                        { description: { contains: keyword, mode: 'insensitive' } },
                    ]
                    : undefined,
            },
            select: knowledgeBaseSelect,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        const hasNextPage = records.length > query.limit;
        const page = hasNextPage ? records.slice(0, query.limit) : records;
        return {
            items: await Promise.all(page.map((record) => this.toKnowledgeBaseResult(record))),
            nextCursor: hasNextPage ? page[page.length - 1]?.id ?? null : null,
        };
    }

    async createKnowledgeBase(input: CreateKnowledgeBaseDto): Promise<KnowledgeBaseResult> {
        const context = this.tenantContext.require();
        const name = input.name.trim();
        const description = normalizeDescription(input.description);
        const record = await this.prisma.$transaction(async (transaction) => {
            const knowledgeBase = await transaction.knowledgeBase.create({
                data: {
                    tenantId: context.tenantId,
                    name,
                    description,
                    createdBy: context.userId,
                    updatedBy: context.userId,
                },
                select: knowledgeBaseSelect,
            });
            await transaction.knowledgeBaseMember.create({
                data: {
                    tenantId: context.tenantId,
                    knowledgeBaseId: knowledgeBase.id,
                    userId: context.userId,
                    permission: 'MANAGER',
                },
            });
            await this.writeAudit(transaction, context, 'KNOWLEDGE_BASE_CREATED', 'KNOWLEDGE_BASE', knowledgeBase.id, {
                name,
            });
            return knowledgeBase;
        });
        return { ...record, memberCount: 1 };
    }

    async getKnowledgeBase(knowledgeBaseId: string): Promise<KnowledgeBaseResult> {
        const context = this.tenantContext.require();
        const knowledgeBase = await this.requireKnowledgeBase(context.tenantId, knowledgeBaseId);
        await this.requireKnowledgeBasePermission(knowledgeBaseId, 'READER');
        return this.toKnowledgeBaseResult(knowledgeBase);
    }

    async updateKnowledgeBase(knowledgeBaseId: string, input: UpdateKnowledgeBaseDto): Promise<KnowledgeBaseResult> {
        const context = this.tenantContext.require();
        if (input.name === undefined && input.description === undefined) {
            throw new BadRequestException({ code: 'KNOWLEDGE_BASE_UPDATE_EMPTY', message: '至少提供一个需要修改的字段' });
        }
        const current = await this.requireKnowledgeBase(context.tenantId, knowledgeBaseId);
        await this.requireKnowledgeBasePermission(knowledgeBaseId, 'MANAGER');
        const data: Prisma.KnowledgeBaseUncheckedUpdateManyInput = {
            version: { increment: 1 },
            updatedBy: context.userId,
        };
        if (input.name !== undefined) data.name = input.name.trim();
        if (input.description !== undefined) data.description = normalizeDescription(input.description);
        await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.knowledgeBase.updateMany({
                where: {
                    id: knowledgeBaseId,
                    tenantId: context.tenantId,
                    version: input.version,
                    deletedAt: null,
                },
                data,
            });
            if (updated.count !== 1) throw this.versionConflict();
            await this.writeAudit(transaction, context, 'KNOWLEDGE_BASE_UPDATED', 'KNOWLEDGE_BASE', knowledgeBaseId, {
                before: { name: current.name, description: current.description },
                after: {
                    name: input.name === undefined ? current.name : input.name.trim(),
                    description: input.description === undefined ? current.description : normalizeDescription(input.description),
                },
            });
        });
        return this.getKnowledgeBase(knowledgeBaseId);
    }

    async deleteKnowledgeBase(knowledgeBaseId: string, input: DeleteKnowledgeBaseQueryDto): Promise<void> {
        const context = this.tenantContext.require();
        await this.requireKnowledgeBase(context.tenantId, knowledgeBaseId);
        await this.requireKnowledgeBasePermission(knowledgeBaseId, 'MANAGER');
        await this.prisma.$transaction(async (transaction) => {
            const deleted = await transaction.knowledgeBase.updateMany({
                where: {
                    id: knowledgeBaseId,
                    tenantId: context.tenantId,
                    version: input.version,
                    deletedAt: null,
                },
                data: {
                    deletedAt: new Date(),
                    updatedBy: context.userId,
                    version: { increment: 1 },
                },
            });
            if (deleted.count !== 1) throw this.versionConflict();
            await this.writeAudit(transaction, context, 'KNOWLEDGE_BASE_DELETED', 'KNOWLEDGE_BASE', knowledgeBaseId, {
                version: input.version,
            });
        });
    }

    async listMembers(
        knowledgeBaseId: string,
        query: ListKnowledgeBaseMembersQueryDto,
    ): Promise<KnowledgeBaseMemberListResult> {
        const context = this.tenantContext.require();
        await this.requireKnowledgeBase(context.tenantId, knowledgeBaseId);
        await this.requireKnowledgeBasePermission(knowledgeBaseId, 'MANAGER');
        if (query.cursor) {
            const cursorExists = await this.prisma.knowledgeBaseMember.findFirst({
                where: { id: query.cursor, tenantId: context.tenantId, knowledgeBaseId },
                select: { id: true },
            });
            if (!cursorExists) throw this.invalidCursor();
        }
        const records = await this.prisma.knowledgeBaseMember.findMany({
            where: { tenantId: context.tenantId, knowledgeBaseId },
            select: knowledgeBaseMemberSelect,
            orderBy: { id: 'asc' },
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: 101,
        });
        const hasNextPage = records.length > 100;
        const page = hasNextPage ? records.slice(0, 100) : records;
        return {
            items: await this.toMemberResults(context.tenantId, page),
            nextCursor: hasNextPage ? page[page.length - 1]?.id ?? null : null,
        };
    }

    async addMember(knowledgeBaseId: string, input: CreateKnowledgeBaseMemberDto): Promise<KnowledgeBaseMemberResult> {
        const context = this.tenantContext.require();
        const knowledgeBase = await this.requireKnowledgeBase(context.tenantId, knowledgeBaseId);
        await this.requireKnowledgeBasePermission(knowledgeBaseId, 'MANAGER');
        const target = await this.requireActiveMembership(context.tenantId, input.membershipId);
        try {
            const member = await this.prisma.$transaction(async (transaction) => {
                const created = await transaction.knowledgeBaseMember.create({
                    data: {
                        tenantId: context.tenantId,
                        knowledgeBaseId,
                        userId: target.userId,
                        permission: input.permission,
                    },
                    select: knowledgeBaseMemberSelect,
                });
                await this.writeAudit(transaction, context, 'KNOWLEDGE_BASE_MEMBER_ADDED', 'KNOWLEDGE_BASE_MEMBER', created.id, {
                    knowledgeBaseId,
                    membershipId: input.membershipId,
                    permission: input.permission,
                });
                return created;
            });
            return this.toMemberResult(member, target);
        } catch (error) {
            if (isPrismaError(error, 'P2002')) throw this.memberConflict();
            throw error;
        }
    }

    async updateMember(
        knowledgeBaseId: string,
        membershipId: string,
        input: UpdateKnowledgeBaseMemberDto,
    ): Promise<KnowledgeBaseMemberResult> {
        const context = this.tenantContext.require();
        const knowledgeBase = await this.requireKnowledgeBase(context.tenantId, knowledgeBaseId);
        await this.requireKnowledgeBasePermission(knowledgeBaseId, 'MANAGER');
        const target = await this.requireActiveMembership(context.tenantId, membershipId);
        const current = await this.prisma.knowledgeBaseMember.findUnique({
            where: {
                tenantId_knowledgeBaseId_userId: {
                    tenantId: context.tenantId,
                    knowledgeBaseId,
                    userId: target.userId,
                },
            },
            select: knowledgeBaseMemberSelect,
        });
        if (!current) throw this.memberNotFound();
        if (knowledgeBase.createdBy === target.userId && input.permission !== 'MANAGER') {
            throw this.ownerPermissionConflict();
        }
        const updated = await this.prisma.$transaction(async (transaction) => {
            const member = await transaction.knowledgeBaseMember.update({
                where: { id: current.id },
                data: { permission: input.permission },
                select: knowledgeBaseMemberSelect,
            });
            await this.writeAudit(transaction, context, 'KNOWLEDGE_BASE_MEMBER_UPDATED', 'KNOWLEDGE_BASE_MEMBER', current.id, {
                knowledgeBaseId,
                membershipId,
                beforePermission: current.permission,
                afterPermission: input.permission,
            });
            return member;
        });
        return this.toMemberResult(updated, target);
    }

    async removeMember(knowledgeBaseId: string, membershipId: string): Promise<void> {
        const context = this.tenantContext.require();
        const knowledgeBase = await this.requireKnowledgeBase(context.tenantId, knowledgeBaseId);
        await this.requireKnowledgeBasePermission(knowledgeBaseId, 'MANAGER');
        const target = await this.requireActiveMembership(context.tenantId, membershipId);
        const current = await this.prisma.knowledgeBaseMember.findUnique({
            where: {
                tenantId_knowledgeBaseId_userId: {
                    tenantId: context.tenantId,
                    knowledgeBaseId,
                    userId: target.userId,
                },
            },
            select: knowledgeBaseMemberSelect,
        });
        if (!current) throw this.memberNotFound();
        if (knowledgeBase.createdBy === target.userId) throw this.ownerPermissionConflict();
        await this.prisma.$transaction(async (transaction) => {
            if (current.permission === 'MANAGER') {
                const managerCount = await transaction.knowledgeBaseMember.count({
                    where: { tenantId: context.tenantId, knowledgeBaseId, permission: 'MANAGER' },
                });
                if (managerCount <= 1) throw this.lastManagerConflict();
            }
            await transaction.knowledgeBaseMember.delete({ where: { id: current.id } });
            await this.writeAudit(transaction, context, 'KNOWLEDGE_BASE_MEMBER_REMOVED', 'KNOWLEDGE_BASE_MEMBER', current.id, {
                knowledgeBaseId,
                membershipId,
                permission: current.permission,
            });
        });
    }

    private async listVisibleKnowledgeBaseIds(tenantId: string, userId: string): Promise<string[]> {
        const memberships = await this.prisma.knowledgeBaseMember.findMany({
            where: { tenantId, userId },
            select: { knowledgeBaseId: true },
        });
        return memberships.map((membership) => membership.knowledgeBaseId);
    }

    private async requireKnowledgeBase(tenantId: string, knowledgeBaseId: string): Promise<KnowledgeBaseRecord> {
        const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
            where: { id: knowledgeBaseId, tenantId, deletedAt: null },
            select: knowledgeBaseSelect,
        });
        if (!knowledgeBase) throw this.knowledgeBaseNotFound();
        return knowledgeBase;
    }

    private async requireKnowledgeBasePermission(
        knowledgeBaseId: string,
        minimumPermission: KnowledgeBaseMemberPermission,
    ): Promise<void> {
        const context = this.tenantContext.require();
        if (context.permissions.includes('knowledge_base.manage_all')) return;
        const member = await this.prisma.knowledgeBaseMember.findUnique({
            where: {
                tenantId_knowledgeBaseId_userId: {
                    tenantId: context.tenantId,
                    knowledgeBaseId,
                    userId: context.userId,
                },
            },
            select: { permission: true },
        });
        if (!member) throw this.knowledgeBaseNotFound();
        if (!isKnowledgeBaseMemberPermission(member.permission)
            || permissionRank[member.permission] < permissionRank[minimumPermission]) {
            throw new ForbiddenException({
                code: 'KNOWLEDGE_BASE_MEMBER_PERMISSION_DENIED',
                message: '知识库成员权限不足',
                details: { required: minimumPermission },
            });
        }
    }

    private async requireActiveMembership(tenantId: string, membershipId: string): Promise<MembershipRecord> {
        const membership = await this.prisma.tenantMembership.findFirst({
            where: {
                id: membershipId,
                tenantId,
                status: MembershipStatus.ACTIVE,
                deletedAt: null,
                user: { status: UserStatus.ACTIVE, deletedAt: null },
            },
            select: membershipSelect,
        });
        if (!membership) throw this.memberNotFound();
        return membership;
    }

    private async toKnowledgeBaseResult(record: KnowledgeBaseRecord): Promise<KnowledgeBaseResult> {
        const memberCount = await this.prisma.knowledgeBaseMember.count({
            where: { tenantId: record.tenantId, knowledgeBaseId: record.id },
        });
        return { ...record, memberCount };
    }

    private async toMemberResults(tenantId: string, records: KnowledgeBaseMemberRecord[]): Promise<KnowledgeBaseMemberResult[]> {
        if (records.length === 0) return [];
        const memberships = await this.prisma.tenantMembership.findMany({
            where: {
                tenantId,
                userId: { in: records.map((record) => record.userId) },
                deletedAt: null,
            },
            select: membershipSelect,
        });
        const membershipByUserId = new Map(memberships.map((membership) => [membership.userId, membership]));
        return records
            .map((record) => {
                const membership = membershipByUserId.get(record.userId);
                return membership ? this.toMemberResult(record, membership) : null;
            })
            .filter((result): result is KnowledgeBaseMemberResult => result !== null);
    }

    private toMemberResult(record: KnowledgeBaseMemberRecord, membership: MembershipRecord): KnowledgeBaseMemberResult {
        return {
            id: record.id,
            tenantId: record.tenantId,
            knowledgeBaseId: record.knowledgeBaseId,
            membershipId: membership.id,
            userId: membership.userId,
            account: membership.account,
            displayName: membership.displayName ?? membership.user.displayName,
            permission: normalizeMemberPermission(record.permission),
            createdAt: record.createdAt,
        };
    }

    private async writeAudit(
        transaction: Prisma.TransactionClient,
        context: ReturnType<TenantContext['require']>,
        action: string,
        resourceType: string,
        resourceId: string,
        metadata: Record<string, unknown>,
    ): Promise<void> {
        await transaction.auditLog.create({
            data: {
                tenantId: context.tenantId,
                actorUserId: context.userId,
                actorMembershipId: context.membershipId,
                action,
                outcome: AuditOutcome.SUCCESS,
                resourceType,
                resourceId,
                requestId: context.requestId,
                metadata: metadata as Prisma.InputJsonValue,
            },
        });
    }

    private invalidCursor(): BadRequestException {
        return new BadRequestException({ code: 'PAGINATION_CURSOR_INVALID', message: '分页游标无效' });
    }

    private versionConflict(): ConflictException {
        return new ConflictException({ code: 'RESOURCE_VERSION_CONFLICT', message: '数据已被其他请求修改，请刷新后重试' });
    }

    private knowledgeBaseNotFound(): NotFoundException {
        return new NotFoundException({ code: 'KNOWLEDGE_BASE_NOT_FOUND', message: '知识库不存在或无权访问' });
    }

    private memberNotFound(): NotFoundException {
        return new NotFoundException({ code: 'KNOWLEDGE_BASE_MEMBER_NOT_FOUND', message: '知识库成员不存在或不属于当前租户' });
    }

    private memberConflict(): ConflictException {
        return new ConflictException({ code: 'KNOWLEDGE_BASE_MEMBER_EXISTS', message: '该成员已经加入知识库' });
    }

    private ownerPermissionConflict(): ConflictException {
        return new ConflictException({ code: 'KNOWLEDGE_BASE_OWNER_REQUIRED', message: '知识库创建者必须保留 MANAGER 权限' });
    }

    private lastManagerConflict(): ConflictException {
        return new ConflictException({ code: 'KNOWLEDGE_BASE_LAST_MANAGER', message: '不能移除知识库最后一名 MANAGER' });
    }
}

function normalizeDescription(description: string | null | undefined): string | null {
    if (description === undefined || description === null) return null;
    const normalized = description.trim();
    return normalized || null;
}

function isKnowledgeBaseMemberPermission(value: string): value is KnowledgeBaseMemberPermission {
    return (KNOWLEDGE_BASE_MEMBER_PERMISSIONS as readonly string[]).includes(value);
}

function normalizeMemberPermission(value: string): KnowledgeBaseMemberPermission {
    if (!isKnowledgeBaseMemberPermission(value)) return 'READER';
    return value;
}

function isPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
