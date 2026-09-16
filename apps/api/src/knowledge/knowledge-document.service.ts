import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { AuditOutcome, Prisma, VisibilityScope } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
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
        await this.knowledgeService.requireKnowledgeBaseAccess(knowledgeBaseId, 'EDITOR');
        const scope = await this.resolveVisibilityScope(
            context.tenantId,
            input.visibilityScope,
            input.departmentId,
            input.projectId,
        );
        await this.requireAvailableFile(context.tenantId, input.fileObjectId);
        const name = input.name.trim();
        try {
            const documentId = await this.prisma.$transaction(async (transaction) => {
                const created = await transaction.knowledgeDocument.create({
                    data: {
                        tenantId: context.tenantId,
                        knowledgeBaseId,
                        fileObjectId: input.fileObjectId,
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
                        fileObjectId: input.fileObjectId,
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
                    fileObjectId: input.fileObjectId,
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

    private async requireAvailableFile(tenantId: string, fileObjectId: string): Promise<void> {
        const file = await this.prisma.fileObject.findFirst({
            where: { id: fileObjectId, tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!file) throw new NotFoundException({
            code: 'KNOWLEDGE_FILE_OBJECT_NOT_FOUND',
            message: '文件不存在、不属于当前租户或已被删除',
        });
    }

    private async writeAudit(
        transaction: Prisma.TransactionClient,
        context: ReturnType<TenantContext['require']>,
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
}

function toPublicVisibilityScope(value: VisibilityScope | null): KnowledgeDocumentVisibilityScope {
    return value === VisibilityScope.DEPARTMENT || value === VisibilityScope.PROJECT
        || value === VisibilityScope.TENANT || value === VisibilityScope.PRIVATE
        ? value
        : 'PRIVATE';
}

function isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
