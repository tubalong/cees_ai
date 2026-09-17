import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { AuditOutcome, MembershipStatus, Prisma, UserStatus } from '@prisma/client';
import type { KnowledgeAnswerResponse, KnowledgeRetrieveScope } from '@cees/ai-service-client';
import { AiServiceGateway, AiServiceInvocationError } from '../ai-orchestration/ai-service-gateway.service';
import { PrismaService } from '../database/prisma.service';
import { TenantContext, RequestTenantContext } from '../tenant/tenant-context';
import {
    CreateKnowledgeBaseDto,
    CreateKnowledgeBaseMemberDto,
    DeleteKnowledgeBaseQueryDto,
    ListKnowledgeBaseMembersQueryDto,
    ListKnowledgeBasesQueryDto,
    QueryKnowledgeBaseDto,
    UpdateKnowledgeBaseDto,
    UpdateKnowledgeBaseMemberDto,
} from './dto';
import { KnowledgeIndexingService, readIndexVersions } from './knowledge-indexing.service';
import {
    KNOWLEDGE_BASE_MEMBER_PERMISSIONS,
    AssistantKnowledgeBaseCandidate,
    AssistantKnowledgeSearchResult,
    KnowledgeBaseMemberListResult,
    KnowledgeBaseMemberPermission,
    KnowledgeBaseMemberResult,
    KnowledgeBaseListResult,
    KnowledgeBaseResult,
    KnowledgeQueryResult,
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

export type KnowledgeBaseAccess = KnowledgeBaseRecord;

const permissionRank: Record<KnowledgeBaseMemberPermission, number> = {
    READER: 1,
    EDITOR: 2,
    MANAGER: 3,
};

@Injectable()
export class KnowledgeService {
    private readonly logger = new Logger(KnowledgeService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
        private readonly gateway: AiServiceGateway,
        private readonly indexingService: KnowledgeIndexingService,
    ) { }

    async listKnowledgeBases(query: ListKnowledgeBasesQueryDto): Promise<KnowledgeBaseListResult> {
        const context = this.tenantContext.require();
        const visibleIds = context.permissions.includes('knowledge_base.manage_all')
            ? undefined
            : query.permission
                ? await this.listKnowledgeBaseIdsWithPermission(context.tenantId, context.userId, query.permission)
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

    /**
     * 助手可见库清单（回答“我有哪些知识库”与转存目标库选择，块 7c）：返回当前用户
     * 可见（任意成员等级，含 READER）的全部知识库，并标注每个库的成员权限；
     * 工具在后台执行，TenantContext 已不可用，因此身份与权限全部显式传入。
     */
    async listKnowledgeBasesForAssistant(input: {
        tenantId: string;
        userId: string;
        permissions: string[];
    }): Promise<AssistantKnowledgeBaseCandidate[]> {
        // manage_all 短路为租户全部未删除库，等效拥有最高权限。
        if (input.permissions.includes('knowledge_base.manage_all')) {
            const records = await this.prisma.knowledgeBase.findMany({
                where: { tenantId: input.tenantId, deletedAt: null },
                select: knowledgeBaseSelect,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: 100,
            });
            return Promise.all(records.map(async (record) => ({
                ...(await this.toKnowledgeBaseResult(record)),
                myPermission: 'MANAGER' as KnowledgeBaseMemberPermission,
            })));
        }
        const memberships = await this.prisma.knowledgeBaseMember.findMany({
            where: { tenantId: input.tenantId, userId: input.userId },
            select: { knowledgeBaseId: true, permission: true },
        });
        if (memberships.length === 0) return [];
        const permissionByKnowledgeBaseId = new Map(
            memberships.map((membership) => [
                membership.knowledgeBaseId,
                normalizeMemberPermission(membership.permission),
            ]),
        );
        const records = await this.prisma.knowledgeBase.findMany({
            where: {
                tenantId: input.tenantId,
                deletedAt: null,
                id: { in: [...permissionByKnowledgeBaseId.keys()] },
            },
            select: knowledgeBaseSelect,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 100,
        });
        return Promise.all(records.map(async (record) => ({
            ...(await this.toKnowledgeBaseResult(record)),
            myPermission: permissionByKnowledgeBaseId.get(record.id) ?? 'READER',
        })));
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
        void this.indexingService.deleteKnowledgeBaseIndexes(
            context.tenantId,
            context.userId,
            knowledgeBaseId,
        ).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : 'unknown error';
            this.logger.warn(`清理知识库派生索引失败（知识库 ${knowledgeBaseId}）：${message}`);
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

    /** 校验知识库属于当前租户且当前成员达到最低权限，返回知识库记录；供文档服务复用。 */
    async requireKnowledgeBaseAccess(
        knowledgeBaseId: string,
        minimumPermission: KnowledgeBaseMemberPermission,
    ): Promise<KnowledgeBaseAccess> {
        const context = this.tenantContext.require();
        const knowledgeBase = await this.requireKnowledgeBase(context.tenantId, knowledgeBaseId);
        await this.requireKnowledgeBasePermission(knowledgeBaseId, minimumPermission);
        return knowledgeBase;
    }

    /**
     * 显式上下文的成员权限校验（后台工具执行用，不依赖 AsyncLocalStorage）：
     * manage_all 短路放行，否则按成员表权限等级比对；语义与 requireKnowledgeBaseAccess 一致。
     */
    async assertKnowledgeBaseMemberPermission(input: {
        tenantId: string;
        userId: string;
        permissions: string[];
        knowledgeBaseId: string;
        minimumPermission: KnowledgeBaseMemberPermission;
    }): Promise<KnowledgeBaseAccess> {
        const knowledgeBase = await this.requireKnowledgeBase(input.tenantId, input.knowledgeBaseId);
        if (input.permissions.includes('knowledge_base.manage_all')) return knowledgeBase;
        const member = await this.prisma.knowledgeBaseMember.findUnique({
            where: {
                tenantId_knowledgeBaseId_userId: {
                    tenantId: input.tenantId,
                    knowledgeBaseId: input.knowledgeBaseId,
                    userId: input.userId,
                },
            },
            select: { permission: true },
        });
        if (!member) throw this.knowledgeBaseNotFound();
        if (!isKnowledgeBaseMemberPermission(member.permission)
            || permissionRank[member.permission] < permissionRank[input.minimumPermission]) {
            throw new ForbiddenException({
                code: 'KNOWLEDGE_BASE_MEMBER_PERMISSION_DENIED',
                message: '知识库成员权限不足',
                details: { required: input.minimumPermission },
            });
        }
        return knowledgeBase;
    }

    /**
     * 基于知识库内容回答提问：实时折叠三层权限为可信 scope 后调 ai-service
     * answer（内部先检索再生成带引用的答案），成功写入 KnowledgeQueryLog 与审计。
     */
    async queryKnowledgeBase(knowledgeBaseId: string, input: QueryKnowledgeBaseDto): Promise<KnowledgeQueryResult> {
        const context = this.tenantContext.require();
        await this.requireKnowledgeBaseAccess(knowledgeBaseId, 'READER');
        const scope = await this.buildQueryScope(context.tenantId, context.membershipId, knowledgeBaseId);
        let response: KnowledgeAnswerResponse;
        try {
            response = await this.gateway.answerKnowledge({
                request_id: context.requestId,
                tenant_id: context.tenantId,
                user_id: context.userId,
                query: input.query,
                scope,
                index_version: input.indexVersion?.trim() || readIndexVersions().indexVersion,
                embedding_profile: null,
            });
        } catch (error) {
            await this.writeQueryFailureAudit(context, knowledgeBaseId, error);
            throw this.queryServiceUnavailable();
        }
        const result = toKnowledgeQueryResult(response);
        await this.prisma.$transaction(async (transaction) => {
            await transaction.knowledgeQueryLog.create({
                data: {
                    tenantId: context.tenantId,
                    knowledgeBaseId,
                    userId: context.userId,
                    query: input.query,
                    answer: response.answer || null,
                    grounded: response.grounded,
                    citations: result.citations as unknown as Prisma.InputJsonValue,
                    latencyMs: response.execution?.latency_ms ?? null,
                    inputTokens: response.execution?.token_usage?.input_tokens ?? null,
                    outputTokens: response.execution?.token_usage?.output_tokens ?? null,
                    totalTokens: response.execution?.token_usage?.total_tokens ?? null,
                    requestId: context.requestId,
                },
            });
            await this.writeAudit(transaction, context, 'KNOWLEDGE_BASE_QUERIED', 'KNOWLEDGE_BASE', knowledgeBaseId, {
                grounded: response.grounded,
                insufficientEvidence: response.insufficient_evidence,
                citationCount: result.citations.length,
                indexVersion: response.index_version,
            });
        });
        return result;
    }

    /**
     * 助手知识库检索：与单库问答共用 ai-service answer 链路，但检索范围为
     * 当前用户可见的全部知识库（manage_all 短路为租户全部库）。工具在后台执行，
     * TenantContext 已不可用，因此身份与权限全部显式传入。
     * 多库检索的 KnowledgeQueryLog.knowledgeBaseId 记空，审计记录实际检索范围。
     */
    async searchKnowledgeForAssistant(input: {
        tenantId: string;
        userId: string;
        membershipId: string;
        permissions: string[];
        requestId: string;
        query: string;
    }): Promise<AssistantKnowledgeSearchResult> {
        const knowledgeBaseIds = input.permissions.includes('knowledge_base.manage_all')
            ? await this.listTenantKnowledgeBaseIds(input.tenantId)
            : await this.listVisibleKnowledgeBaseIds(input.tenantId, input.userId);
        if (knowledgeBaseIds.length === 0) {
            return {
                answer: '',
                grounded: false,
                insufficientEvidence: true,
                citations: [],
                searchedKnowledgeBaseIds: [],
            };
        }
        const [departmentIds, projectIds] = await Promise.all([
            this.resolveDepartmentTreeIds(input.tenantId, input.membershipId),
            this.resolveVisibleProjectIds(input.tenantId, input.membershipId),
        ]);
        const scope: KnowledgeRetrieveScope = {
            knowledge_base_ids: knowledgeBaseIds,
            department_ids: departmentIds,
            project_ids: projectIds,
        };
        let response: KnowledgeAnswerResponse;
        try {
            response = await this.gateway.answerKnowledge({
                request_id: input.requestId,
                tenant_id: input.tenantId,
                user_id: input.userId,
                query: input.query,
                scope,
                index_version: readIndexVersions().indexVersion,
                embedding_profile: null,
            });
        } catch (error) {
            await this.writeAssistantQueryFailureAudit(input, knowledgeBaseIds, error);
            throw error;
        }
        // ai-service 的 citation 不带文档标题，按 document_id 回查业务文档补齐。
        const titles = await this.resolveDocumentTitles(input.tenantId, response.citations);
        const citations = response.citations.map((citation) => ({
            id: citation.document_id,
            title: titles.get(citation.document_id) ?? '知识库文档',
            snippet: citation.text,
            pageIndex: citation.page_index ?? null,
        }));
        const citationLog = response.citations.map((citation) => ({
            citationId: citation.citation_id,
            documentId: citation.document_id,
            documentVersionId: citation.document_version_id,
            chunkId: citation.chunk_id,
            text: citation.text,
            score: citation.score,
            pageIndex: citation.page_index,
            bbox: citation.bbox,
        }));
        await this.prisma.$transaction(async (transaction) => {
            await transaction.knowledgeQueryLog.create({
                data: {
                    tenantId: input.tenantId,
                    knowledgeBaseId: null,
                    userId: input.userId,
                    query: input.query,
                    answer: response.answer || null,
                    grounded: response.grounded,
                    citations: citationLog as unknown as Prisma.InputJsonValue,
                    latencyMs: response.execution?.latency_ms ?? null,
                    inputTokens: response.execution?.token_usage?.input_tokens ?? null,
                    outputTokens: response.execution?.token_usage?.output_tokens ?? null,
                    totalTokens: response.execution?.token_usage?.total_tokens ?? null,
                    requestId: input.requestId,
                },
            });
            await this.writeAudit(transaction, input, 'KNOWLEDGE_BASE_QUERIED', 'KNOWLEDGE_BASE', null, {
                knowledgeBaseIds,
                grounded: response.grounded,
                insufficientEvidence: response.insufficient_evidence,
                citationCount: citations.length,
                indexVersion: response.index_version,
            });
        });
        return {
            answer: response.answer,
            grounded: response.grounded,
            insufficientEvidence: response.insufficient_evidence,
            citations,
            searchedKnowledgeBaseIds: knowledgeBaseIds,
        };
    }

    /** 租户内未删除的全部知识库 ID；仅供 manage_all 权限短路使用。 */
    private async listTenantKnowledgeBaseIds(tenantId: string): Promise<string[]> {
        const records = await this.prisma.knowledgeBase.findMany({
            where: { tenantId, deletedAt: null },
            select: { id: true },
        });
        return records.map((record) => record.id);
    }

    /** 按 document_id 回查文档标题；缺失的文档回退默认标题。 */
    private async resolveDocumentTitles(
        tenantId: string,
        citations: KnowledgeAnswerResponse['citations'],
    ): Promise<Map<string, string>> {
        const documentIds = [...new Set(citations.map((citation) => citation.document_id))];
        if (documentIds.length === 0) return new Map();
        const documents = await this.prisma.knowledgeDocument.findMany({
            where: { tenantId, id: { in: documentIds } },
            select: { id: true, name: true },
        });
        return new Map(documents.map((document) => [document.id, document.name]));
    }

    private async writeAssistantQueryFailureAudit(
        input: {
            tenantId: string;
            userId: string;
            membershipId: string;
            requestId: string;
        },
        knowledgeBaseIds: string[],
        error: unknown,
    ): Promise<void> {
        await this.prisma.auditLog.create({
            data: {
                tenantId: input.tenantId,
                actorUserId: input.userId,
                actorMembershipId: input.membershipId,
                action: 'KNOWLEDGE_BASE_QUERIED',
                outcome: AuditOutcome.FAILURE,
                resourceType: 'KNOWLEDGE_BASE',
                requestId: input.requestId,
                metadata: {
                    knowledgeBaseIds,
                    errorCode: error instanceof AiServiceInvocationError ? error.code : 'UNKNOWN',
                } as Prisma.InputJsonValue,
            },
        });
    }

    /**
     * 把三层权限实时折叠成可信检索 scope：
     * - knowledge_base_ids 固定为当前知识库（租户隔离由 ai-service 按 tenant_id 强制）；
     * - department_ids 为当前成员所在部门的子树（DEPARTMENT 文档仅本部门及子部门可见）；
     * - project_ids 为当前成员参与的项目（PROJECT 文档仅项目成员可见）；
     * - TENANT/PRIVATE 文档不携带部门/项目属性，白名单不约束它们（PRIVATE 的可见性
     *   由“查询者必须是知识库成员”在入口处保证）；
     * - 空白名单显式传空数组，表示没有任何可授权的部门/项目，只放行不携带该属性的文档。
     */
    private async buildQueryScope(
        tenantId: string,
        membershipId: string,
        knowledgeBaseId: string,
    ): Promise<KnowledgeRetrieveScope> {
        const [departmentIds, projectIds] = await Promise.all([
            this.resolveDepartmentTreeIds(tenantId, membershipId),
            this.resolveVisibleProjectIds(tenantId, membershipId),
        ]);
        return {
            knowledge_base_ids: [knowledgeBaseId],
            department_ids: departmentIds,
            project_ids: projectIds,
        };
    }

    /** 当前成员所在部门及其全部子部门的 ID 列表；未归属任何部门时为空。 */
    private async resolveDepartmentTreeIds(tenantId: string, membershipId: string): Promise<string[]> {
        const membership = await this.prisma.tenantMembership.findFirst({
            where: { id: membershipId, tenantId, deletedAt: null },
            select: { departmentId: true },
        });
        const rootId = membership?.departmentId;
        if (!rootId) return [];
        const departments = await this.prisma.department.findMany({
            where: { tenantId, deletedAt: null },
            select: { id: true, parentId: true },
        });
        const childrenByParent = new Map<string | null, string[]>();
        for (const department of departments) {
            const siblings = childrenByParent.get(department.parentId) ?? [];
            siblings.push(department.id);
            childrenByParent.set(department.parentId, siblings);
        }
        const ids: string[] = [];
        const queue = [rootId];
        while (queue.length > 0) {
            const current = queue.shift() as string;
            ids.push(current);
            queue.push(...(childrenByParent.get(current) ?? []));
        }
        return ids;
    }

    /** 当前成员参与的项目 ID 列表。 */
    private async resolveVisibleProjectIds(tenantId: string, membershipId: string): Promise<string[]> {
        const memberships = await this.prisma.projectMember.findMany({
            where: { tenantId, membershipId, deletedAt: null },
            select: { projectId: true },
        });
        return memberships.map((membership) => membership.projectId);
    }

    private async writeQueryFailureAudit(
        context: ReturnType<TenantContext['require']>,
        knowledgeBaseId: string,
        error: unknown,
    ): Promise<void> {
        await this.prisma.auditLog.create({
            data: {
                tenantId: context.tenantId,
                actorUserId: context.userId,
                actorMembershipId: context.membershipId,
                action: 'KNOWLEDGE_BASE_QUERIED',
                outcome: AuditOutcome.FAILURE,
                resourceType: 'KNOWLEDGE_BASE',
                resourceId: knowledgeBaseId,
                requestId: context.requestId,
                metadata: {
                    errorCode: error instanceof AiServiceInvocationError ? error.code : 'UNKNOWN',
                } as Prisma.InputJsonValue,
            },
        });
    }

    private queryServiceUnavailable(): ServiceUnavailableException {
        return new ServiceUnavailableException({
            code: 'KNOWLEDGE_QUERY_SERVICE_UNAVAILABLE',
            message: 'AI 服务暂不可用，请稍后重试',
        });
    }

    private async listVisibleKnowledgeBaseIds(tenantId: string, userId: string): Promise<string[]> {
        const memberships = await this.prisma.knowledgeBaseMember.findMany({
            where: { tenantId, userId },
            select: { knowledgeBaseId: true },
        });
        return memberships.map((membership) => membership.knowledgeBaseId);
    }

    /** 成员权限达到最低等级的知识库 ID（转存目标库选择过滤，块 7c）。 */
    private async listKnowledgeBaseIdsWithPermission(
        tenantId: string,
        userId: string,
        minimumPermission: KnowledgeBaseMemberPermission,
    ): Promise<string[]> {
        const memberships = await this.prisma.knowledgeBaseMember.findMany({
            where: { tenantId, userId },
            select: { knowledgeBaseId: true, permission: true },
        });
        return memberships
            .filter((membership) => isKnowledgeBaseMemberPermission(membership.permission)
                && permissionRank[membership.permission] >= permissionRank[minimumPermission])
            .map((membership) => membership.knowledgeBaseId);
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
        context: Pick<RequestTenantContext, 'tenantId' | 'userId' | 'membershipId' | 'requestId'>,
        action: string,
        resourceType: string,
        resourceId: string | null,
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

/** 把 ai-service 响应映射为公开 Query 响应形状（snake_case -> camelCase，丢弃 heading_path）。 */
function toKnowledgeQueryResult(response: KnowledgeAnswerResponse): KnowledgeQueryResult {
    return {
        answer: response.answer,
        grounded: response.grounded,
        insufficientEvidence: response.insufficient_evidence,
        citations: response.citations.map((citation) => ({
            citationId: citation.citation_id,
            documentId: citation.document_id,
            documentVersionId: citation.document_version_id,
            chunkId: citation.chunk_id,
            text: citation.text,
            score: citation.score,
            pageIndex: citation.page_index,
            bbox: citation.bbox,
        })),
    };
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
