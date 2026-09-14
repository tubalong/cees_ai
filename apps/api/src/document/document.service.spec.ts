import { NotFoundException } from '@nestjs/common';
import { AuditOutcome, DocumentVisibility, DraftStatus, ResourceType } from '@prisma/client';
import type { ComposeDocumentResponse } from '@cees/ai-service-client';
import { AiServiceGateway } from '../ai-orchestration/ai-service-gateway.service';
import { PrismaService } from '../database/prisma.service';
import { ManagedDocumentWithAccess, ResourceAccessService } from '../resource/resource-access.service';
import { TenantContext } from '../tenant/tenant-context';
import { DocumentService } from './document.service';

describe('DocumentService', () => {
    it('creates Resource, Document and audit in one transaction', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(documentRecord());
        const access = createAccessMock();
        const service = createService(prisma, access);

        const result = await service.createDocument({
            title: ' Project plan ',
            content: 'content',
            visibility: DocumentVisibility.PRIVATE,
        });

        expect(result.title).toBe('Project plan');
        expect(prisma.resource.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: TENANT_ID,
                type: ResourceType.DOCUMENT,
                ownerMembershipId: MEMBERSHIP_ID,
            }),
        });
        expect(prisma.managedDocument.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ title: 'Project plan', content: 'content' }),
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'DOCUMENT_CREATED' }),
        });
    });

    it('lists only SQL-filtered accessible documents and returns a cursor', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findMany.mockResolvedValue([
            documentRecord({ id: DOCUMENT_ID }),
            documentRecord({ id: SECOND_DOCUMENT_ID, title: 'Second' }),
        ]);
        const access = createAccessMock();
        const service = createService(prisma, access);

        const result = await service.listDocuments({ limit: 1, keyword: 'plan' });

        expect(result.items).toHaveLength(1);
        expect(result.nextCursor).toBe(DOCUMENT_ID);
        expect(access.documentWhere).toHaveBeenCalledWith('document.read', [ROLE_ID]);
        expect(prisma.managedDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
    });

    it('returns not found when the document is outside the access scope', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(null);
        const service = createService(prisma, createAccessMock());

        await expect(service.getDocument(DOCUMENT_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates an accessible document with optimistic locking and audit', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst
            .mockResolvedValueOnce(documentRecord())
            .mockResolvedValueOnce(documentRecord({ title: 'Updated', version: 2 }));
        prisma.managedDocument.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma, createAccessMock());

        const result = await service.updateDocument(DOCUMENT_ID, { title: 'Updated', version: 1 });

        expect(result.version).toBe(2);
        expect(prisma.managedDocument.updateMany).toHaveBeenCalledWith({
            where: { id: DOCUMENT_ID, tenantId: TENANT_ID, version: 1, deletedAt: null },
            data: expect.objectContaining({ title: 'Updated', version: { increment: 1 } }),
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'DOCUMENT_UPDATED' }),
        });
    });

    it('soft deletes the document, resource and ACL entries', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(documentRecord());
        prisma.managedDocument.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma, createAccessMock());

        await service.deleteDocument(DOCUMENT_ID, 1);

        expect(prisma.resource.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: DOCUMENT_ID, tenantId: TENANT_ID, deletedAt: null },
        }));
        expect(prisma.resourceAcl.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenantId: TENANT_ID, resourceId: DOCUMENT_ID, deletedAt: null },
        }));
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'DOCUMENT_DELETED' }),
        });
    });

    it('composes via ai-service and persists Resource, Document, AIActionDraft and audit in one transaction', async () => {
        const prisma = createPrismaMock();
        const gateway = { composeDocument: jest.fn().mockResolvedValue(composeResponse()) };
        const service = createService(prisma, createAccessMock(), gateway);

        const result = await service.createGeneratedDocument({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'request-id',
            conversationId: '60000000-0000-0000-0000-000000000001',
            turnId: 'turn-id',
            toolCallId: 'tool-call-id',
            executionOwner: 'api:test',
            executionToken: 'execution-token-1',
            instruction: '写一份项目周报',
            visibility: DocumentVisibility.PRIVATE,
        });

        expect(gateway.composeDocument).toHaveBeenCalledWith(expect.objectContaining({
            request_id: 'request-id',
            instruction: '写一份项目周报',
            source_materials: [],
            document_options: expect.objectContaining({ generation_mode: 'fast', locale: 'zh-CN' }),
        }), expect.objectContaining({ toolCallId: 'tool-call-id' }));
        expect(prisma.resource.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ type: ResourceType.DOCUMENT, ownerMembershipId: MEMBERSHIP_ID }),
        });
        expect(prisma.managedDocument.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                title: '项目周报',
                content: expect.stringContaining('# 项目周报') as unknown,
                visibility: DocumentVisibility.PRIVATE,
            }),
        });
        expect(prisma.aIActionDraft.update).toHaveBeenCalledWith({
            where: { toolCallId: 'tool-call-id' },
            data: expect.objectContaining({
                status: DraftStatus.EXECUTED,
                executedResourceType: 'DOCUMENT',
            }),
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'DOCUMENT_GENERATED', outcome: AuditOutcome.SUCCESS }),
        });
        expect(result).toEqual(expect.objectContaining({
            title: '项目周报',
            provider: 'openai_compatible',
            model: 'doc-model',
        }));
    });

    it('replays the persisted document for the same tool_call_id without composing again', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue({
            id: DOCUMENT_ID,
            tenantId: TENANT_ID,
            title: '项目周报',
            content: '# 项目周报',
        });
        prisma.aIActionDraft.findUnique.mockResolvedValue({
            tenantId: TENANT_ID,
            status: DraftStatus.EXECUTED,
            payload: { provider: 'openai_compatible', model: 'doc-model' },
        });
        const gateway = { composeDocument: jest.fn() };
        const service = createService(prisma, createAccessMock(), gateway);

        const result = await service.createGeneratedDocument({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'request-id',
            conversationId: '60000000-0000-0000-0000-000000000001',
            turnId: 'turn-id',
            toolCallId: 'tool-call-id',
            executionOwner: 'api:test',
            executionToken: 'execution-token-1',
            instruction: '写一份项目周报',
            visibility: DocumentVisibility.PRIVATE,
        });

        expect(gateway.composeDocument).not.toHaveBeenCalled();
        expect(result).toEqual(expect.objectContaining({
            documentId: DOCUMENT_ID,
            title: '项目周报',
            provider: 'openai_compatible',
            model: 'doc-model',
        }));
    });

    it('does not write a failure audit after a concurrent successful finalization', async () => {
        const prisma = createPrismaMock();
        prisma.aIActionDraft.updateMany.mockResolvedValue({ count: 0 });
        const service = createService(prisma, createAccessMock());
        const command = {
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'request-id',
            conversationId: '60000000-0000-0000-0000-000000000001',
            turnId: 'turn-id',
            toolCallId: 'tool-call-id',
            executionOwner: 'api:test',
            executionToken: 'execution-token-1',
            instruction: '写一份项目周报',
            visibility: DocumentVisibility.PRIVATE,
        };

        await expect((service as any).recordGenerationFailure(
            command,
            new Error('late failure'),
        )).resolves.toBeUndefined();

        expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const ROLE_ID = '20000000-0000-0000-0000-000000000001';
const DOCUMENT_ID = '70000000-0000-0000-0000-000000000001';
const SECOND_DOCUMENT_ID = '70000000-0000-0000-0000-000000000002';
const NOW = new Date('2026-09-07T00:00:00.000Z');

function createService(prisma: Record<string, any>, access: Record<string, any>, gateway: Record<string, any> = { composeDocument: jest.fn() }): DocumentService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'request-id',
            roles: ['tenant_admin'],
            permissions: [
                'document.create',
                'document.read',
                'document.update',
                'document.delete',
                'document.share',
                'document.manage_all',
            ],
        }),
    } as unknown as TenantContext;
    return new DocumentService(
        prisma as unknown as PrismaService,
        tenantContext,
        access as unknown as ResourceAccessService,
        gateway as unknown as AiServiceGateway,
    );
}

function createAccessMock(): Record<string, any> {
    return {
        resolveCurrentRoleIds: jest.fn().mockResolvedValue([ROLE_ID]),
        documentWhere: jest.fn().mockReturnValue({ tenantId: TENANT_ID, deletedAt: null }),
        effectiveDocumentPermissions: jest.fn().mockReturnValue(['document.read', 'document.update']),
    };
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        resource: { create: jest.fn(), updateMany: jest.fn() },
        managedDocument: {
            create: jest.fn(),
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn(),
            findMany: jest.fn(),
            updateMany: jest.fn(),
        },
        aIActionDraft: {
            create: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            findFirst: jest.fn(),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        toolCall: { findFirst: jest.fn().mockResolvedValue({ id: 'tool-call-id' }) },
        resourceAcl: { updateMany: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function documentRecord(overrides: Record<string, unknown> = {}): ManagedDocumentWithAccess {
    return {
        id: DOCUMENT_ID,
        tenantId: TENANT_ID,
        title: 'Project plan',
        content: 'content',
        visibility: DocumentVisibility.PRIVATE,
        createdAt: NOW,
        updatedAt: NOW,
        createdBy: USER_ID,
        updatedBy: USER_ID,
        deletedAt: null,
        version: 1,
        generatedByToolCallId: null,
        resource: {
            id: DOCUMENT_ID,
            tenantId: TENANT_ID,
            type: ResourceType.DOCUMENT,
            ownerMembershipId: MEMBERSHIP_ID,
            createdAt: NOW,
            updatedAt: NOW,
            createdBy: USER_ID,
            updatedBy: USER_ID,
            deletedAt: null,
            version: 1,
            acls: [],
        },
        ...overrides,
    } as ManagedDocumentWithAccess;
}

function composeResponse(): ComposeDocumentResponse {
    return {
        request_id: 'request-id',
        document: {
            schema_version: '1.0',
            title: '项目周报',
            subtitle: null,
            sections: [
                {
                    heading: '本周进展',
                    level: 1,
                    blocks: [
                        { type: 'paragraph', text: '完成工具循环接入。' },
                        { type: 'bullet_list', items: ['图片生成', '文档生成'] },
                    ],
                },
            ],
            source_refs: [],
        },
        execution: {
            profile: 'primary',
            provider: 'openai_compatible',
            model: 'doc-model',
            fallback_count: 0,
            latency_ms: 120,
            finish_reason: 'stop',
            token_usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
        },
    };
}
