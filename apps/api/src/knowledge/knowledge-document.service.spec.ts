import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AiServiceGateway } from '../ai-orchestration/ai-service-gateway.service';
import { KnowledgeDocumentService } from './knowledge-document.service';
import { KnowledgeIndexingService } from './knowledge-indexing.service';
import { KnowledgeService } from './knowledge.service';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';

describe('KnowledgeDocumentService', () => {
    it('creates a document with version 1 in PENDING and kicks the indexer', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.fileObject.findFirst.mockResolvedValue(fileObjectRecord());
        prisma.knowledgeDocument.create.mockResolvedValue({ id: DOCUMENT_ID });
        prisma.documentVersion.create.mockResolvedValue({ id: VERSION_ID });
        prisma.knowledgeDocument.update.mockResolvedValue(undefined);
        prisma.knowledgeDocument.findFirst.mockResolvedValue(documentRecord({ status: 'PENDING' }));
        prisma.documentVersion.findFirst.mockResolvedValue({
            versionNumber: 1,
            visibilityScope: 'TENANT',
            departmentId: null,
            projectId: null,
        });
        const service = createService(prisma);

        const result = await service.createDocument(KNOWLEDGE_BASE_ID, {
            fileObjectId: FILE_OBJECT_ID,
            name: '  产品手册  ',
            visibilityScope: 'TENANT',
        });

        expect(result).toEqual(expect.objectContaining({
            id: DOCUMENT_ID,
            name: '产品手册',
            status: 'PENDING',
            versionNumber: 1,
            visibilityScope: 'TENANT',
            currentVersionId: VERSION_ID,
        }));
        expect(prisma.knowledgeDocument.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: TENANT_ID,
                knowledgeBaseId: KNOWLEDGE_BASE_ID,
                fileObjectId: FILE_OBJECT_ID,
                name: '产品手册',
            }),
            select: { id: true },
        });
        expect(prisma.documentVersion.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                documentId: DOCUMENT_ID,
                fileObjectId: FILE_OBJECT_ID,
                versionNumber: 1,
                visibilityScope: 'TENANT',
                departmentId: null,
                projectId: null,
            }),
            select: { id: true },
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'KNOWLEDGE_DOCUMENT_CREATED' }),
        });
        expect(kickSpy).toHaveBeenCalled();
    });

    it('requires departmentId for DEPARTMENT visibility', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        const service = createService(prisma);

        await expect(service.createDocument(KNOWLEDGE_BASE_ID, {
            fileObjectId: FILE_OBJECT_ID,
            name: '制度文件',
            visibilityScope: 'DEPARTMENT',
        })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'KNOWLEDGE_DOCUMENT_SCOPE_INVALID' }),
        });
        expect(prisma.fileObject.findFirst).not.toHaveBeenCalled();
    });

    it('rejects a department that does not belong to the tenant', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.department.findFirst.mockResolvedValue(null);
        const service = createService(prisma);

        await expect(service.createDocument(KNOWLEDGE_BASE_ID, {
            fileObjectId: FILE_OBJECT_ID,
            name: '制度文件',
            visibilityScope: 'DEPARTMENT',
            departmentId: DEPARTMENT_ID,
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.knowledgeDocument.create).not.toHaveBeenCalled();
    });

    it('rejects a file object from another tenant or already deleted', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.fileObject.findFirst.mockResolvedValue(null);
        const service = createService(prisma);

        await expect(service.createDocument(KNOWLEDGE_BASE_ID, {
            fileObjectId: FILE_OBJECT_ID,
            name: '产品手册',
            visibilityScope: 'PRIVATE',
        })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'KNOWLEDGE_FILE_OBJECT_NOT_FOUND' }),
        });
        expect(prisma.fileObject.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: FILE_OBJECT_ID, tenantId: TENANT_ID, deletedAt: null }),
        }));
    });

    it('converts duplicate file object constraint into a conflict', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.fileObject.findFirst.mockResolvedValue(fileObjectRecord());
        prisma.knowledgeDocument.create.mockResolvedValue({ id: DOCUMENT_ID });
        prisma.documentVersion.create.mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6.19.3' }),
        );
        const service = createService(prisma);

        await expect(service.createDocument(KNOWLEDGE_BASE_ID, {
            fileObjectId: FILE_OBJECT_ID,
            name: '产品手册',
            visibilityScope: 'PRIVATE',
        })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'KNOWLEDGE_FILE_OBJECT_IN_USE' }),
        });
    });

    it('appends a new version and resets the processing state', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.knowledgeDocument.findFirst
            .mockResolvedValueOnce(documentRecord())
            .mockResolvedValueOnce(documentRecord({
                fileObjectId: NEW_FILE_OBJECT_ID,
                currentVersionId: NEW_VERSION_ID,
            }));
        prisma.fileObject.findFirst.mockResolvedValue(fileObjectRecord({ id: NEW_FILE_OBJECT_ID }));
        prisma.documentVersion.findFirst
            .mockResolvedValueOnce({ versionNumber: 1 })
            .mockResolvedValueOnce({ versionNumber: 2, visibilityScope: 'PROJECT', departmentId: null, projectId: PROJECT_ID });
        prisma.documentVersion.create.mockResolvedValue({ id: NEW_VERSION_ID });
        prisma.knowledgeDocument.update.mockResolvedValue(undefined);
        prisma.project.findFirst.mockResolvedValue({ id: PROJECT_ID });
        deleteVersionIndexSpy.mockResolvedValue({
            request_id: 'request-id',
            deleted_chunks: 5,
            document_version_id: VERSION_ID,
            index_version: 'knowledge-index-v1',
        });
        const service = createService(prisma);

        const result = await service.createDocumentVersion(KNOWLEDGE_BASE_ID, DOCUMENT_ID, {
            fileObjectId: NEW_FILE_OBJECT_ID,
            visibilityScope: 'PROJECT',
            projectId: PROJECT_ID,
        });

        expect(result).toEqual(expect.objectContaining({ status: 'READY', versionNumber: 2 }));
        expect(prisma.documentVersion.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                documentId: DOCUMENT_ID,
                fileObjectId: NEW_FILE_OBJECT_ID,
                versionNumber: 2,
                visibilityScope: 'PROJECT',
                projectId: PROJECT_ID,
            }),
            select: { id: true },
        });
        expect(prisma.knowledgeDocument.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                fileObjectId: NEW_FILE_OBJECT_ID,
                currentVersionId: NEW_VERSION_ID,
                status: 'PENDING',
                retryCount: 0,
                lastError: null,
            }),
        }));
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'KNOWLEDGE_DOCUMENT_VERSION_CREATED' }),
        });
        expect(kickSpy).toHaveBeenCalled();
        expect(deleteVersionIndexSpy).toHaveBeenCalledWith(TENANT_ID, USER_ID, VERSION_ID);
    });

    it('keeps the new version when the replaced index cleanup fails', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.knowledgeDocument.findFirst
            .mockResolvedValueOnce(documentRecord())
            .mockResolvedValueOnce(documentRecord({
                fileObjectId: NEW_FILE_OBJECT_ID,
                currentVersionId: NEW_VERSION_ID,
            }));
        prisma.fileObject.findFirst.mockResolvedValue(fileObjectRecord({ id: NEW_FILE_OBJECT_ID }));
        prisma.documentVersion.findFirst
            .mockResolvedValueOnce({ versionNumber: 1 })
            .mockResolvedValueOnce({ versionNumber: 2, visibilityScope: 'TENANT', departmentId: null, projectId: null });
        prisma.documentVersion.create.mockResolvedValue({ id: NEW_VERSION_ID });
        prisma.knowledgeDocument.update.mockResolvedValue(undefined);
        deleteVersionIndexSpy.mockReset();
        deleteVersionIndexSpy.mockRejectedValue(new Error('ai-service down'));
        const service = createService(prisma);

        const result = await service.createDocumentVersion(KNOWLEDGE_BASE_ID, DOCUMENT_ID, {
            fileObjectId: NEW_FILE_OBJECT_ID,
            visibilityScope: 'TENANT',
        });

        expect(result).toEqual(expect.objectContaining({ status: 'READY', versionNumber: 2 }));
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'KNOWLEDGE_DOCUMENT_VERSION_CREATED' }),
        });
        await new Promise((resolve) => setImmediate(resolve));
        expect(deleteVersionIndexSpy).toHaveBeenCalledWith(TENANT_ID, USER_ID, VERSION_ID);
    });

    it('lists documents only within the knowledge base', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'READER' });
        prisma.knowledgeDocument.findMany.mockResolvedValue([documentRecord()]);
        prisma.documentVersion.findFirst.mockResolvedValue({
            versionNumber: 1,
            visibilityScope: 'TENANT',
            departmentId: null,
            projectId: null,
        });
        const service = createService(prisma);

        const result = await service.listDocuments(KNOWLEDGE_BASE_ID, { limit: 20 });

        expect(result.items).toHaveLength(1);
        expect(prisma.knowledgeDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tenantId: TENANT_ID, knowledgeBaseId: KNOWLEDGE_BASE_ID }),
            take: 21,
        }));
    });

    it('rejects listing when the member has no access to the knowledge base', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(null);
        const service = createService(prisma);

        await expect(service.listDocuments(KNOWLEDGE_BASE_ID, { limit: 20 }))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'KNOWLEDGE_BASE_NOT_FOUND' }) });
    });

    it('retries only failed documents and resets counters', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.knowledgeDocument.findFirst
            .mockResolvedValueOnce(documentRecord({ status: 'FAILED', retryCount: 3, lastError: '解析失败' }))
            .mockResolvedValueOnce(documentRecord({ status: 'PENDING', retryCount: 0 }));
        prisma.knowledgeDocument.updateMany.mockResolvedValue({ count: 1 });
        prisma.documentVersion.findFirst.mockResolvedValue({
            versionNumber: 1,
            visibilityScope: 'PRIVATE',
            departmentId: null,
            projectId: null,
        });
        const service = createService(prisma);

        const result = await service.retryDocument(KNOWLEDGE_BASE_ID, DOCUMENT_ID);

        expect(result.status).toBe('PENDING');
        expect(prisma.knowledgeDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: DOCUMENT_ID, status: 'FAILED' }),
            data: expect.objectContaining({ status: 'PENDING', retryCount: 0, lastError: null }),
        }));
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'KNOWLEDGE_DOCUMENT_RETRY_REQUESTED' }),
        });
        expect(kickSpy).toHaveBeenCalled();
    });

    it('rejects retry when the document is not failed', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.knowledgeDocument.findFirst.mockResolvedValue(documentRecord({ status: 'READY' }));
        const service = createService(prisma);

        await expect(service.retryDocument(KNOWLEDGE_BASE_ID, DOCUMENT_ID))
            .rejects.toMatchObject({
                response: expect.objectContaining({ code: 'KNOWLEDGE_DOCUMENT_RETRY_INVALID' }),
            });
        expect(prisma.knowledgeDocument.updateMany).not.toHaveBeenCalled();
    });

    it('hides a document that does not belong to the knowledge base', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.knowledgeDocument.findFirst.mockResolvedValue(null);
        const service = createService(prisma);

        await expect(service.retryDocument(KNOWLEDGE_BASE_ID, DOCUMENT_ID))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'KNOWLEDGE_DOCUMENT_NOT_FOUND' }) });
    });

    it('does not list a document from another knowledge base via cursor', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'READER' });
        prisma.knowledgeDocument.findFirst.mockResolvedValue(null);
        const service = createService(prisma);

        await expect(service.listDocuments(KNOWLEDGE_BASE_ID, {
            limit: 20,
            cursor: '90000000-0000-0000-0000-000000000001',
        })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ignores department and project fields for TENANT visibility', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.fileObject.findFirst.mockResolvedValue(fileObjectRecord());
        prisma.knowledgeDocument.create.mockResolvedValue({ id: DOCUMENT_ID });
        prisma.documentVersion.create.mockResolvedValue({ id: VERSION_ID });
        prisma.knowledgeDocument.update.mockResolvedValue(undefined);
        prisma.knowledgeDocument.findFirst.mockResolvedValue(documentRecord());
        prisma.documentVersion.findFirst.mockResolvedValue({
            versionNumber: 1,
            visibilityScope: 'TENANT',
            departmentId: null,
            projectId: null,
        });
        const service = createService(prisma);

        await service.createDocument(KNOWLEDGE_BASE_ID, {
            fileObjectId: FILE_OBJECT_ID,
            name: '公开文档',
            visibilityScope: 'TENANT',
            departmentId: DEPARTMENT_ID,
            projectId: PROJECT_ID,
        });

        expect(prisma.department.findFirst).not.toHaveBeenCalled();
        expect(prisma.project.findFirst).not.toHaveBeenCalled();
        expect(prisma.documentVersion.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                visibilityScope: 'TENANT',
                departmentId: null,
                projectId: null,
            }),
            select: { id: true },
        });
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '20000000-0000-0000-0000-000000000001';
const KNOWLEDGE_BASE_ID = '30000000-0000-0000-0000-000000000001';
const DOCUMENT_ID = '40000000-0000-0000-0000-000000000001';
const VERSION_ID = '50000000-0000-0000-0000-000000000001';
const NEW_VERSION_ID = '50000000-0000-0000-0000-000000000002';
const FILE_OBJECT_ID = '60000000-0000-0000-0000-000000000001';
const NEW_FILE_OBJECT_ID = '60000000-0000-0000-0000-000000000002';
const DEPARTMENT_ID = '70000000-0000-0000-0000-000000000001';
const PROJECT_ID = '80000000-0000-0000-0000-000000000001';

const kickSpy = jest.fn();
const deleteVersionIndexSpy = jest.fn();

function createService(prisma: Record<string, any>): KnowledgeDocumentService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'request-id',
            roles: ['tenant_admin'],
            permissions: ['knowledge_base.document.manage'],
        }),
    } as unknown as TenantContext;
    const knowledgeService = new KnowledgeService(
        prisma as unknown as PrismaService,
        tenantContext,
        { answerKnowledge: jest.fn() } as unknown as AiServiceGateway,
        { deleteKnowledgeBaseIndexes: jest.fn() } as unknown as KnowledgeIndexingService,
    );
    const indexingService = {
        kick: kickSpy,
        deleteDocumentVersionIndex: deleteVersionIndexSpy,
    } as unknown as KnowledgeIndexingService;
    return new KnowledgeDocumentService(
        prisma as unknown as PrismaService,
        tenantContext,
        knowledgeService,
        indexingService,
    );
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        knowledgeBase: { findFirst: jest.fn(), findMany: jest.fn() },
        knowledgeBaseMember: { findUnique: jest.fn(), findMany: jest.fn() },
        knowledgeDocument: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
        },
        documentVersion: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
        },
        fileObject: { findFirst: jest.fn() },
        department: { findFirst: jest.fn() },
        project: { findFirst: jest.fn() },
        auditLog: { create: jest.fn() },
    };
    prisma.$transaction = jest.fn(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function knowledgeBaseRecord(): Record<string, unknown> {
    return {
        id: KNOWLEDGE_BASE_ID,
        tenantId: TENANT_ID,
        name: '产品知识库',
        description: null,
        createdBy: USER_ID,
        updatedBy: USER_ID,
        version: 1,
        createdAt: new Date('2026-09-15T00:00:00.000Z'),
        updatedAt: new Date('2026-09-15T00:00:00.000Z'),
    };
}

function fileObjectRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: FILE_OBJECT_ID,
        tenantId: TENANT_ID,
        originalName: 'manual.pdf',
        mimeType: 'application/pdf',
        sizeBytes: BigInt(1024),
        objectKey: 'uploads/tenant/file',
        deletedAt: null,
        ...overrides,
    };
}

function documentRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: DOCUMENT_ID,
        tenantId: TENANT_ID,
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        fileObjectId: FILE_OBJECT_ID,
        name: '产品手册',
        status: 'READY',
        currentVersionId: VERSION_ID,
        retryCount: 0,
        lastError: null,
        createdBy: USER_ID,
        updatedBy: USER_ID,
        version: 1,
        createdAt: new Date('2026-09-15T00:00:00.000Z'),
        updatedAt: new Date('2026-09-15T00:00:00.000Z'),
        ...overrides,
    };
}
