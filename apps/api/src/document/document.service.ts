import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
    AuditOutcome,
    DocumentVisibility,
    DraftStatus,
    FilePurpose,
    Prisma,
    ResourceType,
    ToolCallStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { ComposeDocumentRequest, DocumentBlock, DocumentSection, DocumentSpec, ImageBlock, PptxBlock, PptxSlide, PptxSpec, RenderDocxRequest, RenderPdfRequest, RenderPptxRequest } from '@cees/ai-service-client';
import { AiServiceGateway } from '../ai-orchestration/ai-service-gateway.service';
import { PrismaService } from '../database/prisma.service';
import {
    managedDocumentAccessInclude,
    ManagedDocumentWithAccess,
    ResourceAccessService,
} from '../resource/resource-access.service';
import { STORAGE_PROVIDER, STORAGE_SETTINGS } from '../storage/storage.tokens';
import type { StorageProvider, StorageSettings } from '../storage/storage.types';
import { CosObjectKeyFactory } from '../storage/cos-object-key.factory';
import { TenantContext } from '../tenant/tenant-context';
import { CreateDocumentDto, ListDocumentsQueryDto, UpdateDocumentDto } from './dto';
import { DocumentListResult, DocumentResult, DocumentSummaryResult } from './document.types';

/** AIActionDraft.actionType：与权限码保持一致，动作流水与权限语义一一对应。 */
const ACTION_TYPE = 'ai.document.generate';

/** 「在已有文档章节末尾插图」在 AIActionDraft.payload 中的操作标记，用于幂等回放。 */
const INSERT_IMAGE_OPERATION = 'insert_document_image';

/**
 * DocumentSpec 中图片的稳定引用前缀。落库的 spec 只保存 `cos://{objectKey}`，
 * 绝不保存会过期的签名 URL；仅在渲染前由 signSpecImageReferences 现场签发。
 */
const IMAGE_REFERENCE_PREFIX = 'cos://';

const DOCUMENT_FORMAT_MEDIA_TYPES: Record<DocumentFormat, string> = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pdf: 'application/pdf',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export interface GenerateDocumentCommand {
    tenantId: string;
    userId: string;
    membershipId: string;
    requestId: string;
    conversationId: string;
    turnId: string;
    toolCallId: string;
    executionOwner: string;
    executionToken: string;
    instruction: string;
    title?: string;
    visibility: DocumentVisibility;
    format: DocumentFormat;
}

export type DocumentFormat = 'docx' | 'pdf' | 'pptx';

export interface GeneratedDocument {
    documentId: string;
    title: string;
    contentLength: number;
    provider: string;
    model: string;
}

export interface DocumentExportResult {
    /** 建议的下载文件名（不含扩展名）；已去除文件系统非法字符。 */
    filename: string;
    /** DOCX 文件字节。 */
    bytes: Buffer;
}

/**
 * 「在已有文档的指定章节末尾插图」命令。只描述要插什么图、插到哪里，
 * 不携带正文：正文永远由既有 DocumentSpec 提供，工具不得重写它。
 */
export interface InsertDocumentImageCommand {
    tenantId: string;
    userId: string;
    membershipId: string;
    requestId: string;
    conversationId: string;
    turnId: string;
    toolCallId: string;
    executionOwner: string;
    executionToken: string;
    /** 待插入图片的 COS 对象键（签名 URL 会过期，绝不落库）。 */
    imageObjectKey: string;
    /** 目标章节标题；省略时插入到最后一节末尾。 */
    sectionTitle?: string;
    /** 图注；省略时不显示图注。 */
    caption?: string;
    /** 目标文档标题；用于在会话内存在多份生成文档时消歧。 */
    documentTitle?: string;
}

export interface InsertedDocumentImage {
    documentId: string;
    title: string;
    /** 实际命中的章节标题，用于回喂模型与审计。 */
    sectionHeading: string;
    sectionIndex: number;
    /** 重渲染时使用的格式（与原文档落盘格式一致）。 */
    format: DocumentFormat;
}

/** 工具执行权的最小断言字段：产生业务副作用前必须再次核对。 */
interface ToolExecutionClaim {
    tenantId: string;
    turnId: string;
    toolCallId: string;
    executionOwner: string;
    executionToken: string;
}

/** 只读 toolCall 的能力，兼容 PrismaClient 与事务客户端。 */
type ToolCallClaimReader = Pick<Prisma.TransactionClient, 'toolCall'>;

@Injectable()
export class DocumentService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
        private readonly resourceAccess: ResourceAccessService,
        private readonly gateway: AiServiceGateway,
        @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
        @Inject(STORAGE_SETTINGS) private readonly storageSettings: StorageSettings,
        private readonly objectKeys: CosObjectKeyFactory,
    ) { }

    async listDocuments(query: ListDocumentsQueryDto): Promise<DocumentListResult> {
        const roleIds = await this.resourceAccess.resolveCurrentRoleIds();
        const accessWhere = this.resourceAccess.documentWhere('document.read', roleIds);
        const filters: Prisma.ManagedDocumentWhereInput = {
            title: query.keyword?.trim()
                ? { contains: query.keyword.trim(), mode: 'insensitive' }
                : undefined,
            visibility: query.visibility,
        };
        const where: Prisma.ManagedDocumentWhereInput = { AND: [accessWhere, filters] };
        if (query.cursor) {
            const cursorExists = await this.prisma.managedDocument.findFirst({
                where: { AND: [where, { id: query.cursor }] },
                select: { id: true },
            });
            if (!cursorExists) {
                throw new BadRequestException({ code: 'PAGINATION_CURSOR_INVALID', message: '分页游标无效' });
            }
        }

        const documents = await this.prisma.managedDocument.findMany({
            where,
            include: managedDocumentAccessInclude,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        const hasNextPage = documents.length > query.limit;
        const page = hasNextPage ? documents.slice(0, query.limit) : documents;
        return {
            items: page.map((document) => this.toSummary(document, roleIds)),
            nextCursor: hasNextPage ? page[page.length - 1]?.id ?? null : null,
        };
    }

    async createDocument(input: CreateDocumentDto): Promise<DocumentResult> {
        const context = this.tenantContext.require();
        const documentId = randomUUID();
        await this.prisma.$transaction(async (transaction) => {
            await transaction.resource.create({
                data: {
                    id: documentId,
                    tenantId: context.tenantId,
                    type: ResourceType.DOCUMENT,
                    ownerMembershipId: context.membershipId,
                    createdBy: context.userId,
                    updatedBy: context.userId,
                },
            });
            await transaction.managedDocument.create({
                data: {
                    id: documentId,
                    tenantId: context.tenantId,
                    title: input.title.trim(),
                    content: input.content,
                    visibility: input.visibility,
                    createdBy: context.userId,
                    updatedBy: context.userId,
                },
            });
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'DOCUMENT_CREATED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'DOCUMENT',
                    resourceId: documentId,
                    requestId: context.requestId,
                    metadata: {
                        title: input.title.trim(),
                        visibility: input.visibility,
                        contentLength: input.content.length,
                    },
                },
            });
        });
        const roleIds = await this.resourceAccess.resolveCurrentRoleIds();
        return this.toDetail(await this.requireCurrentDocument(documentId), roleIds);
    }

    /**
     * AI 生成文档的正式落库入口：ai-service compose 生成结构化 DocumentSpec →
     * 序列化为 Markdown 落 ManagedDocument → AIActionDraft(EXECUTED) 动作流水 → 审计。
     * 以 tool_call_id 幂等：同一工具调用重复执行直接回放已落库文档，不重复生成。
     * 本方法只被 generate_document 工具执行器调用，不暴露公开 HTTP 接口。
     */
    async createGeneratedDocument(command: GenerateDocumentCommand): Promise<GeneratedDocument> {
        const existing = await this.findExecutedDocument(command.tenantId, command.turnId, command.toolCallId);
        if (existing) return existing;
        await this.requireGenerationClaim(command);

        const reserved = await this.reserveGeneratedDocument(command);
        if (!reserved) {
            const replay = await this.findExecutedDocument(command.tenantId, command.turnId, command.toolCallId);
            if (replay) return replay;
            throw new Error(`文档工具调用 ${command.toolCallId} 已在执行或需要恢复，禁止并发重复生成`);
        }

        try {
            const request: ComposeDocumentRequest = {
                request_id: command.requestId,
                tenant_id: command.tenantId,
                user_id: command.userId,
                instruction: command.instruction,
                source_materials: [],
                max_output_tokens: 8192,
                document_options: {
                    ...(command.title !== undefined ? { title: command.title } : {}),
                    locale: 'zh-CN',
                    template_id: 'business-standard',
                    include_toc: false,
                    generation_mode: 'fast',
                },
            };
            // Re-check immediately before the external model call. A turn
            // can be cancelled after the draft reservation is created.
            await this.requireGenerationClaim(command);
            const upstream = await this.gateway.composeDocument(request, {
                membershipId: command.membershipId,
                conversationId: command.conversationId,
                turnId: command.turnId,
                toolCallId: command.toolCallId,
            });

            const documentId = randomUUID();
            const content = documentSpecToMarkdown(upstream.document);
            // 同一次 compose 的 DocumentSpec 一并落库，作为后续 DOCX 等格式导出的事实源，
            // 避免导出时重新调用 LLM（成本翻倍且内容可能与落库 Markdown 不一致）。
            const documentSpec = upstream.document as unknown as Prisma.InputJsonObject;
            // 渲染对应格式的文件字节并上传 COS，使生成结果成为可下载的正式文件。
            // 失败不阻断生成：文档仍以 Markdown + DocumentSpec 落库，可稍后在文档库导出。
            const storedFile = await this.renderAndStoreDocumentFile(upstream.document, command);
            await this.prisma.$transaction(async (transaction) => {
                const now = new Date();
                const claim = await transaction.toolCall.findFirst({
                    where: {
                        id: command.toolCallId,
                        tenantId: command.tenantId,
                        turnId: command.turnId,
                        status: ToolCallStatus.EXECUTING,
                        executionToken: command.executionToken,
                        leaseExpiresAt: { gt: now },
                        turn: {
                            is: {
                                status: 'RUNNING',
                                executionOwner: command.executionOwner,
                                leaseExpiresAt: { gt: now },
                            },
                        },
                    },
                    select: { id: true },
                });
                if (!claim) throw new Error('文档生成完成时工具执行权已失效');

                await transaction.resource.create({
                    data: {
                        id: documentId,
                        tenantId: command.tenantId,
                        type: ResourceType.DOCUMENT,
                        ownerMembershipId: command.membershipId,
                        createdBy: command.userId,
                        updatedBy: command.userId,
                    },
                });
                if (storedFile) {
                    await transaction.fileObject.create({
                        data: {
                            id: storedFile.id,
                            tenantId: command.tenantId,
                            originalName: `generated-${documentId}.${command.format}`,
                            purpose: FilePurpose.GENERATED_DOCUMENT,
                            storageProvider: 'TENCENT_COS',
                            bucket: this.storageSettings.bucket,
                            region: this.storageSettings.region,
                            objectKey: storedFile.objectKey,
                            mimeType: storedFile.mimeType,
                            sizeBytes: BigInt(storedFile.sizeBytes),
                            etag: storedFile.etag,
                            createdBy: command.userId,
                            updatedBy: command.userId,
                        },
                    });
                }
                await transaction.managedDocument.create({
                    data: {
                        id: documentId,
                        tenantId: command.tenantId,
                        generatedByToolCallId: command.toolCallId,
                        title: upstream.document.title,
                        content,
                        documentSpec,
                        fileObjectId: storedFile?.id ?? null,
                        visibility: command.visibility,
                        createdBy: command.userId,
                        updatedBy: command.userId,
                    },
                });
                await transaction.aIActionDraft.update({
                    where: { toolCallId: command.toolCallId },
                    data: {
                        payload: {
                            instruction: command.instruction,
                            requestedTitle: command.title ?? null,
                            visibility: command.visibility,
                            provider: upstream.execution.provider,
                            model: upstream.execution.model,
                            contentLength: content.length,
                            sectionCount: upstream.document.sections.length,
                        } satisfies Prisma.InputJsonObject,
                        status: DraftStatus.EXECUTED,
                        executedResourceType: 'DOCUMENT',
                        executedResourceId: documentId,
                        updatedBy: command.userId,
                    },
                });
                await transaction.auditLog.create({
                    data: {
                        tenantId: command.tenantId,
                        actorUserId: command.userId,
                        actorMembershipId: command.membershipId,
                        action: 'DOCUMENT_GENERATED',
                        outcome: AuditOutcome.SUCCESS,
                        resourceType: 'DOCUMENT',
                        resourceId: documentId,
                        requestId: command.requestId,
                        metadata: {
                            toolCallId: command.toolCallId,
                            title: upstream.document.title,
                            visibility: command.visibility,
                            provider: upstream.execution.provider,
                            model: upstream.execution.model,
                            contentLength: content.length,
                        },
                    },
                });
            });
            return {
                documentId,
                title: upstream.document.title,
                contentLength: content.length,
                provider: upstream.execution.provider,
                model: upstream.execution.model,
            };
        } catch (error) {
            const replay = await this.findExecutedDocument(command.tenantId, command.turnId, command.toolCallId).catch(() => null);
            if (replay) return replay;
            await this.recordGenerationFailure(command, error).catch(() => undefined);
            throw error;
        }
    }

    /**
     * 「在已有文档的指定章节末尾插图」的正式落库入口：读取目标文档的 DocumentSpec，
     * 只在命中章节的 blocks 尾部追加一个 ImageBlock，正文与既有块完全不变；随后按
     * 原文档的生成格式重渲染并原地更新同一 ManagedDocument，绝不新建文档或改写正文。
     * 以 tool_call_id 幂等：同一工具调用重复执行直接回放已落库结果。
     * 本方法只被 insert_document_image 工具执行器调用，不暴露公开 HTTP 接口。
     */
    async insertDocumentImage(command: InsertDocumentImageCommand): Promise<InsertedDocumentImage> {
        const replay = await this.findInsertedImageResult(command.tenantId, command.toolCallId);
        if (replay) return replay;
        await this.requireLiveToolCall(command, '图片插入工具执行权已失效，拒绝修改文档');

        const document = await this.findConversationGeneratedDocument(command);
        if (!document) {
            throw new NotFoundException({
                code: 'DOCUMENT_NOT_FOUND',
                message: '当前会话中没有可插入图片的生成文档',
            });
        }
        if (!document.documentSpec) {
            throw new BadRequestException({
                code: 'DOCUMENT_SPEC_MISSING',
                message: '该文档没有可编辑的生成规格（可能由人工创建或内容已被手工修改）',
            });
        }

        const reserved = await this.reserveInsertedImageDraft(command);
        if (!reserved) {
            const concurrent = await this.findInsertedImageResult(command.tenantId, command.toolCallId);
            if (concurrent) return concurrent;
            throw new Error(`图片插入工具调用 ${command.toolCallId} 已在执行或需要恢复，禁止并发重复插入`);
        }

        const format = documentFormatFromToolName(document.generatedByToolCall?.name) ?? 'pdf';
        try {
            const { spec, sectionIndex, sectionHeading } = appendImageToSection(
                document.documentSpec as unknown as DocumentSpec,
                {
                    imageReference: `${IMAGE_REFERENCE_PREFIX}${command.imageObjectKey}`,
                    ...(command.caption !== undefined ? { caption: command.caption } : {}),
                    ...(command.sectionTitle !== undefined ? { sectionTitle: command.sectionTitle } : {}),
                },
            );
            // 章节定位等计算可能耗时，落库前再核对一次执行租约。
            await this.requireLiveToolCall(command, '图片插入工具执行权已失效，拒绝落库');
            const storedFile = await this.renderInsertedDocumentFile(spec, command, format);

            await this.prisma.$transaction(async (transaction) => {
                const now = new Date();
                const claim = await transaction.toolCall.findFirst({
                    where: {
                        id: command.toolCallId,
                        tenantId: command.tenantId,
                        turnId: command.turnId,
                        status: ToolCallStatus.EXECUTING,
                        executionToken: command.executionToken,
                        leaseExpiresAt: { gt: now },
                        turn: {
                            is: {
                                status: 'RUNNING',
                                executionOwner: command.executionOwner,
                                leaseExpiresAt: { gt: now },
                            },
                        },
                    },
                    select: { id: true },
                });
                if (!claim) throw new Error('图片插入完成时工具执行权已失效');

                if (storedFile) {
                    await transaction.fileObject.create({
                        data: {
                            id: storedFile.id,
                            tenantId: command.tenantId,
                            originalName: `generated-${document.id}.${format}`,
                            purpose: FilePurpose.GENERATED_DOCUMENT,
                            storageProvider: 'TENCENT_COS',
                            bucket: this.storageSettings.bucket,
                            region: this.storageSettings.region,
                            objectKey: storedFile.objectKey,
                            mimeType: storedFile.mimeType,
                            sizeBytes: BigInt(storedFile.sizeBytes),
                            etag: storedFile.etag,
                            createdBy: command.userId,
                            updatedBy: command.userId,
                        },
                    });
                }
                const updated = await transaction.managedDocument.updateMany({
                    where: { id: document.id, tenantId: command.tenantId, deletedAt: null },
                    data: {
                        documentSpec: spec as unknown as Prisma.InputJsonObject,
                        ...(storedFile ? { fileObjectId: storedFile.id } : {}),
                        version: { increment: 1 },
                        updatedBy: command.userId,
                    },
                });
                if (updated.count !== 1) throw new Error('待插图文档在插入过程中已变更');
                await transaction.aIActionDraft.update({
                    where: { toolCallId: command.toolCallId },
                    data: {
                        payload: {
                            operation: INSERT_IMAGE_OPERATION,
                            documentId: document.id,
                            documentTitle: document.title,
                            sectionHeading,
                            sectionIndex,
                            format,
                            caption: command.caption ?? null,
                        } satisfies Prisma.InputJsonObject,
                        status: DraftStatus.EXECUTED,
                        executedResourceType: 'DOCUMENT',
                        executedResourceId: document.id,
                        updatedBy: command.userId,
                    },
                });
                await transaction.auditLog.create({
                    data: {
                        tenantId: command.tenantId,
                        actorUserId: command.userId,
                        actorMembershipId: command.membershipId,
                        action: 'DOCUMENT_IMAGE_INSERTED',
                        outcome: AuditOutcome.SUCCESS,
                        resourceType: 'DOCUMENT',
                        resourceId: document.id,
                        requestId: command.requestId,
                        metadata: {
                            toolCallId: command.toolCallId,
                            title: document.title,
                            sectionHeading,
                            sectionIndex,
                            format,
                            caption: command.caption ?? null,
                        },
                    },
                });
            });

            if (storedFile && document.fileObject) {
                await this.removeSupersededFileObject(document.fileObject).catch(() => undefined);
            }
            return { documentId: document.id, title: document.title, sectionHeading, sectionIndex, format };
        } catch (error) {
            const replayAfterFailure = await this.findInsertedImageResult(command.tenantId, command.toolCallId).catch(() => null);
            if (replayAfterFailure) return replayAfterFailure;
            await this.recordInsertedImageFailure(command, error).catch(() => undefined);
            throw error;
        }
    }

    /** 幂等回放：AIActionDraft 的 EXECUTED 快照是唯一事实源。 */
    private async findInsertedImageResult(
        tenantId: string,
        toolCallId: string,
    ): Promise<InsertedDocumentImage | null> {
        const draft = await this.prisma.aIActionDraft.findUnique({
            where: { toolCallId },
            select: { tenantId: true, status: true, payload: true },
        });
        if (!draft || draft.tenantId !== tenantId || draft.status !== DraftStatus.EXECUTED) return null;
        const payload = draft.payload as {
            operation?: string;
            documentId?: string;
            sectionHeading?: string;
            sectionIndex?: number;
            format?: DocumentFormat;
        };
        if (payload.operation !== INSERT_IMAGE_OPERATION || typeof payload.documentId !== 'string') return null;
        const document = await this.prisma.managedDocument.findFirst({
            where: { id: payload.documentId, tenantId, deletedAt: null },
            select: { id: true, title: true },
        });
        if (!document) return null;
        return {
            documentId: document.id,
            title: document.title,
            sectionHeading: payload.sectionHeading ?? '',
            sectionIndex: payload.sectionIndex ?? 0,
            format: payload.format ?? 'pdf',
        };
    }

    /** 会话内最近的生成文档；存在多份时按标题消歧。 */
    private async findConversationGeneratedDocument(command: InsertDocumentImageCommand): Promise<{
        id: string;
        title: string;
        documentSpec: Prisma.JsonValue | null;
        fileObject: { id: string; objectKey: string } | null;
        generatedByToolCall: { name: string } | null;
    } | null> {
        const title = command.documentTitle?.trim();
        return this.prisma.managedDocument.findFirst({
            where: {
                tenantId: command.tenantId,
                deletedAt: null,
                resource: { is: { deletedAt: null } },
                generatedByToolCall: {
                    is: { tenantId: command.tenantId, conversationId: command.conversationId },
                },
                ...(title ? { title } : {}),
            },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                title: true,
                documentSpec: true,
                fileObject: { select: { id: true, objectKey: true } },
                generatedByToolCall: { select: { name: true } },
            },
        });
    }

    /** 按原格式重渲染并上传 COS；失败不阻断插图（spec 已更新，导出时仍会实时渲染）。 */
    private async renderInsertedDocumentFile(
        document: DocumentSpec,
        command: InsertDocumentImageCommand,
        format: DocumentFormat,
    ): Promise<{ id: string; objectKey: string; mimeType: string; sizeBytes: number; etag: string | null } | null> {
        try {
            const bytes = await this.renderDocumentBytes(document, {
                requestId: command.requestId,
                tenantId: command.tenantId,
                userId: command.userId,
                format,
            });
            const mimeType = DOCUMENT_FORMAT_MEDIA_TYPES[format];
            const objectKey = this.objectKeys.buildGeneratedDocumentKey({
                tenantId: command.tenantId,
                toolCallId: command.toolCallId,
                format,
            });
            const stored = await this.storage.putObject({ objectKey, body: bytes, contentType: mimeType });
            return { id: randomUUID(), objectKey, mimeType, sizeBytes: stored.sizeBytes, etag: stored.etag };
        } catch {
            return null;
        }
    }

    /** AIActionDraft 的唯一 toolCallId 在落库前完成原子抢占，避免并发重复插入。 */
    private async reserveInsertedImageDraft(command: InsertDocumentImageCommand): Promise<boolean> {
        try {
            await this.prisma.aIActionDraft.create({
                data: {
                    tenantId: command.tenantId,
                    userId: command.userId,
                    actionType: ACTION_TYPE,
                    payload: {
                        operation: INSERT_IMAGE_OPERATION,
                        sectionTitle: command.sectionTitle ?? null,
                        caption: command.caption ?? null,
                        documentTitle: command.documentTitle ?? null,
                    },
                    status: DraftStatus.DRAFT,
                    toolCallId: command.toolCallId,
                    createdBy: command.userId,
                    updatedBy: command.userId,
                },
            });
            return true;
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
            throw error;
        }
    }

    private async recordInsertedImageFailure(command: InsertDocumentImageCommand, error: unknown): Promise<void> {
        const message = error instanceof Error ? error.message : '图片插入失败';
        await this.prisma.$transaction(async (transaction) => {
            const failed = await transaction.aIActionDraft.updateMany({
                where: { toolCallId: command.toolCallId, status: { not: DraftStatus.EXECUTED } },
                data: {
                    status: DraftStatus.FAILED,
                    payload: {
                        operation: INSERT_IMAGE_OPERATION,
                        sectionTitle: command.sectionTitle ?? null,
                        caption: command.caption ?? null,
                        error: message,
                    },
                    updatedBy: command.userId,
                },
            });
            if (failed.count !== 1) return;
            await transaction.auditLog.create({
                data: {
                    tenantId: command.tenantId,
                    actorUserId: command.userId,
                    actorMembershipId: command.membershipId,
                    action: 'DOCUMENT_IMAGE_INSERT_FAILED',
                    outcome: AuditOutcome.FAILURE,
                    resourceType: 'DOCUMENT',
                    requestId: command.requestId,
                    metadata: { toolCallId: command.toolCallId, error: message },
                },
            });
        });
    }

    /** 插图重渲染后清理被替换的旧文件：先删 COS 对象再删 FileObject 行，失败不影响主流程。 */
    private async removeSupersededFileObject(file: { id: string; objectKey: string }): Promise<void> {
        await this.storage.deleteObject(file.objectKey);
        await this.prisma.fileObject.deleteMany({ where: { id: file.id } });
    }

    private async renderAndStoreDocumentFile(
        document: DocumentSpec,
        command: GenerateDocumentCommand,
    ): Promise<{ id: string; objectKey: string; mimeType: string; sizeBytes: number; etag: string | null } | null> {
        try {
            const bytes = await this.renderDocumentBytes(document, {
                requestId: command.requestId,
                tenantId: command.tenantId,
                userId: command.userId,
                format: command.format,
            });
            const mimeType = DOCUMENT_FORMAT_MEDIA_TYPES[command.format];
            const objectKey = this.objectKeys.buildGeneratedDocumentKey({
                tenantId: command.tenantId,
                toolCallId: command.toolCallId,
                format: command.format,
            });
            const stored = await this.storage.putObject({ objectKey, body: bytes, contentType: mimeType });
            return { id: randomUUID(), objectKey, mimeType, sizeBytes: stored.sizeBytes, etag: stored.etag };
        } catch {
            // 渲染/上传失败不阻断生成：文档仍以 Markdown + DocumentSpec 落库。
            return null;
        }
    }

    /**
     * 渲染文档字节。渲染前会把 spec 里的 `cos://{objectKey}` 稳定引用换成
     * 当场签发的短期下载 URL：落地存储不能保存会过期的凭据，而渲染进程
     * 只接受 http(s) 与 data URL。
     */
    private async renderDocumentBytes(
        document: DocumentSpec,
        input: { requestId: string; tenantId: string; userId: string; format: DocumentFormat },
    ): Promise<Buffer> {
        const base = {
            request_id: input.requestId,
            tenant_id: input.tenantId,
            user_id: input.userId,
        };
        const documentOptions = {
            title: document.title,
            locale: 'zh-CN',
            template_id: 'business-standard' as const,
            include_toc: false,
            generation_mode: 'fast' as const,
        };
        switch (input.format) {
            case 'docx':
                return this.gateway.renderDocumentDocx({
                    ...base,
                    document: await this.signSpecImageReferences(document),
                    document_options: documentOptions,
                });
            case 'pdf':
                return this.gateway.renderDocumentPdf({
                    ...base,
                    document: await this.signSpecImageReferences(document),
                    document_options: documentOptions,
                });
            case 'pptx':
                return this.gateway.renderDocumentPptx({
                    ...base,
                    pptx: await this.signSpecImageReferences(documentSpecToPptxSpec(document)),
                    options: documentOptions,
                });
        }
    }

    /**
     * 把 spec 中的 `cos://{objectKey}` 稳定引用替换为当场签发的短期下载 URL。
     * 返回深拷贝，不改动传入对象；同一对象键在一次渲染内只签发一次。
     */
    private async signSpecImageReferences<T>(spec: T): Promise<T> {
        const cloned: unknown = JSON.parse(JSON.stringify(spec));
        const signed = new Map<string, string>();
        const visit = async (node: unknown): Promise<void> => {
            if (Array.isArray(node)) {
                for (const item of node) await visit(item);
                return;
            }
            if (node === null || typeof node !== 'object') return;
            const record = node as Record<string, unknown>;
            for (const [key, value] of Object.entries(record)) {
                if (typeof value !== 'string') {
                    await visit(value);
                    continue;
                }
                const objectKey = objectKeyFromImageReference(value);
                if (objectKey === null) continue;
                let url = signed.get(objectKey);
                if (url === undefined) {
                    url = await this.storage.createDownloadUrl(objectKey);
                    signed.set(objectKey, url);
                }
                record[key] = url;
            }
        };
        await visit(cloned);
        return cloned as T;
    }

    /**
     * 断言该工具调用仍持有有效执行租约：EXECUTING、令牌匹配、租约未过期，
     * 且所属轮次仍由当前实例执行。失去租约的旧执行者必须放弃副作用。
     */
    private async requireLiveToolCall(
        claim: ToolExecutionClaim,
        message: string,
        client: ToolCallClaimReader = this.prisma,
    ): Promise<void> {
        const now = new Date();
        const record = await client.toolCall.findFirst({
            where: {
                id: claim.toolCallId,
                tenantId: claim.tenantId,
                turnId: claim.turnId,
                status: ToolCallStatus.EXECUTING,
                executionToken: claim.executionToken,
                leaseExpiresAt: { gt: now },
                turn: {
                    is: {
                        status: 'RUNNING',
                        executionOwner: claim.executionOwner,
                        leaseExpiresAt: { gt: now },
                    },
                },
            },
            select: { id: true },
        });
        if (!record) throw new Error(message);
    }

    private requireGenerationClaim(command: GenerateDocumentCommand): Promise<void> {
        return this.requireLiveToolCall(command, '文档工具执行权已失效，拒绝调用外部模型');
    }

    /** AIActionDraft 的唯一 toolCallId 在调用 Provider 前完成原子抢占。 */
    private async reserveGeneratedDocument(command: GenerateDocumentCommand): Promise<boolean> {
        try {
            await this.prisma.aIActionDraft.create({
                data: {
                    tenantId: command.tenantId,
                    userId: command.userId,
                    actionType: ACTION_TYPE,
                    payload: {
                        instruction: command.instruction,
                        requestedTitle: command.title ?? null,
                        visibility: command.visibility,
                    },
                    status: DraftStatus.DRAFT,
                    toolCallId: command.toolCallId,
                    createdBy: command.userId,
                    updatedBy: command.userId,
                },
            });
            return true;
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
            throw error;
        }
    }

    private async recordGenerationFailure(command: GenerateDocumentCommand, error: unknown): Promise<void> {
        const message = error instanceof Error ? error.message : '文档生成失败';
        await this.prisma.$transaction(async (transaction) => {
            const failed = await transaction.aIActionDraft.updateMany({
                where: {
                    toolCallId: command.toolCallId,
                    status: { not: DraftStatus.EXECUTED },
                },
                data: {
                    status: DraftStatus.FAILED,
                    payload: {
                        instruction: command.instruction,
                        requestedTitle: command.title ?? null,
                        visibility: command.visibility,
                        error: message,
                    },
                    updatedBy: command.userId,
                },
            });
            // A concurrent successful finalization may have committed EXECUTED
            // after the caller's replay check. Do not append a failure audit or
            // overwrite the durable success in that case.
            if (failed.count !== 1) return;
            await transaction.auditLog.create({
                data: {
                    tenantId: command.tenantId,
                    actorUserId: command.userId,
                    actorMembershipId: command.membershipId,
                    action: 'DOCUMENT_GENERATION_FAILED',
                    outcome: AuditOutcome.FAILURE,
                    resourceType: 'DOCUMENT',
                    requestId: command.requestId,
                    metadata: { toolCallId: command.toolCallId, error: message },
                },
            });
        });
    }

    /** 幂等回放：ManagedDocument 的唯一生成工具引用是事实源。 */
    private async findExecutedDocument(
        tenantId: string,
        turnId: string,
        toolCallId: string,
    ): Promise<GeneratedDocument | null> {
        const document = await this.prisma.managedDocument.findFirst({
            where: {
                tenantId,
                generatedByToolCallId: toolCallId,
                generatedByToolCall: { is: { tenantId, turnId } },
            },
            select: { id: true, title: true, content: true },
        });
        if (!document) return null;
        const draft = await this.prisma.aIActionDraft.findUnique({
            where: { toolCallId },
            select: { tenantId: true, status: true, payload: true },
        });
        if (!draft || draft.tenantId !== tenantId || draft.status !== DraftStatus.EXECUTED) return null;

        const payload = draft.payload as { provider?: string; model?: string };
        return {
            documentId: document.id,
            title: document.title,
            contentLength: document.content.length,
            provider: payload.provider ?? '',
            model: payload.model ?? '',
        };
    }

    async getDocument(documentId: string): Promise<DocumentResult> {
        const roleIds = await this.resourceAccess.resolveCurrentRoleIds();
        const document = await this.findAccessibleDocument(documentId, 'document.read', roleIds);
        return this.toDetail(document, roleIds);
    }

    /**
     * 导出文档为 DOCX：读取落库的 DocumentSpec，经 ai-service render-docx
     * 确定性渲染为文件字节。渲染不调用 LLM、不产生 Token 成本，内容与库中
     * Markdown 同源一致。复用 document.read 权限：导出是文档的另一种交付
     * 视图，不是独立资源，不新增权限码。
     */
    async exportDocumentDocx(documentId: string): Promise<DocumentExportResult> {
        const context = this.tenantContext.require();
        const roleIds = await this.resourceAccess.resolveCurrentRoleIds();
        const document = await this.findAccessibleDocument(documentId, 'document.read', roleIds);
        if (!document.documentSpec) {
            throw new BadRequestException({
                code: 'DOCUMENT_DOCX_UNAVAILABLE',
                message: '该文档没有可导出的生成规格（可能由人工创建或内容已被手工修改）',
            });
        }

        const request: RenderDocxRequest = {
            request_id: context.requestId,
            tenant_id: context.tenantId,
            user_id: context.userId,
            document: document.documentSpec as unknown as DocumentSpec,
            document_options: {
                title: resolveDocumentTitle(document),
                locale: 'zh-CN',
                template_id: 'business-standard',
                include_toc: false,
                generation_mode: 'fast',
            },
        };
        const bytes = await this.gateway.renderDocumentDocx(request);
        await this.prisma.auditLog.create({
            data: {
                tenantId: context.tenantId,
                actorUserId: context.userId,
                actorMembershipId: context.membershipId,
                action: 'DOCUMENT_EXPORTED',
                outcome: AuditOutcome.SUCCESS,
                resourceType: 'DOCUMENT',
                resourceId: documentId,
                requestId: context.requestId,
                metadata: {
                    format: 'docx',
                    title: document.title,
                    contentLength: document.content.length,
                    byteLength: bytes.length,
                },
            },
        });
        return { filename: resolveDocumentTitle(document), bytes };
    }

    /**
     * 导出文档为 PDF：读取落库的 DocumentSpec，经 ai-service render-pdf
     * 确定性渲染为内嵌 CJK 字体的 PDF 字节。渲染不调用 LLM、不产生 Token 成本。
     */
    async exportDocumentPdf(documentId: string): Promise<DocumentExportResult> {
        const context = this.tenantContext.require();
        const roleIds = await this.resourceAccess.resolveCurrentRoleIds();
        const document = await this.findAccessibleDocument(documentId, 'document.read', roleIds);
        if (!document.documentSpec) {
            throw new BadRequestException({
                code: 'DOCUMENT_PDF_UNAVAILABLE',
                message: '该文档没有可导出的生成规格（可能由人工创建或内容已被手工修改）',
            });
        }

        const request: RenderPdfRequest = {
            request_id: context.requestId,
            tenant_id: context.tenantId,
            user_id: context.userId,
            document: document.documentSpec as unknown as DocumentSpec,
            document_options: {
                title: resolveDocumentTitle(document),
                locale: 'zh-CN',
                template_id: 'business-standard',
                include_toc: false,
                generation_mode: 'fast',
            },
        };
        const bytes = await this.gateway.renderDocumentPdf(request);
        await this.prisma.auditLog.create({
            data: {
                tenantId: context.tenantId,
                actorUserId: context.userId,
                actorMembershipId: context.membershipId,
                action: 'DOCUMENT_EXPORTED',
                outcome: AuditOutcome.SUCCESS,
                resourceType: 'DOCUMENT',
                resourceId: documentId,
                requestId: context.requestId,
                metadata: {
                    format: 'pdf',
                    title: document.title,
                    contentLength: document.content.length,
                    byteLength: bytes.length,
                },
            },
        });
        return { filename: resolveDocumentTitle(document), bytes };
    }

    /**
     * 导出文档为 PPTX：把落库的 DocumentSpec 按「一节一页」映射为 PptxSpec，
     * 经 ai-service render-pptx 确定性渲染。渲染不调用 LLM、不产生 Token 成本。
     */
    async exportDocumentPptx(documentId: string): Promise<DocumentExportResult> {
        const context = this.tenantContext.require();
        const roleIds = await this.resourceAccess.resolveCurrentRoleIds();
        const document = await this.findAccessibleDocument(documentId, 'document.read', roleIds);
        if (!document.documentSpec) {
            throw new BadRequestException({
                code: 'DOCUMENT_PPTX_UNAVAILABLE',
                message: '该文档没有可导出的生成规格（可能由人工创建或内容已被手工修改）',
            });
        }

        const pptx = documentSpecToPptxSpec(document.documentSpec as unknown as DocumentSpec);
        const request: RenderPptxRequest = {
            request_id: context.requestId,
            tenant_id: context.tenantId,
            user_id: context.userId,
            pptx,
            options: {
                title: resolveDocumentTitle(document),
                locale: 'zh-CN',
                template_id: 'business-standard',
                include_toc: false,
                generation_mode: 'fast',
            },
        };
        const bytes = await this.gateway.renderDocumentPptx(request);
        await this.prisma.auditLog.create({
            data: {
                tenantId: context.tenantId,
                actorUserId: context.userId,
                actorMembershipId: context.membershipId,
                action: 'DOCUMENT_EXPORTED',
                outcome: AuditOutcome.SUCCESS,
                resourceType: 'DOCUMENT',
                resourceId: documentId,
                requestId: context.requestId,
                metadata: {
                    format: 'pptx',
                    title: document.title,
                    contentLength: document.content.length,
                    byteLength: bytes.length,
                },
            },
        });
        return { filename: resolveDocumentTitle(document), bytes };
    }

    /**
     * 下载生成时落盘的正式文件（DOCX/PDF/PPTX）：读取 fileObject 对象键，
     * 签发短期下载 URL。与 export 不同，不重新渲染、不调用 LLM，直接交付已落盘字节。
     */
    async getDocumentFileDownload(documentId: string): Promise<{ filename: string; url: string }> {
        const roleIds = await this.resourceAccess.resolveCurrentRoleIds();
        const document = await this.findAccessibleDocument(documentId, 'document.read', roleIds);
        if (!document.fileObject) {
            throw new BadRequestException({
                code: 'DOCUMENT_FILE_UNAVAILABLE',
                message: '该文档没有落盘的生成文件（可能由人工创建）',
            });
        }
        const url = await this.storage.createDownloadUrl(document.fileObject.objectKey);
        return {
            filename: `${resolveDocumentTitle(document)}.${extensionOfMimeType(document.fileObject.mimeType)}`,
            url,
        };
    }

    async updateDocument(documentId: string, input: UpdateDocumentDto): Promise<DocumentResult> {
        const context = this.tenantContext.require();
        if (input.title === undefined && input.content === undefined && input.visibility === undefined) {
            throw new BadRequestException({ code: 'DOCUMENT_UPDATE_EMPTY', message: '至少提供一个需要修改的字段' });
        }
        const roleIds = await this.resourceAccess.resolveCurrentRoleIds();
        const document = await this.findAccessibleDocument(documentId, 'document.update', roleIds);
        const data: Prisma.ManagedDocumentUpdateManyMutationInput = {
            version: { increment: 1 },
            updatedBy: context.userId,
        };
        if (input.title !== undefined) data.title = input.title.trim();
        if (input.content !== undefined) {
            data.content = input.content;
            // 手工编辑 Markdown 后逆向重建 DocumentSpec，保持 DOCX/PDF/PPTX 三种格式可继续导出。
            data.documentSpec = markdownToDocumentSpec(
                input.content,
                input.title?.trim() ?? document.title,
            ) as unknown as Prisma.InputJsonValue;
        }
        if (input.visibility !== undefined) data.visibility = input.visibility;

        await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.managedDocument.updateMany({
                where: { id: documentId, tenantId: context.tenantId, version: input.version, deletedAt: null },
                data,
            });
            if (updated.count !== 1) throw this.versionConflict();
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'DOCUMENT_UPDATED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'DOCUMENT',
                    resourceId: documentId,
                    requestId: context.requestId,
                    metadata: {
                        before: documentSnapshot(document),
                        changes: {
                            title: input.title ?? null,
                            visibility: input.visibility ?? null,
                            contentLength: input.content === undefined ? null : input.content.length,
                        },
                    },
                },
            });
        });
        return this.toDetail(await this.requireCurrentDocument(documentId), roleIds);
    }

    async deleteDocument(documentId: string, version: number): Promise<void> {
        const context = this.tenantContext.require();
        const roleIds = await this.resourceAccess.resolveCurrentRoleIds();
        const document = await this.findAccessibleDocument(documentId, 'document.delete', roleIds);
        const now = new Date();
        await this.prisma.$transaction(async (transaction) => {
            const deleted = await transaction.managedDocument.updateMany({
                where: { id: documentId, tenantId: context.tenantId, version, deletedAt: null },
                data: { deletedAt: now, updatedBy: context.userId, version: { increment: 1 } },
            });
            if (deleted.count !== 1) throw this.versionConflict();
            await transaction.resource.updateMany({
                where: { id: documentId, tenantId: context.tenantId, deletedAt: null },
                data: { deletedAt: now, updatedBy: context.userId, version: { increment: 1 } },
            });
            await transaction.resourceAcl.updateMany({
                where: { tenantId: context.tenantId, resourceId: documentId, deletedAt: null },
                data: { deletedAt: now, updatedBy: context.userId, version: { increment: 1 } },
            });
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'DOCUMENT_DELETED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'DOCUMENT',
                    resourceId: documentId,
                    requestId: context.requestId,
                    metadata: { before: documentSnapshot(document) },
                },
            });
        });
    }

    private async findAccessibleDocument(
        documentId: string,
        permissionCode: string,
        roleIds: string[],
    ): Promise<ManagedDocumentWithAccess> {
        const accessWhere = this.resourceAccess.documentWhere(permissionCode, roleIds);
        const document = await this.prisma.managedDocument.findFirst({
            where: { AND: [accessWhere, { id: documentId }] },
            include: managedDocumentAccessInclude,
        });
        if (!document) throw this.documentNotFound();
        return document;
    }

    private async requireCurrentDocument(documentId: string): Promise<ManagedDocumentWithAccess> {
        const { tenantId } = this.tenantContext.require();
        const document = await this.prisma.managedDocument.findFirst({
            where: { id: documentId, tenantId, deletedAt: null, resource: { is: { deletedAt: null } } },
            include: managedDocumentAccessInclude,
        });
        if (!document) throw this.documentNotFound();
        return document;
    }

    private toSummary(document: ManagedDocumentWithAccess, roleIds: string[]): DocumentSummaryResult {
        return {
            id: document.id,
            resourceId: document.id,
            title: document.title,
            visibility: document.visibility,
            ownerMembershipId: document.resource.ownerMembershipId,
            effectivePermissions: this.resourceAccess.effectiveDocumentPermissions(document, roleIds),
            version: document.version,
            createdAt: document.createdAt,
            updatedAt: document.updatedAt,
        };
    }

    private toDetail(document: ManagedDocumentWithAccess, roleIds: string[]): DocumentResult {
        return {
            ...this.toSummary(document, roleIds),
            content: document.content,
            documentSpec: document.documentSpec,
            fileObjectId: document.fileObject?.id ?? null,
            fileMimeType: document.fileObject?.mimeType ?? null,
        };
    }

    private documentNotFound(): NotFoundException {
        return new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: '文档不存在或不在授权范围内' });
    }

    private versionConflict(): ConflictException {
        return new ConflictException({ code: 'RESOURCE_VERSION_CONFLICT', message: '数据已被其他请求修改，请刷新后重试' });
    }
}

function documentSnapshot(document: ManagedDocumentWithAccess): Prisma.InputJsonObject {
    return {
        documentId: document.id,
        title: document.title,
        visibility: document.visibility,
        ownerMembershipId: document.resource.ownerMembershipId,
        contentLength: document.content.length,
        version: document.version,
    };
}

/**
 * 清理文件名主名中的非法字符并限制长度：去掉文件系统与 HTTP 头禁忌字符、控制符，
 * 折叠空白并去掉结尾的点（避免 Windows 隐藏文件与扩展名歧义）。
 * 返回清洗后的结果，可能为空字符串，由调用方决定兜底名。
 */
function sanitizeFilenameSegment(title: string | null | undefined): string {
    return (title ?? '')
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\.+$/g, '')
        .slice(0, 120);
}

/**
 * 解析导出/下载对外的文档标题：优先落库标题；标题为空、或清洗后为空（例如历史上被
 * 误转码成 "??????" 占位符）时回退 DocumentSpec.title；仍无可用标题时兜底中性名 "document"。
 * 该值同时驱动 Content-Disposition 文件名与渲染封面标题，避免坏标题一路带到用户手里。
 */
function resolveDocumentTitle(document: { title: string; documentSpec: Prisma.JsonValue | null }): string {
    const specTitle = (document.documentSpec as unknown as DocumentSpec | null)?.title;
    return sanitizeFilenameSegment(document.title) || sanitizeFilenameSegment(specTitle) || 'document';
}

/** 由生成文件 MIME 类型推断下载扩展名。 */
function extensionOfMimeType(mimeType: string): string {
    switch (mimeType) {
        case 'application/pdf':
            return 'pdf';
        case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
            return 'pptx';
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
            return 'docx';
        default:
            return 'bin';
    }
}

/**
 * 解析文档 spec 中的稳定图片引用：命中 `cos://{objectKey}` 时返回对象键，
 * 其余字符串（http(s)、data URL）返回 null。签名 URL 只在渲染前现场签发。
 */
function objectKeyFromImageReference(value: string): string | null {
    if (!value.startsWith(IMAGE_REFERENCE_PREFIX)) return null;
    const objectKey = value.slice(IMAGE_REFERENCE_PREFIX.length).trim();
    return objectKey.length > 0 ? objectKey : null;
}

/** 由生成工具名推导文档格式：generate_pdf → pdf，用于插图后按原格式重渲染。 */
function documentFormatFromToolName(name: string | null | undefined): DocumentFormat | null {
    switch (name) {
        case 'generate_docx':
            return 'docx';
        case 'generate_pdf':
            return 'pdf';
        case 'generate_pptx':
            return 'pptx';
        default:
            return null;
    }
}

/**
 * 定位目标章节：先精确匹配标题，再退化为「忽略空白与序号标点」的归一化匹配，
 * 最后允许包含匹配。命中不唯一时取第一个，命中不到返回 -1。
 */
function locateSectionIndex(sections: DocumentSection[], target: string): number {
    const exact = sections.findIndex((section) => section.heading.trim() === target);
    if (exact >= 0) return exact;
    const normalize = (value: string): string =>
        value.replace(/[\s\u3000·.、,，:：;；\-—_()（）[\]【】]/g, '').toLowerCase();
    const wanted = normalize(target);
    if (!wanted) return -1;
    const normalizedHeadings = sections.map((section) => normalize(section.heading));
    const normalizedExact = normalizedHeadings.findIndex((heading) => heading === wanted);
    if (normalizedExact >= 0) return normalizedExact;
    return normalizedHeadings.findIndex((heading) => heading.includes(wanted) || wanted.includes(heading));
}

/**
 * 在目标章节的 blocks 尾部追加一个 ImageBlock；正文与既有块完全不变。
 * 省略 sectionTitle 时命中最后一节；命中不存在的标题直接拒绝，避免静默插错位置。
 * 返回深拷贝，不改动传入的 spec。
 */
function appendImageToSection(
    document: DocumentSpec,
    input: { imageReference: string; caption?: string; sectionTitle?: string },
): { spec: DocumentSpec; sectionIndex: number; sectionHeading: string } {
    const spec = JSON.parse(JSON.stringify(document)) as DocumentSpec;
    if (spec.sections.length === 0) {
        throw new BadRequestException({
            code: 'DOCUMENT_SECTION_EMPTY',
            message: '该文档没有任何章节，无法插入图片',
        });
    }
    const target = input.sectionTitle?.trim();
    let sectionIndex = spec.sections.length - 1;
    if (target) {
        const located = locateSectionIndex(spec.sections, target);
        if (located < 0) {
            throw new BadRequestException({
                code: 'DOCUMENT_SECTION_NOT_FOUND',
                message: `未找到标题为「${target}」的章节`,
                details: { sectionTitle: target, availableSections: spec.sections.map((s) => s.heading) },
            });
        }
        sectionIndex = located;
    }
    const section = spec.sections[sectionIndex];
    const block: ImageBlock = {
        type: 'image',
        url: input.imageReference,
        alt: input.caption ?? section.heading,
        ...(input.caption !== undefined ? { caption: input.caption } : {}),
    };
    section.blocks.push(block);
    return { spec, sectionIndex, sectionHeading: section.heading };
}

/** 把 ai-service 的结构化 DocumentSpec 序列化为 Markdown 文本落库。 */
function documentSpecToMarkdown(document: DocumentSpec): string {
    const lines: string[] = [`# ${document.title}`];
    if (document.subtitle) {
        lines.push('', `> ${document.subtitle}`);
    }
    for (const section of document.sections) {
        const level = Math.min(Math.max(section.level, 1), 3) + 1;
        lines.push('', `${'#'.repeat(level)} ${section.heading}`);
        for (const block of section.blocks) {
            switch (block.type) {
                case 'paragraph':
                    lines.push('', block.text);
                    break;
                case 'bullet_list':
                    lines.push('', ...block.items.map((item) => `- ${item}`));
                    break;
                case 'numbered_list':
                    lines.push('', ...block.items.map((item, index) => `${index + 1}. ${item}`));
                    break;
                case 'quote':
                    lines.push('', `> ${block.text}`);
                    if (block.attribution) {
                        lines.push(`> — ${block.attribution}`);
                    }
                    break;
                case 'table':
                    lines.push('', `| ${block.columns.join(' | ')} |`);
                    lines.push(`| ${block.columns.map(() => '---').join(' | ')} |`);
                    for (const row of block.rows) {
                        lines.push(`| ${row.join(' | ')} |`);
                    }
                    break;
                case 'page_break':
                    lines.push('', '---');
                    break;
            }
        }
    }
    return lines.join('\n');
}

/** 把 DocumentSpec 按「一节一页」映射为 PptxSpec，供 render-pptx 渲染。 */
function documentSpecToPptxSpec(document: DocumentSpec): PptxSpec {
    return {
        schema_version: '1.0',
        title: document.title,
        subtitle: document.subtitle ?? null,
        theme: 'brand',
        slides: document.sections.map((section): PptxSlide => ({
            title: section.heading,
            layout: 'title_and_content',
            blocks: section.blocks.flatMap((block): PptxBlock[] => {
                switch (block.type) {
                    case 'paragraph':
                        return [{ type: 'paragraph', text: block.text }];
                    case 'bullet_list':
                        return [{ type: 'bullet_list', items: block.items }];
                    case 'numbered_list':
                        return [{ type: 'numbered_list', items: block.items }];
                    case 'quote':
                        return [{ type: 'quote', text: block.text, attribution: block.attribution ?? null }];
                    case 'table':
                        return [{ type: 'table', columns: block.columns, rows: block.rows }];
                    case 'image':
                        // 图片在 PPTX 里同样落在所属章节页内；PptxImageBlock 不接受
                        // width_ratio，尺寸由渲染器按版面自适应，故此处只透传位置与说明。
                        return [{
                            type: 'image',
                            url: block.url,
                            alt: block.alt ?? null,
                            caption: block.caption ?? null,
                        }];
                    default:
                        return [];
                }
            }),
        })),
    };
}

/**
 * 把 documentSpecToMarkdown 生成的 Markdown 逆向解析回 DocumentSpec，
 * 使手工编辑 Markdown 后仍能导出 DOCX/PDF/PPTX。解析是确定性的、有损的：
 * 无法识别的行按段落处理，page_break 由 `---` 表示。
 */
function markdownToDocumentSpec(markdown: string, fallbackTitle: string): DocumentSpec {
    const lines = markdown.split('\n');
    let title = fallbackTitle;
    let subtitle: string | null = null;
    let index = 0;

    if (lines[0]?.startsWith('# ')) {
        title = lines[0].slice(2).trim() || fallbackTitle;
        index = 1;
    }
    while (index < lines.length && lines[index].trim() === '') index += 1;
    if (index < lines.length && lines[index].startsWith('> ')) {
        subtitle = lines[index].slice(2).trim() || null;
        index += 1;
        while (index < lines.length && lines[index].trim() === '') index += 1;
    }

    const sections: DocumentSection[] = [];
    let currentHeading = '';
    let currentLevel = 1;
    let blocks: DocumentBlock[] = [];

    const flush = (): void => {
        if (currentHeading) sections.push({ heading: currentHeading, level: currentLevel, blocks });
        blocks = [];
    };

    while (index < lines.length) {
        const line = lines[index];
        if (line.trim() === '') {
            index += 1;
            continue;
        }
        const heading = line.match(/^(#{2,4})\s+(.+)$/);
        if (heading) {
            flush();
            currentHeading = heading[2].trim();
            currentLevel = heading[1].length - 1;
            index += 1;
            continue;
        }
        if (line.trim() === '---') {
            blocks.push({ type: 'page_break' });
            index += 1;
            continue;
        }
        if (line.trim().startsWith('|')) {
            const parsed = _parseMarkdownTable(lines, index);
            blocks.push(parsed.block);
            index = parsed.nextIndex;
            continue;
        }
        if (line.trim().startsWith('- ')) {
            const items: string[] = [];
            while (index < lines.length && lines[index].trim().startsWith('- ')) {
                items.push(lines[index].trim().slice(2));
                index += 1;
            }
            blocks.push({ type: 'bullet_list', items });
            continue;
        }
        if (/^\d+\.\s/.test(line.trim())) {
            const items: string[] = [];
            while (index < lines.length && /^\d+\.\s/.test(lines[index].trim())) {
                items.push(lines[index].trim().replace(/^\d+\.\s/, ''));
                index += 1;
            }
            blocks.push({ type: 'numbered_list', items });
            continue;
        }
        if (line.trim().startsWith('> ')) {
            const text = line.trim().slice(2);
            let attribution: string | null = null;
            if (lines[index + 1]?.trim().startsWith('> —')) {
                attribution = lines[index + 1].trim().slice(3).trim() || null;
                index += 2;
            } else {
                index += 1;
            }
            blocks.push({ type: 'quote', text, attribution });
            continue;
        }
        blocks.push({ type: 'paragraph', text: line.trim() });
        index += 1;
    }
    flush();

    return { schema_version: '1.0', title, subtitle, sections, source_refs: [] };
}

function _parseMarkdownTable(lines: string[], startIndex: number): { block: DocumentBlock; nextIndex: number } {
    const columns = lines[startIndex].trim().split('|').slice(1, -1).map((cell) => cell.trim());
    let index = startIndex + 1;
    if (index < lines.length && /^\|(\s*:?-+:?\s*\|)+$/.test(lines[index].trim())) index += 1;
    const rows: string[][] = [];
    while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(lines[index].trim().split('|').slice(1, -1).map((cell) => cell.trim()));
        index += 1;
    }
    return { block: { type: 'table', columns, rows }, nextIndex: index };
}
