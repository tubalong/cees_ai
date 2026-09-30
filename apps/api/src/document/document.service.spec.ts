import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditOutcome, DocumentVisibility, DraftStatus, Prisma, ResourceType } from '@prisma/client';
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
            format: 'docx',
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
                documentSpec: expect.objectContaining({ schema_version: '1.0', title: '项目周报' }) as unknown,
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
            format: 'docx',
        });

        expect(gateway.composeDocument).not.toHaveBeenCalled();
        expect(result).toEqual(expect.objectContaining({
            documentId: DOCUMENT_ID,
            title: '项目周报',
            provider: 'openai_compatible',
            model: 'doc-model',
        }));
    });

    it('rebuilds the stored document spec when content is manually edited', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst
            .mockResolvedValueOnce(documentRecord())
            .mockResolvedValueOnce(documentRecord({ title: 'Project plan', version: 2 }));
        prisma.managedDocument.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma, createAccessMock());

        await service.updateDocument(DOCUMENT_ID, { content: 'manually edited', version: 1 });

        expect(prisma.managedDocument.updateMany).toHaveBeenCalledWith({
            where: { id: DOCUMENT_ID, tenantId: TENANT_ID, version: 1, deletedAt: null },
            data: expect.objectContaining({ content: 'manually edited', documentSpec: expect.objectContaining({ schema_version: '1.0' }) }),
        });
    });

    it('exports the document as DOCX via ai-service render-docx and audits it', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(documentRecord({
            documentSpec: {
                schema_version: '1.0',
                title: 'Project plan',
                subtitle: null,
                sections: [{ heading: 'Overview', level: 1, blocks: [{ type: 'paragraph', text: 'content' }] }],
                source_refs: [],
            },
        }));
        const gateway = {
            composeDocument: jest.fn(),
            renderDocumentDocx: jest.fn().mockResolvedValue(Buffer.from('docx-bytes')),
        };
        const service = createService(prisma, createAccessMock(), gateway);

        const result = await service.exportDocumentDocx(DOCUMENT_ID);

        expect(gateway.renderDocumentDocx).toHaveBeenCalledWith(expect.objectContaining({
            request_id: 'request-id',
            tenant_id: TENANT_ID,
            user_id: USER_ID,
            document: expect.objectContaining({ schema_version: '1.0', title: 'Project plan' }),
            document_options: expect.objectContaining({
                title: 'Project plan',
                locale: 'zh-CN',
                template_id: 'business-standard',
            }),
        }));
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'DOCUMENT_EXPORTED',
                outcome: AuditOutcome.SUCCESS,
                resourceId: DOCUMENT_ID,
                metadata: expect.objectContaining({ format: 'docx', byteLength: 10 }),
            }),
        });
        expect(result).toEqual({ filename: 'Project plan', bytes: Buffer.from('docx-bytes') });
    });

    it('falls back to the DocumentSpec title when the stored title sanitizes to empty', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(documentRecord({
            // 历史上被误转码成占位符的落库标题，清洗后为空字符串
            title: '??????',
            documentSpec: {
                schema_version: '1.0',
                title: '导出格式自检',
                subtitle: null,
                sections: [{ heading: 'Overview', level: 1, blocks: [{ type: 'paragraph', text: 'content' }] }],
                source_refs: [],
            },
        }));
        const gateway = {
            composeDocument: jest.fn(),
            renderDocumentDocx: jest.fn().mockResolvedValue(Buffer.from('docx-bytes')),
        };
        const service = createService(prisma, createAccessMock(), gateway);

        const result = await service.exportDocumentDocx(DOCUMENT_ID);

        expect(result.filename).toBe('导出格式自检');
        expect(gateway.renderDocumentDocx).toHaveBeenCalledWith(expect.objectContaining({
            document_options: expect.objectContaining({ title: '导出格式自检' }),
        }));
    });

    it('falls back to the neutral filename when neither the title nor the spec title is usable', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(documentRecord({
            title: '???',
            documentSpec: {
                schema_version: '1.0',
                title: '???',
                subtitle: null,
                sections: [],
                source_refs: [],
            },
        }));
        const gateway = {
            composeDocument: jest.fn(),
            renderDocumentDocx: jest.fn().mockResolvedValue(Buffer.from('docx-bytes')),
        };
        const service = createService(prisma, createAccessMock(), gateway);

        const result = await service.exportDocumentDocx(DOCUMENT_ID);

        expect(result.filename).toBe('document');
    });

    it('sanitizes filesystem-illegal characters out of the export filename', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(documentRecord({
            title: '周报/计划:2026?',
            documentSpec: {
                schema_version: '1.0',
                title: '周报',
                subtitle: null,
                sections: [],
                source_refs: [],
            },
        }));
        const gateway = {
            composeDocument: jest.fn(),
            renderDocumentDocx: jest.fn().mockResolvedValue(Buffer.from('docx-bytes')),
        };
        const service = createService(prisma, createAccessMock(), gateway);

        const result = await service.exportDocumentDocx(DOCUMENT_ID);

        expect(result.filename).toBe('周报 计划 2026');
    });

    it('names the stored-file download after the resolved document title', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(documentRecord({
            title: '??????',
            documentSpec: {
                schema_version: '1.0',
                title: '导出格式自检',
                subtitle: null,
                sections: [],
                source_refs: [],
            },
            fileObject: { id: 'f1', mimeType: 'application/pdf', objectKey: 'cees/local/x.pdf' },
        }));
        const service = createService(prisma, createAccessMock());

        const result = await service.getDocumentFileDownload(DOCUMENT_ID);

        // 扩展名由控制器按 MIME 追加，服务只回标题；否则会出现「名称.pdf.pdf」。
        expect(result.filename).toBe('导出格式自检');
        expect(result.mimeType).toBe('application/pdf');
        expect(result.bytes).toEqual(Buffer.from('image-bytes'));
    });

    it('uses the modern editorial template for PDF exports by default', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(documentRecord({
            documentSpec: {
                schema_version: '1.0', title: '模板测试', subtitle: null,
                sections: [{ heading: '概览', level: 1, blocks: [{ type: 'paragraph', text: '内容' }] }],
                source_refs: [],
            },
        }));
        const gateway = {
            composeDocument: jest.fn(),
            renderDocumentPdf: jest.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
        };
        const service = createService(prisma, createAccessMock(), gateway);

        await service.exportDocumentPdf(DOCUMENT_ID);

        expect(gateway.renderDocumentPdf).toHaveBeenCalledWith(expect.objectContaining({
            document_options: expect.objectContaining({ template_id: 'editorial-modern' }),
        }));
    });

    it('passes the selected executive template to PPTX rendering', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(documentRecord({
            documentSpec: {
                schema_version: '1.0', title: '模板测试', subtitle: null,
                sections: [{ heading: '概览', level: 1, blocks: [{ type: 'paragraph', text: '内容' }] }],
                source_refs: [],
            },
        }));
        const gateway = {
            composeDocument: jest.fn(),
            renderDocumentPptx: jest.fn().mockResolvedValue(Buffer.from('pptx-bytes')),
        };
        const service = createService(prisma, createAccessMock(), gateway);

        await service.exportDocumentPptx(DOCUMENT_ID, 'executive-dark');

        expect(gateway.renderDocumentPptx).toHaveBeenCalledWith(expect.objectContaining({
            options: expect.objectContaining({ template_id: 'executive-dark' }),
        }));
    });

    it('drops slides whose blocks all map to nothing and normalizes a blank subtitle', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(documentRecord({
            documentSpec: {
                schema_version: '1.0', title: '边界用例', subtitle: '   ',
                sections: [
                    { heading: '仅分页', level: 1, blocks: [{ type: 'page_break' }] },
                    { heading: '正文', level: 1, blocks: [{ type: 'paragraph', text: '内容' }] },
                ],
                source_refs: [],
            },
        }));
        const gateway = {
            composeDocument: jest.fn(),
            renderDocumentPptx: jest.fn().mockResolvedValue(Buffer.from('pptx-bytes')),
        };
        const service = createService(prisma, createAccessMock(), gateway);

        await service.exportDocumentPptx(DOCUMENT_ID);

        const request = gateway.renderDocumentPptx.mock.calls[0][0] as {
            pptx: { subtitle: string | null; slides: Array<{ title: string; blocks: unknown[] }> };
        };
        expect(request.pptx.subtitle).toBeNull();
        expect(request.pptx.slides).toHaveLength(1);
        expect(request.pptx.slides[0].title).toBe('正文');
    });

    it('rejects export when the document has no stored spec', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(documentRecord({ documentSpec: null }));
        const service = createService(prisma, createAccessMock());

        await expect(service.exportDocumentDocx(DOCUMENT_ID)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('inserts an image block into the named section and re-renders the same document in place', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue({
            id: DOCUMENT_ID,
            title: '项目周报',
            documentSpec: {
                schema_version: '1.0',
                title: '项目周报',
                subtitle: null,
                sections: [
                    { heading: '本周进展', level: 1, blocks: [{ type: 'paragraph', text: '完成工具循环接入。' }] },
                    { heading: '下周计划', level: 1, blocks: [{ type: 'paragraph', text: '补充集成测试。' }] },
                ],
                source_refs: [],
            },
            fileObject: null,
            generatedByToolCall: { name: 'generate_pdf' },
        });
        prisma.managedDocument.updateMany.mockResolvedValue({ count: 1 });
        const gateway = {
            composeDocument: jest.fn(),
            renderDocumentPdf: jest.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
        };
        const service = createService(prisma, createAccessMock(), gateway);

        const result = await service.insertDocumentImage({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'request-id',
            conversationId: '60000000-0000-0000-0000-000000000001',
            turnId: 'turn-id',
            toolCallId: 'tool-call-id',
            executionOwner: 'api:test',
            executionToken: 'execution-token-1',
            imageObjectKey: 'cees/local/tenants/x/uploads/pic.png',
            sectionTitle: '下周计划',
            caption: '架构图',
        });

        expect(gateway.renderDocumentPdf).toHaveBeenCalledWith(expect.objectContaining({
            request_id: 'request-id',
            tenant_id: TENANT_ID,
            user_id: USER_ID,
        }));
        const updateCall = prisma.managedDocument.updateMany.mock.calls[0][0];
        const insertedSpec = updateCall.data.documentSpec;
        expect(insertedSpec.sections[1].blocks).toContainEqual(expect.objectContaining({ type: 'image', caption: '架构图' }));
        // 正文与既有块完全不变：原段落必须保留。
        expect(insertedSpec.sections[1].blocks[0]).toEqual({ type: 'paragraph', text: '补充集成测试。' });
        expect(updateCall.data.version).toEqual({ increment: 1 });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'DOCUMENT_IMAGE_INSERTED', resourceId: DOCUMENT_ID }),
        });
        expect(result).toEqual({ documentId: DOCUMENT_ID, title: '项目周报', sectionHeading: '下周计划', sectionIndex: 1, format: 'pdf' });
    });

    it('rejects insertion when the target section does not exist', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue({
            id: DOCUMENT_ID,
            title: '项目周报',
            documentSpec: {
                schema_version: '1.0',
                title: '项目周报',
                subtitle: null,
                sections: [{ heading: '本周进展', level: 1, blocks: [{ type: 'paragraph', text: 'content' }] }],
                source_refs: [],
            },
            fileObject: null,
            generatedByToolCall: { name: 'generate_pdf' },
        });
        const gateway = { composeDocument: jest.fn(), renderDocumentPdf: jest.fn() };
        const service = createService(prisma, createAccessMock(), gateway);

        await expect(service.insertDocumentImage({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'request-id',
            conversationId: '60000000-0000-0000-0000-000000000001',
            turnId: 'turn-id',
            toolCallId: 'tool-call-id',
            executionOwner: 'api:test',
            executionToken: 'execution-token-1',
            imageObjectKey: 'cees/local/tenants/x/uploads/pic.png',
            sectionTitle: '不存在的章节',
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(gateway.renderDocumentPdf).not.toHaveBeenCalled();
        expect(prisma.managedDocument.updateMany).not.toHaveBeenCalled();
    });

    it('replays the persisted insertion for the same tool_call_id without re-rendering', async () => {
        const prisma = createPrismaMock();
        prisma.aIActionDraft.findUnique.mockResolvedValue({
            tenantId: TENANT_ID,
            status: DraftStatus.EXECUTED,
            payload: {
                operation: 'insert_document_image',
                documentId: DOCUMENT_ID,
                sectionHeading: '下周计划',
                sectionIndex: 1,
                format: 'pdf',
            },
        });
        prisma.managedDocument.findFirst.mockResolvedValue({ id: DOCUMENT_ID, title: '项目周报' });
        const gateway = { composeDocument: jest.fn(), renderDocumentPdf: jest.fn() };
        const service = createService(prisma, createAccessMock(), gateway);

        const result = await service.insertDocumentImage({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'request-id',
            conversationId: '60000000-0000-0000-0000-000000000001',
            turnId: 'turn-id',
            toolCallId: 'tool-call-id',
            executionOwner: 'api:test',
            executionToken: 'execution-token-1',
            imageObjectKey: 'cees/local/tenants/x/uploads/pic.png',
        });

        expect(gateway.renderDocumentPdf).not.toHaveBeenCalled();
        expect(prisma.managedDocument.updateMany).not.toHaveBeenCalled();
        expect(result).toEqual({ documentId: DOCUMENT_ID, title: '项目周报', sectionHeading: '下周计划', sectionIndex: 1, format: 'pdf' });
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
            format: 'docx',
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
const TOOL_CALL_ID = '80000000-0000-4000-8000-000000000001';
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
    const storage = {
        putObject: jest.fn().mockResolvedValue({ sizeBytes: 10, contentType: 'application/pdf', etag: 'etag' }),
        createDownloadUrl: jest.fn().mockResolvedValue('https://cos.example.com/signed'),
        readObject: jest.fn().mockResolvedValue({ body: Buffer.from('image-bytes'), contentType: 'image/png' }),
        deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    const storageSettings = {
        bucket: 'bucket',
        region: 'region',
        objectPrefix: 'cees/local',
        signedUrlTtlSeconds: 600,
        maxUploadBytes: 104857600,
    };
    const objectKeys = {
        buildGeneratedDocumentKey: jest.fn().mockReturnValue('cees/local/tenants/x/generated-documents/y/docx'),
    };
    return new DocumentService(
        prisma as unknown as PrismaService,
        tenantContext,
        access as unknown as ResourceAccessService,
        gateway as unknown as AiServiceGateway,
        storage as any,
        storageSettings as any,
        objectKeys as any,
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
        fileObject: { create: jest.fn(), deleteMany: jest.fn() },
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
        documentSpec: null,
        spreadsheetSpec: null,
        visibility: DocumentVisibility.PRIVATE,
        createdAt: NOW,
        updatedAt: NOW,
        createdBy: USER_ID,
        updatedBy: USER_ID,
        deletedAt: null,
        version: 1,
        generatedByToolCallId: null,
        fileObjectId: null,
        fileObject: null,
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
