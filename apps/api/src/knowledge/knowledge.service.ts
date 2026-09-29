import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { AuditOutcome, MembershipStatus, Prisma, UserStatus, VisibilityScope } from '@prisma/client';
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
    AssistantKnowledgeDocumentCandidate,
    AssistantKnowledgeSearchResult,
    KnowledgeBaseMemberListResult,
    KnowledgeBaseMemberPermission,
    KnowledgeBaseMemberResult,
    KnowledgeBaseListResult,
    KnowledgeBaseResult,
    KnowledgeBaseVisibilityScope,
    KnowledgeDocumentStatus,
    KnowledgeQueryResult,
} from './knowledge.types';
import { normalizeKnowledgeBaseName, releasedKnowledgeBaseName } from './knowledge-base-name';

const knowledgeBaseSelect = {
    id: true,
    tenantId: true,
    name: true,
    description: true,
    visibilityScope: true,
    departmentId: true,
    projectId: true,
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
        let visibleIds: string[] | undefined;
        let permissionByKnowledgeBaseId = new Map<string, KnowledgeBaseMemberPermission>();
        if (this.canReadAllKnowledgeBases(context.permissions)) {
            visibleIds = undefined;
        } else {
            const [memberRecords, anchorIds] = await Promise.all([
                this.prisma.knowledgeBaseMember.findMany({
                    where: { tenantId: context.tenantId, userId: context.userId },
                    select: { knowledgeBaseId: true, permission: true },
                }),
                this.listAnchorKnowledgeBaseIds(context.tenantId, context.membershipId),
            ]);
            permissionByKnowledgeBaseId = new Map(
                memberRecords.map((membership) => [
                    membership.knowledgeBaseId,
                    normalizeMemberPermission(membership.permission),
                ]),
            );
            const requiredPermission = query.permission;
            if (requiredPermission) {
                // 达到最低成员等级的知识库；READER 级并入锚点人群（虚拟 READER）。
                const qualified = [...permissionByKnowledgeBaseId.entries()]
                    .filter(([, permission]) => permissionRank[permission] >= permissionRank[requiredPermission])
                    .map(([knowledgeBaseId]) => knowledgeBaseId);
                visibleIds = permissionRank[requiredPermission] <= permissionRank.READER
                    ? [...new Set([...qualified, ...anchorIds])]
                    : qualified;
            } else {
                visibleIds = [...new Set([...permissionByKnowledgeBaseId.keys(), ...anchorIds])];
            }
        }
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
            items: await Promise.all(page.map((record) => this.toKnowledgeBaseResult(
                record,
                this.resolveListedPermission(context.permissions, permissionByKnowledgeBaseId, record.id),
            ))),
            nextCursor: hasNextPage ? page[page.length - 1]?.id ?? null : null,
        };
    }

    /** 列表项的当前用户权限标注：manage_all 恒 MANAGER，成员等级优先，其余（read_all/锚点人群）恒 READER。 */
    private resolveListedPermission(
        permissions: string[],
        permissionByKnowledgeBaseId: Map<string, KnowledgeBaseMemberPermission>,
        knowledgeBaseId: string,
    ): KnowledgeBaseMemberPermission {
        if (permissions.includes('knowledge_base.manage_all')) return 'MANAGER';
        return permissionByKnowledgeBaseId.get(knowledgeBaseId) ?? 'READER';
    }

    /**
     * 助手可见库清单（回答“我有哪些知识库”与转存目标库选择，块 7c）：返回当前用户
     * 可见（成员表显式授权 ∪ 锚点人群虚拟 READER）的全部知识库，并标注每个库的成员权限；
     * 锚点人群恒为 READER，不升级为 EDITOR/MANAGER，转存候选仍只从真实成员中选出。
     * 工具在后台执行，TenantContext 已不可用，因此身份与权限全部显式传入。
     */
    async listKnowledgeBasesForAssistant(input: {
        tenantId: string;
        userId: string;
        membershipId: string;
        permissions: string[];
    }): Promise<AssistantKnowledgeBaseCandidate[]> {
        // manage_all / read_all 短路为租户全部未删除库；manage_all 等效最高权限，read_all 只读。
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
                retrievable: true,
            })));
        }
        if (input.permissions.includes('knowledge_base.read_all')) {
            const records = await this.prisma.knowledgeBase.findMany({
                where: { tenantId: input.tenantId, deletedAt: null },
                select: knowledgeBaseSelect,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: 100,
            });
            return Promise.all(records.map(async (record) => ({
                ...(await this.toKnowledgeBaseResult(record)),
                myPermission: 'READER' as KnowledgeBaseMemberPermission,
                retrievable: true,
            })));
        }
        const [memberRecords, anchorIds] = await Promise.all([
            this.prisma.knowledgeBaseMember.findMany({
                where: { tenantId: input.tenantId, userId: input.userId },
                select: { knowledgeBaseId: true, permission: true },
            }),
            this.listAnchorKnowledgeBaseIds(input.tenantId, input.membershipId),
        ]);
        const permissionByKnowledgeBaseId = new Map(
            memberRecords.map((membership) => [
                membership.knowledgeBaseId,
                normalizeMemberPermission(membership.permission),
            ]),
        );
        const visibleIds = [...new Set([...permissionByKnowledgeBaseId.keys(), ...anchorIds])];
        if (visibleIds.length === 0) return [];
        const records = await this.prisma.knowledgeBase.findMany({
            where: {
                tenantId: input.tenantId,
                deletedAt: null,
                id: { in: visibleIds },
            },
            select: knowledgeBaseSelect,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 100,
        });
        return Promise.all(records.map(async (record) => ({
            ...(await this.toKnowledgeBaseResult(record)),
            myPermission: permissionByKnowledgeBaseId.get(record.id) ?? 'READER',
            // 真实成员库参与检索；锚点人群虚拟 READER 库仅可见、不可检索
            // （与 searchKnowledgeForAssistant 的成员库检索范围一致）。
            retrievable: permissionByKnowledgeBaseId.has(record.id),
        })));
    }

    async createKnowledgeBase(input: CreateKnowledgeBaseDto): Promise<KnowledgeBaseResult> {
        const context = this.tenantContext.require();
        return this.createKnowledgeBaseRecord({
            tenantId: context.tenantId,
            userId: context.userId,
            membershipId: context.membershipId,
            requestId: context.requestId,
        }, input);
    }

    /**
     * 助手知识库文档清单：回答「我的知识库里有哪些文档」。
     *
     * 可见范围与 `searchKnowledgeForAssistant` 完全一致——真实成员库（或
     * manage_all/read_all 短路下的全租户库）。刻意不含锚点人群虚拟 READER 库：
     * 项目约定「内容触达必须真实成员或全读权限码」，锚点只给页面可见性，
     * 否则会出现「列得出来、检索不到」的不一致。
     *
     * 只返回展示所需的业务字段，不含文件对象 ID、COS 对象键等内部标识。
     */
    async listKnowledgeDocumentsForAssistant(input: {
        tenantId: string;
        userId: string;
        permissions: string[];
        knowledgeBaseName?: string;
        keyword?: string;
        limit: number;
    }): Promise<AssistantKnowledgeDocumentCandidate[]> {
        const knowledgeBaseIds = this.canReadAllKnowledgeBases(input.permissions)
            ? await this.listTenantKnowledgeBaseIds(input.tenantId)
            : await this.listMemberKnowledgeBaseIds(input.tenantId, input.userId);
        if (knowledgeBaseIds.length === 0) return [];
        const bases = await this.prisma.knowledgeBase.findMany({
            where: { tenantId: input.tenantId, deletedAt: null, id: { in: knowledgeBaseIds } },
            select: { id: true, name: true },
        });
        if (bases.length === 0) return [];
        const requestedName = input.knowledgeBaseName?.trim().toLowerCase();
        const scopedBases = requestedName
            ? bases.filter((base) => base.name.toLowerCase().includes(requestedName))
            : bases;
        if (scopedBases.length === 0) return [];
        const nameByKnowledgeBaseId = new Map(bases.map((base) => [base.id, base.name]));
        const keyword = input.keyword?.trim();
        const records = await this.prisma.knowledgeDocument.findMany({
            where: {
                tenantId: input.tenantId,
                deletedAt: null,
                knowledgeBaseId: { in: scopedBases.map((base) => base.id) },
                name: keyword ? { contains: keyword, mode: 'insensitive' } : undefined,
            },
            select: { id: true, name: true, status: true, knowledgeBaseId: true, updatedAt: true },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: input.limit,
        });
        return records.map((record) => ({
            documentId: record.id,
            name: record.name,
            status: record.status as KnowledgeDocumentStatus,
            knowledgeBaseId: record.knowledgeBaseId,
            knowledgeBaseName: nameByKnowledgeBaseId.get(record.knowledgeBaseId) ?? '',
            updatedAt: record.updatedAt.toISOString(),
        }));
    }

    /**
     * 助手创建知识库（工具后台执行，TenantContext 已不可用）：与公开接口共用同一
     * 事务体，创建者自动成为 MANAGER 并写 KNOWLEDGE_BASE_CREATED 审计。
     * 调用方必须已通过 knowledge_base.create 权限码校验（ToolPolicy）。
     * 助手创建不指定锚点，默认 PRIVATE（仅成员），归属调整走知识管理页面。
     */
    async createKnowledgeBaseForAssistant(input: {
        tenantId: string;
        userId: string;
        membershipId: string;
        requestId: string;
        name: string;
        description?: string | null;
    }): Promise<KnowledgeBaseResult> {
        return this.createKnowledgeBaseRecord({
            tenantId: input.tenantId,
            userId: input.userId,
            membershipId: input.membershipId,
            requestId: input.requestId,
        }, input);
    }

    /**
     * 建库前的名称可用性预检（只读，不产生副作用）。
     *
     * 存在的理由：草稿生成后用户点确认才发现重名，草稿就白建了，用户还得重新
     * 描述需求。提前拒绝能把「重名」变成模型可纠正的工具拒绝，模型可以直接问
     * 用户要新名称。注意这只是降低概率：唯一约束仍是最终权威，并发创建靠它兜住。
     */
    async isKnowledgeBaseNameAvailable(tenantId: string, name: string): Promise<boolean> {
        const existing = await this.prisma.knowledgeBase.findFirst({
            where: { tenantId, normalizedName: normalizeKnowledgeBaseName(name), deletedAt: null },
            select: { id: true },
        });
        return !existing;
    }

    private async createKnowledgeBaseRecord(
        context: Pick<RequestTenantContext, 'tenantId' | 'userId' | 'membershipId' | 'requestId'>,
        input: Pick<CreateKnowledgeBaseDto, 'name' | 'description' | 'visibilityScope' | 'departmentId' | 'projectId'>,
    ): Promise<KnowledgeBaseResult> {
        const name = input.name.trim();
        const description = normalizeDescription(input.description);
        const scope = await this.resolveKnowledgeBaseScope(
            context.tenantId,
            input.visibilityScope ?? 'PRIVATE',
            input.departmentId,
            input.projectId,
        );
        const record = await this.guardKnowledgeBaseName(() => this.prisma.$transaction(async (transaction) => {
            const knowledgeBase = await transaction.knowledgeBase.create({
                data: {
                    tenantId: context.tenantId,
                    name,
                    normalizedName: normalizeKnowledgeBaseName(name),
                    description,
                    visibilityScope: scope.visibilityScope,
                    departmentId: scope.departmentId,
                    projectId: scope.projectId,
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
                visibilityScope: scope.visibilityScope,
                departmentId: scope.departmentId,
                projectId: scope.projectId,
            });
            return knowledgeBase;
        }));
        return { ...this.toKnowledgeBaseScopeShape(record), memberCount: 1, myPermission: 'MANAGER' as KnowledgeBaseMemberPermission };
    }

    async getKnowledgeBase(knowledgeBaseId: string): Promise<KnowledgeBaseResult> {
        const context = this.tenantContext.require();
        const knowledgeBase = await this.requireKnowledgeBase(context.tenantId, knowledgeBaseId);
        await this.requireKnowledgeBasePermission(knowledgeBaseId, 'READER');
        return this.toKnowledgeBaseResult(knowledgeBase, await this.resolveCurrentMemberPermission(knowledgeBaseId));
    }

    /** 当前用户对该库的成员权限标注：manage_all 恒 MANAGER，成员等级优先，其余（read_all/锚点人群）恒 READER。 */
    private async resolveCurrentMemberPermission(knowledgeBaseId: string): Promise<KnowledgeBaseMemberPermission> {
        const context = this.tenantContext.require();
        if (context.permissions.includes('knowledge_base.manage_all')) return 'MANAGER';
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
        return member ? normalizeMemberPermission(member.permission) : 'READER';
    }

    async updateKnowledgeBase(knowledgeBaseId: string, input: UpdateKnowledgeBaseDto): Promise<KnowledgeBaseResult> {
        const context = this.tenantContext.require();
        if (input.name === undefined && input.description === undefined
            && input.visibilityScope === undefined && input.departmentId === undefined && input.projectId === undefined) {
            throw new BadRequestException({ code: 'KNOWLEDGE_BASE_UPDATE_EMPTY', message: '至少提供一个需要修改的字段' });
        }
        const current = await this.requireKnowledgeBase(context.tenantId, knowledgeBaseId);
        await this.requireKnowledgeBasePermission(knowledgeBaseId, 'MANAGER');
        // 锚点修改（块 8）：任一归属字段提供时整体解析校验，未提供的字段保持现值。
        const hasScopeChange = input.visibilityScope !== undefined
            || input.departmentId !== undefined
            || input.projectId !== undefined;
        const scope = hasScopeChange
            ? await this.resolveKnowledgeBaseScope(
                context.tenantId,
                input.visibilityScope ?? toPublicKnowledgeBaseScope(current.visibilityScope),
                input.departmentId !== undefined ? input.departmentId : current.departmentId,
                input.projectId !== undefined ? input.projectId : current.projectId,
            )
            : null;
        const data: Prisma.KnowledgeBaseUncheckedUpdateManyInput = {
            version: { increment: 1 },
            updatedBy: context.userId,
        };
        if (input.name !== undefined) {
            data.name = input.name.trim();
            data.normalizedName = normalizeKnowledgeBaseName(input.name);
        }
        if (input.description !== undefined) data.description = normalizeDescription(input.description);
        if (scope) {
            data.visibilityScope = scope.visibilityScope;
            data.departmentId = scope.departmentId;
            data.projectId = scope.projectId;
        }
        await this.guardKnowledgeBaseName(() => this.prisma.$transaction(async (transaction) => {
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
                before: {
                    name: current.name,
                    description: current.description,
                    visibilityScope: current.visibilityScope,
                    departmentId: current.departmentId,
                    projectId: current.projectId,
                },
                after: {
                    name: input.name === undefined ? current.name : input.name.trim(),
                    description: input.description === undefined ? current.description : normalizeDescription(input.description),
                    visibilityScope: scope ? scope.visibilityScope : current.visibilityScope,
                    departmentId: scope ? scope.departmentId : current.departmentId,
                    projectId: scope ? scope.projectId : current.projectId,
                },
            });
        }));
        return this.getKnowledgeBase(knowledgeBaseId);
    }

    async deleteKnowledgeBase(knowledgeBaseId: string, input: DeleteKnowledgeBaseQueryDto): Promise<void> {
        const context = this.tenantContext.require();
        const current = await this.requireKnowledgeBase(context.tenantId, knowledgeBaseId);
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
                    // 软删除必须释放名称：否则用户删掉同名库后再建会被唯一约束拒绝。
                    normalizedName: releasedKnowledgeBaseName(
                        normalizeKnowledgeBaseName(current.name),
                        knowledgeBaseId,
                    ),
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
        options: { allowAnchorReader?: boolean } = {},
    ): Promise<KnowledgeBaseAccess> {
        const context = this.tenantContext.require();
        const knowledgeBase = await this.requireKnowledgeBase(context.tenantId, knowledgeBaseId);
        await this.requireKnowledgeBasePermission(knowledgeBaseId, minimumPermission, options);
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
        // read_all 只读：仅放行 READER 等级需求，写操作仍按成员等级校验。
        if (input.permissions.includes('knowledge_base.read_all')
            && permissionRank[input.minimumPermission] <= permissionRank.READER) {
            return knowledgeBase;
        }
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
        // AI 问答触达文档内容：锚点人群虚拟 READER 不放行（ai-service 检索侧无法按
        // scope 排除 PRIVATE 文档，PRIVATE 收窄依赖“查询者必须是知识库成员”的入口保证）；
        // read_all / manage_all 是全租户特权码，仍按只读短路。
        await this.requireKnowledgeBaseAccess(knowledgeBaseId, 'READER', { allowAnchorReader: false });
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
        const knowledgeBaseIds = this.canReadAllKnowledgeBases(input.permissions)
            ? await this.listTenantKnowledgeBaseIds(input.tenantId)
            : await this.listMemberKnowledgeBaseIds(input.tenantId, input.userId);
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
        // ai-service 的 citation 不带文档标题与所属库，按 document_id 回查业务文档补齐。
        const documents = await this.resolveCitationDocuments(input.tenantId, response.citations);
        // 当前用户可删除文档的库集合：manage_all 覆盖全部可检索库，否则按库内成员等级（EDITOR 及以上）。
        const deletableKnowledgeBaseIds = new Set(
            input.permissions.includes('knowledge_base.manage_all')
                ? knowledgeBaseIds
                : (await this.prisma.knowledgeBaseMember.findMany({
                    where: {
                        tenantId: input.tenantId,
                        userId: input.userId,
                        permission: { in: ['EDITOR', 'MANAGER'] },
                    },
                    select: { knowledgeBaseId: true },
                })).map((member) => member.knowledgeBaseId),
        );
        const citations = response.citations.map((citation) => {
            const meta = documents.get(citation.document_id);
            const knowledgeBaseId = meta?.knowledgeBaseId ?? null;
            return {
                id: citation.document_id,
                title: meta?.name ?? '知识库文档',
                snippet: citation.text,
                pageIndex: citation.page_index ?? null,
                knowledgeBaseId,
                deletable: knowledgeBaseId !== null && deletableKnowledgeBaseIds.has(knowledgeBaseId),
            };
        });
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

    /** 租户内未删除的全部知识库 ID；仅供 manage_all / read_all 权限短路使用。 */
    private async listTenantKnowledgeBaseIds(tenantId: string): Promise<string[]> {
        const records = await this.prisma.knowledgeBase.findMany({
            where: { tenantId, deletedAt: null },
            select: { id: true },
        });
        return records.map((record) => record.id);
    }

    /** 拥有 manage_all（隐含读）或 read_all 即可读租户全部知识库。 */
    private canReadAllKnowledgeBases(permissions: string[]): boolean {
        return permissions.includes('knowledge_base.manage_all')
            || permissions.includes('knowledge_base.read_all');
    }

    /** 按 document_id 回查文档标题与所属库；缺失的文档回退默认标题。 */
    private async resolveCitationDocuments(
        tenantId: string,
        citations: KnowledgeAnswerResponse['citations'],
    ): Promise<Map<string, { name: string; knowledgeBaseId: string }>> {
        const documentIds = [...new Set(citations.map((citation) => citation.document_id))];
        if (documentIds.length === 0) return new Map();
        const documents = await this.prisma.knowledgeDocument.findMany({
            where: { tenantId, id: { in: documentIds } },
            select: { id: true, name: true, knowledgeBaseId: true },
        });
        return new Map(documents.map((document) => [document.id, { name: document.name, knowledgeBaseId: document.knowledgeBaseId }]));
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

    /** 成员表显式授权的库 ID：深度使用（AI 问答/检索）与转存候选的内容触达必须真实成员或全读权限码。 */
    private async listMemberKnowledgeBaseIds(tenantId: string, userId: string): Promise<string[]> {
        const memberships = await this.prisma.knowledgeBaseMember.findMany({
            where: { tenantId, userId },
            select: { knowledgeBaseId: true },
        });
        return memberships.map((membership) => membership.knowledgeBaseId);
    }

    /**
     * 锚点人群可见库 ID（虚拟 READER，块 8）：TENANT 库全员；DEPARTMENT 库对部门树
     * （含子部门，与 DataScope.DEPARTMENT_TREE 同口径）成员；PROJECT 库对项目成员。
     */
    private async listAnchorKnowledgeBaseIds(tenantId: string, membershipId: string): Promise<string[]> {
        const scopedRecords = await this.prisma.knowledgeBase.findMany({
            where: { tenantId, deletedAt: null, visibilityScope: { not: 'PRIVATE' } },
            select: { id: true, visibilityScope: true, departmentId: true, projectId: true },
        });
        if (scopedRecords.length === 0) return [];
        const [departmentIds, projectIds] = await Promise.all([
            this.resolveDepartmentTreeIds(tenantId, membershipId),
            this.resolveVisibleProjectIds(tenantId, membershipId),
        ]);
        return scopedRecords
            .filter((record) =>
                record.visibilityScope === 'TENANT'
                || (record.visibilityScope === 'DEPARTMENT' && record.departmentId !== null && departmentIds.includes(record.departmentId))
                || (record.visibilityScope === 'PROJECT' && record.projectId !== null && projectIds.includes(record.projectId)))
            .map((record) => record.id);
    }

    /** 当前成员是否为该库的锚点人群（虚拟 READER）。 */
    private async isAnchorReader(tenantId: string, membershipId: string, knowledgeBaseId: string): Promise<boolean> {
        const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
            where: { id: knowledgeBaseId, tenantId, deletedAt: null },
            select: { visibilityScope: true, departmentId: true, projectId: true },
        });
        if (!knowledgeBase || knowledgeBase.visibilityScope === 'PRIVATE') return false;
        if (knowledgeBase.visibilityScope === 'TENANT') return true;
        const [departmentIds, projectIds] = await Promise.all([
            this.resolveDepartmentTreeIds(tenantId, membershipId),
            this.resolveVisibleProjectIds(tenantId, membershipId),
        ]);
        if (knowledgeBase.visibilityScope === 'DEPARTMENT' && knowledgeBase.departmentId) {
            return departmentIds.includes(knowledgeBase.departmentId);
        }
        if (knowledgeBase.visibilityScope === 'PROJECT' && knowledgeBase.projectId) {
            return projectIds.includes(knowledgeBase.projectId);
        }
        return false;
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
        options: { allowAnchorReader?: boolean } = {},
    ): Promise<void> {
        const context = this.tenantContext.require();
        if (context.permissions.includes('knowledge_base.manage_all')) return;
        // read_all 只读：仅放行 READER 等级需求，写操作仍按成员等级校验。
        if (context.permissions.includes('knowledge_base.read_all')
            && permissionRank[minimumPermission] <= permissionRank.READER) {
            return;
        }
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
        if (member) {
            if (!isKnowledgeBaseMemberPermission(member.permission)
                || permissionRank[member.permission] < permissionRank[minimumPermission]) {
                throw new ForbiddenException({
                    code: 'KNOWLEDGE_BASE_MEMBER_PERMISSION_DENIED',
                    message: '知识库成员权限不足',
                    details: { required: minimumPermission },
                });
            }
            return;
        }
        // 非成员：锚点人群虚拟 READER（块 8）仅覆盖库级浏览（列表/详情/文档列表，READER 需求），
        // 恒为 READER 级、不升级；AI 问答（allowAnchorReader=false）与写操作仍要求真实成员，
        // PRIVATE 文档的内容收窄依赖“查询者必须是知识库成员”的入口保证。
        if (options.allowAnchorReader !== false
            && permissionRank[minimumPermission] <= permissionRank.READER
            && await this.isAnchorReader(context.tenantId, context.membershipId, knowledgeBaseId)) {
            return;
        }
        throw this.knowledgeBaseNotFound();
    }

    /**
     * 解析库级归属（块 8）：DEPARTMENT 必填部门、PROJECT 必填项目且都属于当前租户；
     * PRIVATE（仅成员）/ TENANT（全员）不携带锚点。锚点二选一互斥，创建/修改共用。
     */
    private async resolveKnowledgeBaseScope(
        tenantId: string,
        visibilityScope: KnowledgeBaseVisibilityScope,
        departmentId: string | null | undefined,
        projectId: string | null | undefined,
    ): Promise<{ visibilityScope: VisibilityScope; departmentId: string | null; projectId: string | null }> {
        switch (visibilityScope) {
            case 'DEPARTMENT': {
                if (!departmentId) throw this.scopeInvalid('归属为 DEPARTMENT 时必须提供 departmentId');
                await this.requireDepartment(tenantId, departmentId);
                return { visibilityScope: VisibilityScope.DEPARTMENT, departmentId, projectId: null };
            }
            case 'PROJECT': {
                if (!projectId) throw this.scopeInvalid('归属为 PROJECT 时必须提供 projectId');
                await this.requireProject(tenantId, projectId);
                return { visibilityScope: VisibilityScope.PROJECT, departmentId: null, projectId };
            }
            case 'PRIVATE':
                return { visibilityScope: VisibilityScope.PRIVATE, departmentId: null, projectId: null };
            case 'TENANT':
                return { visibilityScope: VisibilityScope.TENANT, departmentId: null, projectId: null };
        }
    }

    private async requireDepartment(tenantId: string, departmentId: string): Promise<void> {
        const department = await this.prisma.department.findFirst({
            where: { id: departmentId, tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!department) throw this.scopeInvalid('归属关联的部门不存在或不属于当前租户');
    }

    private async requireProject(tenantId: string, projectId: string): Promise<void> {
        const project = await this.prisma.project.findFirst({
            where: { id: projectId, tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!project) throw this.scopeInvalid('归属关联的项目不存在或不属于当前租户');
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

    private async toKnowledgeBaseResult(
        record: KnowledgeBaseRecord,
        myPermission: KnowledgeBaseMemberPermission = 'READER',
    ): Promise<KnowledgeBaseResult> {
        const memberCount = await this.prisma.knowledgeBaseMember.count({
            where: { tenantId: record.tenantId, knowledgeBaseId: record.id },
        });
        return { ...this.toKnowledgeBaseScopeShape(record), memberCount, myPermission };
    }

    /** 把 Prisma enum（含预留 CUSTOM）收敛为公开可见范围四值。 */
    private toKnowledgeBaseScopeShape<T extends { visibilityScope: VisibilityScope }>(
        record: T,
    ): Omit<T, 'visibilityScope'> & { visibilityScope: KnowledgeBaseVisibilityScope } {
        return { ...record, visibilityScope: toPublicKnowledgeBaseScope(record.visibilityScope) };
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

    private scopeInvalid(message: string): BadRequestException {
        return new BadRequestException({ code: 'KNOWLEDGE_BASE_SCOPE_INVALID', message });
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

    /**
     * 同租户内知识库重名。
     *
     * 文案必须能让用户直接照做（换名字）：这条消息会经助手确认流展示到界面，
     * 也可能被回喂给模型，所以不能出现约束名、字段名等内部信息。
     */
    private nameConflict(): ConflictException {
        return new ConflictException({
            code: 'KNOWLEDGE_BASE_NAME_TAKEN',
            message: '当前租户下已存在同名知识库，请换一个名称',
        });
    }

    /**
     * 知识库创建/改名统一收口：把唯一约束冲突翻译成可执行的重名提示。
     *
     * 唯一约束仍是最终权威——应用层的可用性预检只能降低概率，并发创建时
     * 依然要靠数据库拒绝，因此这里必须兜住 P2002。
     */
    private async guardKnowledgeBaseName<T>(operation: () => Promise<T>): Promise<T> {
        try {
            return await operation();
        } catch (error) {
            if (isPrismaError(error, 'P2002')) throw this.nameConflict();
            throw error;
        }
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

/** 把 Prisma 的库级可见范围（含预留 CUSTOM）收敛为公开四值。 */
function toPublicKnowledgeBaseScope(value: VisibilityScope): KnowledgeBaseVisibilityScope {
    return value === VisibilityScope.DEPARTMENT || value === VisibilityScope.PROJECT
        || value === VisibilityScope.TENANT
        ? value
        : 'PRIVATE';
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
