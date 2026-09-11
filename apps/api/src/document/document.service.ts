import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditOutcome, DocumentVisibility, DraftStatus, Prisma, ResourceType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { ComposeDocumentRequest, DocumentSpec } from '@cees/ai-service-client';
import { AiServiceGateway } from '../ai-orchestration/ai-service-gateway.service';
import { PrismaService } from '../database/prisma.service';
import {
    managedDocumentAccessInclude,
    ManagedDocumentWithAccess,
    ResourceAccessService,
} from '../resource/resource-access.service';
import { TenantContext } from '../tenant/tenant-context';
import { CreateDocumentDto, ListDocumentsQueryDto, UpdateDocumentDto } from './dto';
import { DocumentListResult, DocumentResult, DocumentSummaryResult } from './document.types';

/** AIActionDraft.actionType：与权限码保持一致，动作流水与权限语义一一对应。 */
const ACTION_TYPE = 'ai.document.generate';

export interface GenerateDocumentCommand {
    tenantId: string;
    userId: string;
    membershipId: string;
    requestId: string;
    turnId: string;
    toolCallId: string;
    instruction: string;
    title?: string;
    visibility: DocumentVisibility;
}

export interface GeneratedDocument {
    documentId: string;
    title: string;
    contentLength: number;
    provider: string;
    model: string;
}

@Injectable()
export class DocumentService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
        private readonly resourceAccess: ResourceAccessService,
        private readonly gateway: AiServiceGateway,
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
        const existing = await this.findExecutedDocument(command.tenantId, command.toolCallId);
        if (existing) return existing;

        const request: ComposeDocumentRequest = {
            request_id: command.requestId,
            tenant_id: command.tenantId,
            user_id: command.userId,
            instruction: command.instruction,
            source_materials: [],
            document_options: {
                ...(command.title !== undefined ? { title: command.title } : {}),
                locale: 'zh-CN',
                template_id: 'business-standard',
                include_toc: false,
                generation_mode: 'fast',
            },
        };
        const upstream = await this.gateway.composeDocument(request, {
            membershipId: command.membershipId,
            turnId: command.turnId,
            toolCallId: command.toolCallId,
        });

        const documentId = randomUUID();
        const content = documentSpecToMarkdown(upstream.document);
        await this.prisma.$transaction(async (transaction) => {
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
            await transaction.managedDocument.create({
                data: {
                    id: documentId,
                    tenantId: command.tenantId,
                    title: upstream.document.title,
                    content,
                    visibility: command.visibility,
                    createdBy: command.userId,
                    updatedBy: command.userId,
                },
            });
            await transaction.aIActionDraft.create({
                data: {
                    tenantId: command.tenantId,
                    userId: command.userId,
                    actionType: ACTION_TYPE,
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
                    toolCallId: command.toolCallId,
                    executedResourceType: 'DOCUMENT',
                    executedResourceId: documentId,
                    createdBy: command.userId,
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
                        instruction: command.instruction,
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
    }

    /** 幂等回放：同一 tool_call_id 已执行成功时返回原文档与执行元数据。 */
    private async findExecutedDocument(tenantId: string, toolCallId: string): Promise<GeneratedDocument | null> {
        const draft = await this.prisma.aIActionDraft.findFirst({
            where: { tenantId, toolCallId, status: DraftStatus.EXECUTED },
            orderBy: { createdAt: 'desc' },
            select: { executedResourceId: true, payload: true },
        });
        if (!draft?.executedResourceId) return null;

        const document = await this.prisma.managedDocument.findFirst({
            where: { tenantId, id: draft.executedResourceId, deletedAt: null },
            select: { id: true, title: true, content: true },
        });
        if (!document) return null;

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
        if (input.content !== undefined) data.content = input.content;
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
        return { ...this.toSummary(document, roleIds), content: document.content };
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
