import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import {
    AclSubjectType,
    AuditOutcome,
    DocumentVisibility,
    KnowledgeDocumentSourceType,
    Prisma,
    VisibilityScope,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { FileService } from '../file/file.service';
import { TenantContext } from '../tenant/tenant-context';
import { KnowledgeService } from './knowledge.service';
import {
    CreateKnowledgeDocumentDto,
    CreateKnowledgeDocumentVersionDto,
    ListKnowledgeDocumentsQueryDto,
} from './dto';
import {
    KnowledgeDocumentListResult,
    KnowledgeDocumentResult,
    KnowledgeDocumentStatus,
    KnowledgeDocumentVisibilityScope,
} from './knowledge.types';
import { KnowledgeIndexingService } from './knowledge-indexing.service';

const knowledgeDocumentSelect = {
    id: true,
    tenantId: true,
    knowledgeBaseId: true,
    fileObjectId: true,
    name: true,
    status: true,
    currentVersionId: true,
    retryCount: true,
    lastError: true,
    createdBy: true,
    updatedBy: true,
    version: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.KnowledgeDocumentSelect;

type KnowledgeDocumentRecord = Prisma.KnowledgeDocumentGetPayload<{ select: typeof knowledgeDocumentSelect }>;

interface ResolvedVisibilityScope {
    visibilityScope: VisibilityScope;
    departmentId: string | null;
    projectId: string | null;
}

@Injectable()
export class KnowledgeDocumentService {
    private readonly logger = new Logger(KnowledgeDocumentService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
        private readonly knowledgeService: KnowledgeService,
        private readonly fileService: FileService,
        private readonly indexingService: KnowledgeIndexingService,
    ) { }

    async listDocuments(
        knowledgeBaseId: string,
        query: ListKnowledgeDocumentsQueryDto,
    ): Promise<KnowledgeDocumentListResult> {
        const context = this.tenantContext.require();
        await this.knowledgeService.requireKnowledgeBaseAccess(knowledgeBaseId, 'READER');
        if (query.cursor) {
            const cursorExists = await this.prisma.knowledgeDocument.findFirst({
                where: { id: query.cursor, tenantId: context.tenantId, knowledgeBaseId, deletedAt: null },
                select: { id: true },
            });
            if (!cursorExists) throw this.invalidCursor();
        }
        const keyword = query.keyword?.trim();
        const records = await this.prisma.knowledgeDocument.findMany({
            where: {
                tenantId: context.tenantId,
                knowledgeBaseId,
                deletedAt: null,
                name: keyword ? { contains: keyword, mode: 'insensitive' } : undefined,
            },
            select: knowledgeDocumentSelect,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        const hasNextPage = records.length > query.limit;
        const page = hasNextPage ? records.slice(0, query.limit) : records;
        return {
            items: await Promise.all(page.map((record) => this.toDocumentResult(record))),
            nextCursor: hasNextPage ? page[page.length - 1]?.id ?? null : null,
        };
    }

    async createDocument(
        knowledgeBaseId: string,
        input: CreateKnowledgeDocumentDto,
    ): Promise<KnowledgeDocumentResult> {
        const context = this.tenantContext.require();
        const hasFileObject = Boolean(input.fileObjectId);
        const hasSource = Boolean(input.sourceType || input.sourceId);
        if (hasFileObject && hasSource) throw this.sourceAmbiguous();
        if (hasSource && !(input.sourceType && input.sourceId)) throw this.sourceIncomplete();
        if (!hasFileObject && !hasSource) throw this.sourceRequired();
        if (hasSource) {
            // 转存路径（块 7c）：来源快照物化 + 幂等追加版本，与人工上传同构。
            return this.saveFromSource({
                tenantId: context.tenantId,
                userId: context.userId,
                membershipId: context.membershipId,
                permissions: context.permissions,
                requestId: context.requestId,
            }, {
                knowledgeBaseId,
                sourceType: input.sourceType as KnowledgeDocumentSourceType,
                sourceId: input.sourceId as string,
                name: input.name,
                visibilityScope: input.visibilityScope,
                departmentId: input.departmentId,
                projectId: input.projectId,
            });
        }
        await this.knowledgeService.requireKnowledgeBaseAccess(knowledgeBaseId, 'EDITOR');
        const scope = await this.resolveVisibilityScope(
            context.tenantId,
            input.visibilityScope,
            input.departmentId,
            input.projectId,
        );
        const file = await this.requireAvailableFile(context.tenantId, input.fileObjectId as string);
        const name = input.name?.trim() || file.originalName;
        try {
            const documentId = await this.prisma.$transaction(async (transaction) => {
                const created = await transaction.knowledgeDocument.create({
                    data: {
                        tenantId: context.tenantId,
                        knowledgeBaseId,
                        fileObjectId: file.id,
                        name,
                        createdBy: context.userId,
                        updatedBy: context.userId,
                    },
                    select: { id: true },
                });
                const version = await transaction.documentVersion.create({
                    data: {
                        tenantId: context.tenantId,
                        documentId: created.id,
                        fileObjectId: file.id,
                        versionNumber: 1,
                        visibilityScope: scope.visibilityScope,
                        departmentId: scope.departmentId,
                        projectId: scope.projectId,
                        createdBy: context.userId,
                    },
                    select: { id: true },
                });
                await transaction.knowledgeDocument.update({
                    where: { id: created.id },
                    data: { currentVersionId: version.id },
                });
                await this.writeAudit(transaction, context, 'KNOWLEDGE_DOCUMENT_CREATED', created.id, {
                    knowledgeBaseId,
                    name,
                    fileObjectId: file.id,
                    documentVersionId: version.id,
                    visibilityScope: scope.visibilityScope,
                });
                return created.id;
            });
            void this.indexingService.kick();
            return this.requireDocument(knowledgeBaseId, documentId);
        } catch (error) {
            if (isUniqueConstraintError(error)) throw this.fileObjectInUse();
            throw error;
        }
    }

    /**
     * 对话数据转知识库（块 7c）：把附件 / AI 生成文档 / 对话消息转存为知识库文档。
     * 转存是写入操作，门槛为 EDITOR 成员权限；身份上下文显式传入，工具后台执行可用。
     * 同源重复转存按 (tenantId, sourceType, sourceId) 锚定命中已有文档，追加新版本而非新建。
     */
    async saveFromSource(
        actor: KnowledgeSourceSaveActor,
        input: KnowledgeSourceSaveInput,
    ): Promise<KnowledgeDocumentResult> {
        await this.knowledgeService.assertKnowledgeBaseMemberPermission({
            tenantId: actor.tenantId,
            userId: actor.userId,
            permissions: actor.permissions,
            knowledgeBaseId: input.knowledgeBaseId,
            minimumPermission: 'EDITOR',
        });
        const scope = await this.resolveVisibilityScope(
            actor.tenantId,
            input.visibilityScope,
            input.departmentId,
            input.projectId,
        );
        const existing = await this.findSourceDocument(actor.tenantId, input.sourceType, input.sourceId);
        if (existing) {
            if (existing.knowledgeBaseId !== input.knowledgeBaseId) throw this.sourceAlreadySaved();
            return this.appendSourceVersion(actor, {
                knowledgeBaseId: input.knowledgeBaseId,
                documentId: existing.id,
                previousVersionId: existing.currentVersionId,
                sourceType: input.sourceType,
                sourceId: input.sourceId,
                name: input.name,
                scope,
            });
        }
        // 同源锚定记录可能已被软删除：唯一约束仍被占用，新建会撞锚点冲突。
        // 用户重新转存同一来源（同一库）时恢复该文档并追加新版本，符合「重新存入」预期。
        const deleted = await this.findSourceDocument(actor.tenantId, input.sourceType, input.sourceId, true);
        if (deleted) {
            if (deleted.knowledgeBaseId !== input.knowledgeBaseId) throw this.sourceAlreadySaved();
            await this.restoreSourceDocument(actor, input.knowledgeBaseId, deleted.id);
            return this.appendSourceVersion(actor, {
                knowledgeBaseId: input.knowledgeBaseId,
                documentId: deleted.id,
                previousVersionId: deleted.currentVersionId,
                sourceType: input.sourceType,
                sourceId: input.sourceId,
                name: input.name,
                scope,
            });
        }
        const resolved = await this.resolveSourceSnapshot(actor, {
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            name: input.name,
        });
        try {
            const documentId = await this.createSourceDocument(actor, input, scope, resolved);
            void this.indexingService.kick();
            return this.requireDocumentAsActor(actor, input.knowledgeBaseId, documentId);
        } catch (error) {
            if (isSourceAnchorConflict(error)) {
                // 并发下同源已创建：回读锚定文档改走追加版本。
                const raced = await this.findSourceDocument(actor.tenantId, input.sourceType, input.sourceId);
                if (!raced) throw error;
                if (raced.knowledgeBaseId !== input.knowledgeBaseId) throw this.sourceAlreadySaved();
                return this.appendSourceVersion(actor, {
                    knowledgeBaseId: input.knowledgeBaseId,
                    documentId: raced.id,
                    previousVersionId: raced.currentVersionId,
                    sourceType: input.sourceType,
                    sourceId: input.sourceId,
                    name: input.name,
                    scope,
                });
            }
            if (isUniqueConstraintError(error)) throw this.fileObjectInUse();
            throw error;
        }
    }

    /**
     * 助手内容直存（块 7c 扩展）：把模型整理好的内容文本（用户口述 / AI 整理）直接
     * 物化为知识库文档，不锚定来源资源，每次直存都是新文档。写入门槛同为 EDITOR，
     * 身份上下文显式传入，工具后台执行可用。
     */
    async saveDirectContent(
        actor: KnowledgeSourceSaveActor,
        input: {
            knowledgeBaseId: string;
            content: string;
            name?: string;
            visibilityScope: KnowledgeDocumentVisibilityScope;
            departmentId?: string | null;
            projectId?: string | null;
        },
    ): Promise<KnowledgeDocumentResult> {
        await this.knowledgeService.assertKnowledgeBaseMemberPermission({
            tenantId: actor.tenantId,
            userId: actor.userId,
            permissions: actor.permissions,
            knowledgeBaseId: input.knowledgeBaseId,
            minimumPermission: 'EDITOR',
        });
        const scope = await this.resolveVisibilityScope(
            actor.tenantId,
            input.visibilityScope,
            input.departmentId,
            input.projectId,
        );
        const name = input.name?.trim() || `对话内容 ${formatSnapshotTime(new Date())}`;
        const fileObjectId = await this.fileService.createMaterializedFile({
            tenantId: actor.tenantId,
            userId: actor.userId,
            membershipId: actor.membershipId,
            requestId: actor.requestId,
            name: `${sanitizeFileName(name)}.md`,
            mimeType: 'text/markdown',
            content: Buffer.from(input.content, 'utf8'),
        });
        try {
            const documentId = await this.prisma.$transaction(async (transaction) => {
                const created = await transaction.knowledgeDocument.create({
                    data: {
                        tenantId: actor.tenantId,
                        knowledgeBaseId: input.knowledgeBaseId,
                        fileObjectId,
                        name,
                        createdBy: actor.userId,
                        updatedBy: actor.userId,
                    },
                    select: { id: true },
                });
                const version = await transaction.documentVersion.create({
                    data: {
                        tenantId: actor.tenantId,
                        documentId: created.id,
                        fileObjectId,
                        versionNumber: 1,
                        visibilityScope: scope.visibilityScope,
                        departmentId: scope.departmentId,
                        projectId: scope.projectId,
                        createdBy: actor.userId,
                    },
                    select: { id: true },
                });
                await transaction.knowledgeDocument.update({
                    where: { id: created.id },
                    data: { currentVersionId: version.id },
                });
                await this.writeAudit(transaction, actor, 'KNOWLEDGE_DOCUMENT_CREATED', created.id, {
                    knowledgeBaseId: input.knowledgeBaseId,
                    name,
                    fileObjectId,
                    documentVersionId: version.id,
                    visibilityScope: scope.visibilityScope,
                    directContent: true,
                });
                return created.id;
            });
            void this.indexingService.kick();
            return this.requireDocumentAsActor(actor, input.knowledgeBaseId, documentId);
        } catch (error) {
            if (isUniqueConstraintError(error)) throw this.fileObjectInUse();
            throw error;
        }
    }

    /** 解析来源为物化快照：FILE_OBJECT 直接复用，DOCUMENT/MESSAGE 物化文本快照到 COS。 */
    private async resolveSourceSnapshot(
        actor: KnowledgeSourceSaveActor,
        input: { sourceType: KnowledgeDocumentSourceType; sourceId: string; name?: string },
    ): Promise<{ fileObjectId: string; name: string }> {
        switch (input.sourceType) {
            case 'FILE_OBJECT': {
                const file = await this.requireAvailableFile(actor.tenantId, input.sourceId);
                return { fileObjectId: file.id, name: input.name?.trim() || file.originalName };
            }
            case 'DOCUMENT': {
                const document = await this.requireReadableDocument(actor, input.sourceId);
                const name = input.name?.trim() || document.title;
                const fileObjectId = await this.fileService.createMaterializedFile({
                    tenantId: actor.tenantId,
                    userId: actor.userId,
                    membershipId: actor.membershipId,
                    requestId: actor.requestId,
                    name: `${sanitizeFileName(name)}.md`,
                    mimeType: 'text/markdown',
                    content: Buffer.from(document.content, 'utf8'),
                });
                return { fileObjectId, name };
            }
            case 'MESSAGE': {
                const message = await this.requireSavableMessage(actor, input.sourceId);
                const name = input.name?.trim() || `对话消息 ${formatSnapshotTime(message.createdAt)}`;
                const fileObjectId = await this.fileService.createMaterializedFile({
                    tenantId: actor.tenantId,
                    userId: actor.userId,
                    membershipId: actor.membershipId,
                    requestId: actor.requestId,
                    name: `${sanitizeFileName(name)}.md`,
                    mimeType: 'text/markdown',
                    content: Buffer.from(message.content, 'utf8'),
                });
                return { fileObjectId, name };
            }
        }
    }

    /** AI 生成文档来源：必须存在且当前用户可读（租户 + 资源访问控制），防止把他人文档转存。 */
    private async requireReadableDocument(
        actor: KnowledgeSourceSaveActor,
        documentId: string,
    ): Promise<{ title: string; content: string }> {
        const document = await this.prisma.managedDocument.findFirst({
            where: { id: documentId, tenantId: actor.tenantId, deletedAt: null },
            include: { resource: { include: { acls: true } } },
        });
        if (!document || !actor.permissions.includes('document.read')) throw this.sourceDocumentNotFound();
        const roleIds = await this.resolveRoleIds(actor.tenantId, actor.membershipId);
        const now = new Date();
        const accessible = actor.permissions.includes('document.manage_all')
            || document.resource.ownerMembershipId === actor.membershipId
            || document.visibility === DocumentVisibility.TENANT
            || document.resource.acls.some((entry) => entry.tenantId === actor.tenantId
                && !entry.deletedAt
                && (!entry.expiresAt || entry.expiresAt > now)
                && entry.permissionCodes.includes('document.read')
                && (entry.subjectType === AclSubjectType.MEMBERSHIP
                    ? entry.subjectId === actor.membershipId
                    : roleIds.includes(entry.subjectId)));
        if (!accessible) throw this.sourceDocumentNotFound();
        return { title: document.title, content: document.content };
    }

    /** 对话消息来源：必须属于当前租户且会话归属当前成员（工具路径还限定当前会话）。 */
    private async requireSavableMessage(
        actor: KnowledgeSourceSaveActor,
        messageId: string,
    ): Promise<{ content: string; createdAt: Date }> {
        const message = await this.prisma.conversationMessage.findFirst({
            where: { id: messageId, tenantId: actor.tenantId },
            select: {
                role: true,
                content: true,
                conversationId: true,
                createdAt: true,
                conversation: { select: { ownerMembershipId: true, deletedAt: true } },
            },
        });
        if (!message
            || message.conversation.deletedAt
            || message.conversation.ownerMembershipId !== actor.membershipId) {
            throw this.sourceMessageNotFound();
        }
        // 工具红线：只转存当前会话中的消息，不允许跨会话引用。
        if (actor.conversationId && message.conversationId !== actor.conversationId) {
            throw this.sourceMessageNotFound();
        }
        if (message.role === 'TOOL') throw this.sourceMessageInvalid();
        return { content: message.content, createdAt: message.createdAt };
    }

    /** 首次转存：创建锚定文档 + 版本 1，写入审计。 */
    private async createSourceDocument(
        actor: KnowledgeSourceSaveActor,
        input: KnowledgeSourceSaveInput,
        scope: ResolvedVisibilityScope,
        resolved: { fileObjectId: string; name: string },
    ): Promise<string> {
        return this.prisma.$transaction(async (transaction) => {
            const created = await transaction.knowledgeDocument.create({
                data: {
                    tenantId: actor.tenantId,
                    knowledgeBaseId: input.knowledgeBaseId,
                    fileObjectId: resolved.fileObjectId,
                    sourceType: input.sourceType,
                    sourceId: input.sourceId,
                    name: resolved.name,
                    createdBy: actor.userId,
                    updatedBy: actor.userId,
                },
                select: { id: true },
            });
            const version = await transaction.documentVersion.create({
                data: {
                    tenantId: actor.tenantId,
                    documentId: created.id,
                    fileObjectId: resolved.fileObjectId,
                    versionNumber: 1,
                    visibilityScope: scope.visibilityScope,
                    departmentId: scope.departmentId,
                    projectId: scope.projectId,
                    createdBy: actor.userId,
                },
                select: { id: true },
            });
            await transaction.knowledgeDocument.update({
                where: { id: created.id },
                data: { currentVersionId: version.id },
            });
            await this.writeAudit(transaction, actor, 'KNOWLEDGE_DOCUMENT_CREATED', created.id, {
                knowledgeBaseId: input.knowledgeBaseId,
                name: resolved.name,
                fileObjectId: resolved.fileObjectId,
                documentVersionId: version.id,
                visibilityScope: scope.visibilityScope,
                sourceType: input.sourceType,
                sourceId: input.sourceId,
            });
            return created.id;
        });
    }

    /** 同源重复转存：追加新版本（内容为最新快照），状态回 PENDING 重新解析索引。 */
    private async appendSourceVersion(
        actor: KnowledgeSourceSaveActor,
        input: {
            knowledgeBaseId: string;
            documentId: string;
            previousVersionId: string | null;
            sourceType: KnowledgeDocumentSourceType;
            sourceId: string;
            name?: string;
            scope: ResolvedVisibilityScope;
        },
    ): Promise<KnowledgeDocumentResult> {
        const resolved = await this.resolveSourceSnapshot(actor, {
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            name: input.name,
        });
        try {
            await this.prisma.$transaction(async (transaction) => {
                const latest = await transaction.documentVersion.findFirst({
                    where: { tenantId: actor.tenantId, documentId: input.documentId },
                    orderBy: { versionNumber: 'desc' },
                    select: { versionNumber: true },
                });
                const versionNumber = (latest?.versionNumber ?? 0) + 1;
                const version = await transaction.documentVersion.create({
                    data: {
                        tenantId: actor.tenantId,
                        documentId: input.documentId,
                        fileObjectId: resolved.fileObjectId,
                        versionNumber,
                        visibilityScope: input.scope.visibilityScope,
                        departmentId: input.scope.departmentId,
                        projectId: input.scope.projectId,
                        createdBy: actor.userId,
                    },
                    select: { id: true },
                });
                await transaction.knowledgeDocument.update({
                    where: { id: input.documentId },
                    data: {
                        fileObjectId: resolved.fileObjectId,
                        currentVersionId: version.id,
                        status: 'PENDING',
                        retryCount: 0,
                        lastError: null,
                        name: resolved.name,
                        updatedBy: actor.userId,
                        version: { increment: 1 },
                    },
                });
                await this.writeAudit(transaction, actor, 'KNOWLEDGE_DOCUMENT_VERSION_CREATED', input.documentId, {
                    knowledgeBaseId: input.knowledgeBaseId,
                    fileObjectId: resolved.fileObjectId,
                    documentVersionId: version.id,
                    versionNumber,
                    visibilityScope: input.scope.visibilityScope,
                    sourceType: input.sourceType,
                    sourceId: input.sourceId,
                });
            });
        } catch (error) {
            if (isVersionNumberConflict(error)) throw this.versionConflict();
            if (isUniqueConstraintError(error)) throw this.fileObjectInUse();
            throw error;
        }
        void this.indexingService.kick();
        if (input.previousVersionId) {
            void this.indexingService.deleteDocumentVersionIndex(
                actor.tenantId,
                actor.userId,
                input.previousVersionId,
            ).catch((error: unknown) => {
                const message = error instanceof Error ? error.message : 'unknown error';
                this.logger.warn(`清理旧文档版本派生索引失败（版本 ${input.previousVersionId}）：${message}`);
            });
        }
        return this.requireDocumentAsActor(actor, input.knowledgeBaseId, input.documentId);
    }

    /** 按来源锚定回查已有文档；一份来源（租户内）只存一个知识库。 */
    private async findSourceDocument(
        tenantId: string,
        sourceType: KnowledgeDocumentSourceType,
        sourceId: string,
        includeDeleted = false,
    ): Promise<{ id: string; knowledgeBaseId: string; currentVersionId: string | null } | null> {
        return this.prisma.knowledgeDocument.findFirst({
            where: {
                tenantId,
                sourceType,
                sourceId,
                ...(includeDeleted ? {} : { deletedAt: null }),
            },
            select: { id: true, knowledgeBaseId: true, currentVersionId: true },
        });
    }

    /**
     * 恢复已软删除的同源文档：重新转存同一来源时复活业务记录，
     * 随后由 appendSourceVersion 追加新快照版本并重新解析索引。
     */
    private async restoreSourceDocument(
        actor: KnowledgeSourceSaveActor,
        knowledgeBaseId: string,
        documentId: string,
    ): Promise<void> {
        await this.prisma.$transaction(async (transaction) => {
            const restored = await transaction.knowledgeDocument.updateMany({
                where: { id: documentId, tenantId: actor.tenantId, deletedAt: { not: null } },
                data: { deletedAt: null, updatedBy: actor.userId, version: { increment: 1 } },
            });
            if (restored.count !== 1) return;
            await this.writeAudit(transaction, actor, 'KNOWLEDGE_DOCUMENT_RESTORED', documentId, {
                knowledgeBaseId,
            });
        });
    }

    private async requireDocumentAsActor(
        actor: KnowledgeSourceSaveActor,
        knowledgeBaseId: string,
        documentId: string,
    ): Promise<KnowledgeDocumentResult> {
        const record = await this.requireDocumentRecord(actor.tenantId, knowledgeBaseId, documentId);
        return this.toDocumentResult(record);
    }

    private async resolveRoleIds(tenantId: string, membershipId: string): Promise<string[]> {
        const assignments = await this.prisma.membershipRole.findMany({
            where: { tenantId, membershipId },
            select: { roleId: true },
        });
        return assignments.map((assignment) => assignment.roleId);
    }

    async createDocumentVersion(
        knowledgeBaseId: string,
        documentId: string,
        input: CreateKnowledgeDocumentVersionDto,
    ): Promise<KnowledgeDocumentResult> {
        const context = this.tenantContext.require();
        await this.knowledgeService.requireKnowledgeBaseAccess(knowledgeBaseId, 'EDITOR');
        const document = await this.requireDocumentRecord(context.tenantId, knowledgeBaseId, documentId);
        const previousVersionId = document.currentVersionId;
        const scope = await this.resolveVisibilityScope(
            context.tenantId,
            input.visibilityScope,
            input.departmentId,
            input.projectId,
        );
        await this.requireAvailableFile(context.tenantId, input.fileObjectId);
        try {
            await this.prisma.$transaction(async (transaction) => {
                const latest = await transaction.documentVersion.findFirst({
                    where: { tenantId: context.tenantId, documentId },
                    orderBy: { versionNumber: 'desc' },
                    select: { versionNumber: true },
                });
                const version = await transaction.documentVersion.create({
                    data: {
                        tenantId: context.tenantId,
                        documentId,
                        fileObjectId: input.fileObjectId,
                        versionNumber: (latest?.versionNumber ?? 0) + 1,
                        visibilityScope: scope.visibilityScope,
                        departmentId: scope.departmentId,
                        projectId: scope.projectId,
                        createdBy: context.userId,
                    },
                    select: { id: true },
                });
                await transaction.knowledgeDocument.update({
                    where: { id: documentId },
                    data: {
                        fileObjectId: input.fileObjectId,
                        currentVersionId: version.id,
                        status: 'PENDING',
                        retryCount: 0,
                        lastError: null,
                        updatedBy: context.userId,
                        version: { increment: 1 },
                    },
                });
                await this.writeAudit(transaction, context, 'KNOWLEDGE_DOCUMENT_VERSION_CREATED', documentId, {
                    knowledgeBaseId,
                    fileObjectId: input.fileObjectId,
                    documentVersionId: version.id,
                    versionNumber: (latest?.versionNumber ?? 0) + 1,
                    visibilityScope: scope.visibilityScope,
                });
            });
            void this.indexingService.kick();
            if (previousVersionId) {
                void this.indexingService.deleteDocumentVersionIndex(
                    context.tenantId,
                    context.userId,
                    previousVersionId,
                ).catch((error: unknown) => {
                    const message = error instanceof Error ? error.message : 'unknown error';
                    this.logger.warn(`清理旧文档版本派生索引失败（版本 ${previousVersionId}）：${message}`);
                });
            }
            return this.requireDocument(knowledgeBaseId, documentId);
        } catch (error) {
            // 并发创建版本时 versionNumber 唯一约束冲突与文件占用冲突要分开报：
            // 前者是并发编辑冲突，后者是文件已被其他文档使用。
            if (isVersionNumberConflict(error)) throw this.versionConflict();
            if (isUniqueConstraintError(error)) throw this.fileObjectInUse();
            throw error;
        }
    }

    async retryDocument(knowledgeBaseId: string, documentId: string): Promise<KnowledgeDocumentResult> {
        const context = this.tenantContext.require();
        await this.knowledgeService.requireKnowledgeBaseAccess(knowledgeBaseId, 'EDITOR');
        const document = await this.requireDocumentRecord(context.tenantId, knowledgeBaseId, documentId);
        if (document.status !== 'FAILED') throw this.retryStateConflict(document.status);
        await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.knowledgeDocument.updateMany({
                where: { id: documentId, status: 'FAILED', deletedAt: null },
                data: {
                    status: 'PENDING',
                    retryCount: 0,
                    lastError: null,
                    updatedBy: context.userId,
                    version: { increment: 1 },
                },
            });
            if (updated.count !== 1) throw this.retryStateConflict(document.status);
            await this.writeAudit(transaction, context, 'KNOWLEDGE_DOCUMENT_RETRY_REQUESTED', documentId, {
                knowledgeBaseId,
            });
        });
        void this.indexingService.kick();
        return this.requireDocument(knowledgeBaseId, documentId);
    }

    /**
     * 删除文档：软删业务记录并异步清理全部版本的向量索引。
     * 门槛与文档写入一致（库内 EDITOR 及以上，manage_all 短路放行）。
     * 处理中（PARSING/INDEXING）的文档同样允许删除；索引流程在提交 READY
     * 前检查 deletedAt，已删文档不再标回 READY 并补删刚写入的向量索引。
     */
    async deleteDocument(knowledgeBaseId: string, documentId: string): Promise<void> {
        const context = this.tenantContext.require();
        await this.knowledgeService.requireKnowledgeBaseAccess(knowledgeBaseId, 'EDITOR');
        const document = await this.requireDocumentRecord(context.tenantId, knowledgeBaseId, documentId);
        const versions = await this.prisma.documentVersion.findMany({
            where: { tenantId: context.tenantId, documentId },
            select: { id: true },
        });
        await this.prisma.$transaction(async (transaction) => {
            const deleted = await transaction.knowledgeDocument.updateMany({
                where: { id: documentId, tenantId: context.tenantId, knowledgeBaseId, deletedAt: null },
                data: {
                    deletedAt: new Date(),
                    updatedBy: context.userId,
                    version: { increment: 1 },
                },
            });
            if (deleted.count !== 1) throw this.documentNotFound();
            await this.writeAudit(transaction, context, 'KNOWLEDGE_DOCUMENT_DELETED', documentId, {
                knowledgeBaseId,
                name: document.name,
                status: document.status,
                versionCount: versions.length,
            });
        });
        for (const version of versions) {
            void this.indexingService.deleteDocumentVersionIndex(
                context.tenantId,
                context.userId,
                version.id,
            ).catch((error: unknown) => {
                const message = error instanceof Error ? error.message : 'unknown error';
                this.logger.warn(`清理文档派生索引失败（版本 ${version.id}）：${message}`);
            });
        }
    }

    private async requireDocument(knowledgeBaseId: string, documentId: string): Promise<KnowledgeDocumentResult> {
        const { tenantId } = this.tenantContext.require();
        const record = await this.requireDocumentRecord(tenantId, knowledgeBaseId, documentId);
        return this.toDocumentResult(record);
    }

    private async requireDocumentRecord(
        tenantId: string,
        knowledgeBaseId: string,
        documentId: string,
    ): Promise<KnowledgeDocumentRecord> {
        const document = await this.prisma.knowledgeDocument.findFirst({
            where: { id: documentId, tenantId, knowledgeBaseId, deletedAt: null },
            select: knowledgeDocumentSelect,
        });
        if (!document) throw this.documentNotFound();
        return document;
    }

    private async toDocumentResult(record: KnowledgeDocumentRecord): Promise<KnowledgeDocumentResult> {
        const version = record.currentVersionId
            ? await this.prisma.documentVersion.findFirst({
                where: { id: record.currentVersionId, tenantId: record.tenantId, documentId: record.id },
                select: { versionNumber: true, visibilityScope: true, departmentId: true, projectId: true },
            })
            : null;
        return {
            ...record,
            status: record.status as KnowledgeDocumentStatus,
            versionNumber: version?.versionNumber ?? 0,
            visibilityScope: toPublicVisibilityScope(version?.visibilityScope ?? null),
            departmentId: version?.departmentId ?? null,
            projectId: version?.projectId ?? null,
        };
    }

    private async resolveVisibilityScope(
        tenantId: string,
        visibilityScope: KnowledgeDocumentVisibilityScope,
        departmentId: string | null | undefined,
        projectId: string | null | undefined,
    ): Promise<ResolvedVisibilityScope> {
        switch (visibilityScope) {
            case 'DEPARTMENT': {
                if (!departmentId) throw this.scopeInvalid('可见范围为 DEPARTMENT 时必须提供 departmentId');
                await this.requireDepartment(tenantId, departmentId);
                return { visibilityScope: VisibilityScope.DEPARTMENT, departmentId, projectId: null };
            }
            case 'PROJECT': {
                if (!projectId) throw this.scopeInvalid('可见范围为 PROJECT 时必须提供 projectId');
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
        if (!department) throw this.scopeInvalid('可见范围关联的部门不存在或不属于当前租户');
    }

    private async requireProject(tenantId: string, projectId: string): Promise<void> {
        const project = await this.prisma.project.findFirst({
            where: { id: projectId, tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!project) throw this.scopeInvalid('可见范围关联的项目不存在或不属于当前租户');
    }

    private async requireAvailableFile(
        tenantId: string,
        fileObjectId: string,
    ): Promise<{ id: string; originalName: string }> {
        const file = await this.prisma.fileObject.findFirst({
            where: { id: fileObjectId, tenantId, deletedAt: null },
            select: { id: true, originalName: true },
        });
        if (!file) throw new NotFoundException({
            code: 'KNOWLEDGE_FILE_OBJECT_NOT_FOUND',
            message: '文件不存在、不属于当前租户或已被删除',
        });
        return file;
    }

    private async writeAudit(
        transaction: Prisma.TransactionClient,
        context: { tenantId: string; userId: string; membershipId: string; requestId: string },
        action: string,
        documentId: string,
        metadata: Record<string, unknown>,
    ): Promise<void> {
        await transaction.auditLog.create({
            data: {
                tenantId: context.tenantId,
                actorUserId: context.userId,
                actorMembershipId: context.membershipId,
                action,
                outcome: AuditOutcome.SUCCESS,
                resourceType: 'KNOWLEDGE_DOCUMENT',
                resourceId: documentId,
                requestId: context.requestId,
                metadata: metadata as Prisma.InputJsonValue,
            },
        });
    }

    private invalidCursor(): BadRequestException {
        return new BadRequestException({ code: 'PAGINATION_CURSOR_INVALID', message: '分页游标无效' });
    }

    private documentNotFound(): NotFoundException {
        return new NotFoundException({ code: 'KNOWLEDGE_DOCUMENT_NOT_FOUND', message: '文档不存在、已删除或不属于当前知识库' });
    }

    private fileObjectInUse(): ConflictException {
        return new ConflictException({
            code: 'KNOWLEDGE_FILE_OBJECT_IN_USE',
            message: '该文件已经被其他文档使用，请重新上传',
        });
    }

    private retryStateConflict(status: string): ConflictException {
        return new ConflictException({
            code: 'KNOWLEDGE_DOCUMENT_RETRY_INVALID',
            message: '只有处理失败的文档可以重试',
            details: { status },
        });
    }

    private scopeInvalid(message: string): BadRequestException {
        return new BadRequestException({ code: 'KNOWLEDGE_DOCUMENT_SCOPE_INVALID', message });
    }

    private versionConflict(): ConflictException {
        return new ConflictException({
            code: 'KNOWLEDGE_DOCUMENT_VERSION_CONFLICT',
            message: '文档已被其他操作修改，请刷新后重试',
        });
    }

    private sourceRequired(): BadRequestException {
        return new BadRequestException({
            code: 'KNOWLEDGE_DOCUMENT_SOURCE_REQUIRED',
            message: '必须提供 fileObjectId，或 sourceType + sourceId 之一',
        });
    }

    private sourceIncomplete(): BadRequestException {
        return new BadRequestException({
            code: 'KNOWLEDGE_DOCUMENT_SOURCE_INCOMPLETE',
            message: 'sourceType 与 sourceId 必须同时提供',
        });
    }

    private sourceAmbiguous(): BadRequestException {
        return new BadRequestException({
            code: 'KNOWLEDGE_DOCUMENT_SOURCE_AMBIGUOUS',
            message: 'fileObjectId 与 sourceType/sourceId 只能二选一',
        });
    }

    private sourceAlreadySaved(): ConflictException {
        return new ConflictException({
            code: 'KNOWLEDGE_SOURCE_ALREADY_SAVED',
            message: '该来源已存入其他知识库，一份来源只能存一个知识库',
        });
    }

    private sourceDocumentNotFound(): NotFoundException {
        return new NotFoundException({
            code: 'KNOWLEDGE_SOURCE_DOCUMENT_NOT_FOUND',
            message: '文档不存在或无权访问',
        });
    }

    private sourceMessageNotFound(): NotFoundException {
        return new NotFoundException({
            code: 'KNOWLEDGE_SOURCE_MESSAGE_NOT_FOUND',
            message: '消息不存在或无权访问',
        });
    }

    private sourceMessageInvalid(): BadRequestException {
        return new BadRequestException({
            code: 'KNOWLEDGE_SOURCE_MESSAGE_INVALID',
            message: '该消息类型不支持转存，请选择用户或助手消息',
        });
    }
}

function toPublicVisibilityScope(value: VisibilityScope | null): KnowledgeDocumentVisibilityScope {
    return value === VisibilityScope.DEPARTMENT || value === VisibilityScope.PROJECT
        || value === VisibilityScope.TENANT || value === VisibilityScope.PRIVATE
        ? value
        : 'PRIVATE';
}

/** 转存执行上下文：身份与权限显式传入，工具后台执行不依赖 AsyncLocalStorage。 */
export interface KnowledgeSourceSaveActor {
    tenantId: string;
    userId: string;
    membershipId: string;
    permissions: string[];
    requestId: string;
    /** 工具后台执行时传入：MESSAGE 来源必须属于当前会话。 */
    conversationId?: string;
}

export interface KnowledgeSourceSaveInput {
    knowledgeBaseId: string;
    sourceType: KnowledgeDocumentSourceType;
    sourceId: string;
    name?: string;
    visibilityScope: KnowledgeDocumentVisibilityScope;
    departmentId?: string | null;
    projectId?: string | null;
}

function sanitizeFileName(value: string): string {
    const cleaned = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 80);
    return cleaned || '文档';
}

function formatSnapshotTime(value: Date): string {
    const pad = (part: number): string => String(part).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** P2002 且冲突在 (tenantId, sourceType, sourceId) 部分唯一索引上：并发转存同源。 */
function isSourceAnchorConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
    const target = error.meta?.target;
    return Array.isArray(target) && target.includes('source_type');
}

/** P2002 且冲突在 (tenantId, documentId, versionNumber) 唯一约束上：并发创建版本。 */
function isVersionNumberConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
    const target = error.meta?.target;
    return Array.isArray(target) && target.includes('version_number');
}
