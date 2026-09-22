import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AiServiceGateway } from '../ai-orchestration/ai-service-gateway.service';
import { FileService } from '../file/file.service';
import { KnowledgeDocumentService, KnowledgeSourceSaveActor } from './knowledge-document.service';
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

    it('soft-deletes a document and cleans all version indexes', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.knowledgeDocument.findFirst.mockResolvedValue(documentRecord({ status: 'READY' }));
        prisma.documentVersion.findMany.mockResolvedValue([{ id: VERSION_ID }, { id: NEW_VERSION_ID }]);
        prisma.knowledgeDocument.updateMany.mockResolvedValue({ count: 1 });
        deleteVersionIndexSpy.mockClear();
        deleteVersionIndexSpy.mockResolvedValue(undefined);
        const service = createService(prisma);

        await service.deleteDocument(KNOWLEDGE_BASE_ID, DOCUMENT_ID);

        expect(prisma.knowledgeDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                id: DOCUMENT_ID,
                tenantId: TENANT_ID,
                knowledgeBaseId: KNOWLEDGE_BASE_ID,
                deletedAt: null,
            }),
            data: expect.objectContaining({
                deletedAt: expect.any(Date),
                updatedBy: USER_ID,
            }),
        }));
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'KNOWLEDGE_DOCUMENT_DELETED',
                metadata: expect.objectContaining({ name: '产品手册', versionCount: 2 }),
            }),
        });
        expect(deleteVersionIndexSpy).toHaveBeenCalledWith(TENANT_ID, USER_ID, VERSION_ID);
        expect(deleteVersionIndexSpy).toHaveBeenCalledWith(TENANT_ID, USER_ID, NEW_VERSION_ID);
    });

    it('rejects document deletion when the member permission is below EDITOR', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'READER' });
        const service = createService(prisma);

        await expect(service.deleteDocument(KNOWLEDGE_BASE_ID, DOCUMENT_ID))
            .rejects.toMatchObject({
                response: expect.objectContaining({ code: 'KNOWLEDGE_BASE_MEMBER_PERMISSION_DENIED' }),
            });
        expect(prisma.knowledgeDocument.updateMany).not.toHaveBeenCalled();
    });

    it('rejects deletion of a document that does not exist', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.knowledgeDocument.findFirst.mockResolvedValue(null);
        deleteVersionIndexSpy.mockClear();
        const service = createService(prisma);

        await expect(service.deleteDocument(KNOWLEDGE_BASE_ID, DOCUMENT_ID))
            .rejects.toMatchObject({
                response: expect.objectContaining({ code: 'KNOWLEDGE_DOCUMENT_NOT_FOUND' }),
            });
        expect(deleteVersionIndexSpy).not.toHaveBeenCalled();
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
const OTHER_KNOWLEDGE_BASE_ID = '30000000-0000-0000-0000-000000000002';
const OTHER_MEMBERSHIP_ID = '20000000-0000-0000-0000-000000000002';
const CONVERSATION_ID = '90000000-0000-0000-0000-000000000001';
const MESSAGE_ID = '90000000-0000-0000-0000-000000000002';
const OTHER_CONVERSATION_ID = '90000000-0000-0000-0000-000000000003';

const kickSpy = jest.fn();
const deleteVersionIndexSpy = jest.fn();
const createMaterializedFileSpy = jest.fn();
const deleteMaterializedFileSpy = jest.fn().mockResolvedValue(undefined);

describe('KnowledgeDocumentService.saveFromSource', () => {
    const actor: KnowledgeSourceSaveActor = {
        tenantId: TENANT_ID,
        userId: USER_ID,
        membershipId: MEMBERSHIP_ID,
        permissions: ['knowledge_base.read'],
        requestId: 'request-id',
    };

    it('materializes a conversation message snapshot and creates the anchored document', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.knowledgeDocument.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(documentRecord({ status: 'PENDING' }));
        prisma.conversationMessage.findFirst.mockResolvedValue(messageRecord());
        createMaterializedFileSpy.mockResolvedValue(NEW_FILE_OBJECT_ID);
        prisma.knowledgeDocument.create.mockResolvedValue({ id: DOCUMENT_ID });
        prisma.documentVersion.create.mockResolvedValue({ id: VERSION_ID });
        prisma.knowledgeDocument.update.mockResolvedValue(undefined);
        prisma.documentVersion.findFirst.mockResolvedValue({
            versionNumber: 1,
            visibilityScope: 'TENANT',
            departmentId: null,
            projectId: null,
        });
        const service = createService(prisma);

        const result = await service.saveFromSource(actor, {
            knowledgeBaseId: KNOWLEDGE_BASE_ID,
            sourceType: 'MESSAGE',
            sourceId: MESSAGE_ID,
            visibilityScope: 'TENANT',
        });

        expect(createMaterializedFileSpy).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: TENANT_ID,
            mimeType: 'text/markdown',
        }));
        expect(prisma.knowledgeDocument.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: TENANT_ID,
                knowledgeBaseId: KNOWLEDGE_BASE_ID,
                fileObjectId: NEW_FILE_OBJECT_ID,
                sourceType: 'MESSAGE',
                sourceId: MESSAGE_ID,
            }),
            select: { id: true },
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'KNOWLEDGE_DOCUMENT_CREATED',
                metadata: expect.objectContaining({ sourceType: 'MESSAGE', sourceId: MESSAGE_ID }),
            }),
        });
        expect(kickSpy).toHaveBeenCalled();
        expect(result).toEqual(expect.objectContaining({ id: DOCUMENT_ID, status: 'PENDING', versionNumber: 1 }));
    });

    it('rejects saving when the member permission is below EDITOR', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'READER' });
        const service = createService(prisma);

        await expect(service.saveFromSource(actor, {
            knowledgeBaseId: KNOWLEDGE_BASE_ID,
            sourceType: 'MESSAGE',
            sourceId: MESSAGE_ID,
            visibilityScope: 'PRIVATE',
        })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'KNOWLEDGE_BASE_MEMBER_PERMISSION_DENIED' }),
        });
        expect(prisma.conversationMessage.findFirst).not.toHaveBeenCalled();
    });

    it('rejects a message that does not exist or belongs to another member', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.knowledgeDocument.findFirst.mockResolvedValue(null);
        prisma.conversationMessage.findFirst.mockResolvedValue(null);
        const service = createService(prisma);

        await expect(service.saveFromSource(actor, {
            knowledgeBaseId: KNOWLEDGE_BASE_ID,
            sourceType: 'MESSAGE',
            sourceId: MESSAGE_ID,
            visibilityScope: 'PRIVATE',
        })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'KNOWLEDGE_SOURCE_MESSAGE_NOT_FOUND' }),
        });
    });

    it('rejects a message from another conversation when saving through the tool', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.knowledgeDocument.findFirst.mockResolvedValue(null);
        prisma.conversationMessage.findFirst.mockResolvedValue(messageRecord({
            conversationId: OTHER_CONVERSATION_ID,
        }));
        const service = createService(prisma);

        await expect(service.saveFromSource({ ...actor, conversationId: CONVERSATION_ID }, {
            knowledgeBaseId: KNOWLEDGE_BASE_ID,
            sourceType: 'MESSAGE',
            sourceId: MESSAGE_ID,
            visibilityScope: 'PRIVATE',
        })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'KNOWLEDGE_SOURCE_MESSAGE_NOT_FOUND' }),
        });
    });

    it('rejects saving a TOOL role message', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.knowledgeDocument.findFirst.mockResolvedValue(null);
        prisma.conversationMessage.findFirst.mockResolvedValue(messageRecord({ role: 'TOOL' }));
        const service = createService(prisma);

        await expect(service.saveFromSource(actor, {
            knowledgeBaseId: KNOWLEDGE_BASE_ID,
            sourceType: 'MESSAGE',
            sourceId: MESSAGE_ID,
            visibilityScope: 'PRIVATE',
        })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'KNOWLEDGE_SOURCE_MESSAGE_INVALID' }),
        });
    });

    it('rejects a generated document the user cannot read', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.knowledgeDocument.findFirst.mockResolvedValue(null);
        prisma.managedDocument.findFirst.mockResolvedValue(managedDocumentRecord());
        createMaterializedFileSpy.mockClear();
        const service = createService(prisma);

        await expect(service.saveFromSource(actor, {
            knowledgeBaseId: KNOWLEDGE_BASE_ID,
            sourceType: 'DOCUMENT',
            sourceId: DOCUMENT_ID,
            visibilityScope: 'PRIVATE',
        })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'KNOWLEDGE_SOURCE_DOCUMENT_NOT_FOUND' }),
        });
        expect(createMaterializedFileSpy).not.toHaveBeenCalled();
    });

    it('materializes a readable generated document and names it after the title', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.knowledgeDocument.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(documentRecord({ status: 'PENDING' }));
        prisma.managedDocument.findFirst.mockResolvedValue(managedDocumentRecord());
        prisma.membershipRole.findMany.mockResolvedValue([]);
        createMaterializedFileSpy.mockResolvedValue(NEW_FILE_OBJECT_ID);
        prisma.knowledgeDocument.create.mockResolvedValue({ id: DOCUMENT_ID });
        prisma.documentVersion.create.mockResolvedValue({ id: VERSION_ID });
        prisma.knowledgeDocument.update.mockResolvedValue(undefined);
        prisma.documentVersion.findFirst.mockResolvedValue({
            versionNumber: 1,
            visibilityScope: 'PRIVATE',
            departmentId: null,
            projectId: null,
        });
        const service = createService(prisma);
        const readableActor = { ...actor, permissions: ['knowledge_base.read', 'document.read'] };

        const result = await service.saveFromSource(readableActor, {
            knowledgeBaseId: KNOWLEDGE_BASE_ID,
            sourceType: 'DOCUMENT',
            sourceId: DOCUMENT_ID,
            visibilityScope: 'PRIVATE',
        });

        expect(createMaterializedFileSpy).toHaveBeenCalledWith(expect.objectContaining({ name: '项目周报.md' }));
        expect(prisma.knowledgeDocument.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ sourceType: 'DOCUMENT', sourceId: DOCUMENT_ID, name: '项目周报' }),
            select: { id: true },
        });
        expect(result).toEqual(expect.objectContaining({ id: DOCUMENT_ID, versionNumber: 1 }));
    });

    it('appends a new version when the same source is saved to the same knowledge base again', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.knowledgeDocument.findFirst
            .mockResolvedValueOnce({ id: DOCUMENT_ID, knowledgeBaseId: KNOWLEDGE_BASE_ID, currentVersionId: VERSION_ID })
            .mockResolvedValueOnce(documentRecord({
                status: 'PENDING',
                fileObjectId: NEW_FILE_OBJECT_ID,
                currentVersionId: NEW_VERSION_ID,
            }));
        prisma.conversationMessage.findFirst.mockResolvedValue(messageRecord());
        createMaterializedFileSpy.mockResolvedValue(NEW_FILE_OBJECT_ID);
        prisma.documentVersion.findFirst
            .mockResolvedValueOnce({ versionNumber: 1 })
            .mockResolvedValueOnce({
                versionNumber: 2,
                visibilityScope: 'TENANT',
                departmentId: null,
                projectId: null,
            });
        prisma.documentVersion.create.mockResolvedValue({ id: NEW_VERSION_ID });
        prisma.knowledgeDocument.update.mockResolvedValue(undefined);
        deleteVersionIndexSpy.mockResolvedValue({
            request_id: 'request-id',
            deleted_chunks: 3,
            document_version_id: VERSION_ID,
            index_version: 'knowledge-index-v1',
        });
        const service = createService(prisma);

        const result = await service.saveFromSource(actor, {
            knowledgeBaseId: KNOWLEDGE_BASE_ID,
            sourceType: 'MESSAGE',
            sourceId: MESSAGE_ID,
            visibilityScope: 'TENANT',
        });

        expect(prisma.knowledgeDocument.create).not.toHaveBeenCalled();
        expect(prisma.documentVersion.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                documentId: DOCUMENT_ID,
                fileObjectId: NEW_FILE_OBJECT_ID,
                versionNumber: 2,
            }),
            select: { id: true },
        });
        expect(prisma.knowledgeDocument.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: 'PENDING', fileObjectId: NEW_FILE_OBJECT_ID }),
        }));
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'KNOWLEDGE_DOCUMENT_VERSION_CREATED',
                metadata: expect.objectContaining({ sourceType: 'MESSAGE', sourceId: MESSAGE_ID }),
            }),
        });
        expect(deleteVersionIndexSpy).toHaveBeenCalledWith(TENANT_ID, USER_ID, VERSION_ID);
        expect(kickSpy).toHaveBeenCalled();
        expect(result).toEqual(expect.objectContaining({ id: DOCUMENT_ID, status: 'PENDING', versionNumber: 2 }));
    });

    it('restores a soft-deleted anchored document and appends a new version', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.knowledgeDocument.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: DOCUMENT_ID, knowledgeBaseId: KNOWLEDGE_BASE_ID, currentVersionId: VERSION_ID })
            .mockResolvedValueOnce(documentRecord({
                status: 'PENDING',
                fileObjectId: NEW_FILE_OBJECT_ID,
                currentVersionId: NEW_VERSION_ID,
            }));
        prisma.knowledgeDocument.updateMany.mockResolvedValue({ count: 1 });
        prisma.documentVersion.findMany.mockResolvedValue([{ id: VERSION_ID }]);
        prisma.conversationMessage.findFirst.mockResolvedValue(messageRecord());
        createMaterializedFileSpy.mockResolvedValue(NEW_FILE_OBJECT_ID);
        prisma.documentVersion.findFirst
            .mockResolvedValueOnce({ versionNumber: 1 })
            .mockResolvedValueOnce({
                versionNumber: 2,
                visibilityScope: 'TENANT',
                departmentId: null,
                projectId: null,
            });
        prisma.documentVersion.create.mockResolvedValue({ id: NEW_VERSION_ID });
        prisma.knowledgeDocument.update.mockResolvedValue(undefined);
        deleteVersionIndexSpy.mockResolvedValue({
            request_id: 'request-id',
            deleted_chunks: 0,
            document_version_id: VERSION_ID,
            index_version: 'knowledge-index-v1',
        });
        const service = createService(prisma);

        const result = await service.saveFromSource(actor, {
            knowledgeBaseId: KNOWLEDGE_BASE_ID,
            sourceType: 'MESSAGE',
            sourceId: MESSAGE_ID,
            visibilityScope: 'TENANT',
        });

        expect(prisma.knowledgeDocument.updateMany).toHaveBeenCalledWith({
            where: { id: DOCUMENT_ID, tenantId: TENANT_ID, deletedAt: { not: null } },
            data: { deletedAt: null, updatedBy: USER_ID, version: { increment: 1 } },
        });
        expect(prisma.knowledgeDocument.create).not.toHaveBeenCalled();
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'KNOWLEDGE_DOCUMENT_RESTORED' }),
        });
        expect(prisma.documentVersion.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ documentId: DOCUMENT_ID, versionNumber: 2 }),
            select: { id: true },
        });
        // 恢复后幂等清理全部既有版本索引（处理中删除的索引任务在恢复后可能写入旧版本向量），
        // appendSourceVersion 追加新版本后也会清理上一版本，因此至少调用两次。
        expect(deleteVersionIndexSpy).toHaveBeenCalledWith(TENANT_ID, USER_ID, VERSION_ID);
        expect(result).toEqual(expect.objectContaining({ id: DOCUMENT_ID, versionNumber: 2 }));
    });

    it('rejects saving the same source to another knowledge base', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.knowledgeDocument.findFirst.mockResolvedValue({
            id: DOCUMENT_ID,
            knowledgeBaseId: OTHER_KNOWLEDGE_BASE_ID,
            currentVersionId: VERSION_ID,
        });
        const service = createService(prisma);

        await expect(service.saveFromSource(actor, {
            knowledgeBaseId: KNOWLEDGE_BASE_ID,
            sourceType: 'MESSAGE',
            sourceId: MESSAGE_ID,
            visibilityScope: 'PRIVATE',
        })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'KNOWLEDGE_SOURCE_ALREADY_SAVED' }),
        });
        expect(prisma.conversationMessage.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to appending a version on a concurrent anchor conflict', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.knowledgeDocument.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: DOCUMENT_ID, knowledgeBaseId: KNOWLEDGE_BASE_ID, currentVersionId: VERSION_ID })
            .mockResolvedValueOnce(documentRecord({
                status: 'PENDING',
                fileObjectId: NEW_FILE_OBJECT_ID,
                currentVersionId: NEW_VERSION_ID,
            }));
        prisma.knowledgeDocument.create.mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('duplicate', {
                code: 'P2002',
                clientVersion: '6.19.3',
                meta: { target: ['tenant_id', 'source_type', 'source_id'] },
            }),
        );
        prisma.conversationMessage.findFirst.mockResolvedValue(messageRecord());
        createMaterializedFileSpy.mockResolvedValue(NEW_FILE_OBJECT_ID);
        deleteMaterializedFileSpy.mockClear();
        prisma.documentVersion.findFirst
            .mockResolvedValueOnce({ versionNumber: 1 })
            .mockResolvedValueOnce({
                versionNumber: 2,
                visibilityScope: 'TENANT',
                departmentId: null,
                projectId: null,
            });
        prisma.documentVersion.create.mockResolvedValue({ id: NEW_VERSION_ID });
        prisma.knowledgeDocument.update.mockResolvedValue(undefined);
        const service = createService(prisma);

        const result = await service.saveFromSource(actor, {
            knowledgeBaseId: KNOWLEDGE_BASE_ID,
            sourceType: 'MESSAGE',
            sourceId: MESSAGE_ID,
            visibilityScope: 'TENANT',
        });

        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'KNOWLEDGE_DOCUMENT_VERSION_CREATED' }),
        });
        // 冲突回退到追加版本：本次物化的快照未被引用，应补偿删除避免孤儿文件。
        expect(deleteMaterializedFileSpy).toHaveBeenCalledWith({
            tenantId: TENANT_ID,
            fileObjectId: NEW_FILE_OBJECT_ID,
        });
        expect(result).toEqual(expect.objectContaining({ id: DOCUMENT_ID, versionNumber: 2 }));
    });

    it('rejects createDocument input with both fileObjectId and source fields', async () => {
        const prisma = createPrismaMock();
        const service = createService(prisma);

        await expect(service.createDocument(KNOWLEDGE_BASE_ID, {
            fileObjectId: FILE_OBJECT_ID,
            sourceType: 'MESSAGE',
            sourceId: MESSAGE_ID,
            visibilityScope: 'PRIVATE',
        })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'KNOWLEDGE_DOCUMENT_SOURCE_AMBIGUOUS' }),
        });
        expect(prisma.knowledgeBase.findFirst).not.toHaveBeenCalled();
    });

    it('creates an unanchored document from direct assistant content and kicks the indexer', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'EDITOR' });
        prisma.knowledgeDocument.findFirst.mockResolvedValue(documentRecord({ status: 'PENDING' }));
        createMaterializedFileSpy.mockResolvedValue(NEW_FILE_OBJECT_ID);
        prisma.knowledgeDocument.create.mockResolvedValue({ id: DOCUMENT_ID });
        prisma.documentVersion.create.mockResolvedValue({ id: VERSION_ID });
        prisma.knowledgeDocument.update.mockResolvedValue(undefined);
        prisma.documentVersion.findFirst.mockResolvedValue({
            versionNumber: 1,
            visibilityScope: 'PRIVATE',
            departmentId: null,
            projectId: null,
        });
        const service = createService(prisma);
        const actor: KnowledgeSourceSaveActor = {
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            permissions: ['knowledge_base.read'],
            requestId: 'request-id',
        };

        const result = await service.saveDirectContent(actor, {
            knowledgeBaseId: KNOWLEDGE_BASE_ID,
            content: '林波是图巴隆公司的超级管理员。',
            visibilityScope: 'PRIVATE',
        });

        expect(createMaterializedFileSpy).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: TENANT_ID,
            mimeType: 'text/markdown',
            content: expect.any(Buffer),
        }));
        expect(prisma.knowledgeDocument.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: TENANT_ID,
                knowledgeBaseId: KNOWLEDGE_BASE_ID,
                fileObjectId: NEW_FILE_OBJECT_ID,
            }),
            select: { id: true },
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'KNOWLEDGE_DOCUMENT_CREATED',
                metadata: expect.objectContaining({ directContent: true }),
            }),
        });
        expect(kickSpy).toHaveBeenCalled();
        expect(result).toEqual(expect.objectContaining({ id: DOCUMENT_ID, status: 'PENDING', versionNumber: 1 }));
    });

    it('rejects direct content saving when the member permission is below EDITOR', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'READER' });
        createMaterializedFileSpy.mockClear();
        const service = createService(prisma);
        const actor: KnowledgeSourceSaveActor = {
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            permissions: ['knowledge_base.read'],
            requestId: 'request-id',
        };

        await expect(service.saveDirectContent(actor, {
            knowledgeBaseId: KNOWLEDGE_BASE_ID,
            content: '林波是图巴隆公司的超级管理员。',
            visibilityScope: 'PRIVATE',
        })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'KNOWLEDGE_BASE_MEMBER_PERMISSION_DENIED' }),
        });
        expect(createMaterializedFileSpy).not.toHaveBeenCalled();
    });

    it('rejects createDocument input with only one source field', async () => {
        const prisma = createPrismaMock();
        const service = createService(prisma);

        await expect(service.createDocument(KNOWLEDGE_BASE_ID, {
            sourceType: 'MESSAGE',
            visibilityScope: 'PRIVATE',
        })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'KNOWLEDGE_DOCUMENT_SOURCE_INCOMPLETE' }),
        });
    });

    it('rejects createDocument input without any source', async () => {
        const prisma = createPrismaMock();
        const service = createService(prisma);

        await expect(service.createDocument(KNOWLEDGE_BASE_ID, {
            visibilityScope: 'PRIVATE',
        })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'KNOWLEDGE_DOCUMENT_SOURCE_REQUIRED' }),
        });
    });
});

function createService(prisma: Record<string, any>): KnowledgeDocumentService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'request-id',
            roles: ['tenant_admin'],
            permissions: ['knowledge_base.read'],
        }),
    } as unknown as TenantContext;
    const knowledgeService = new KnowledgeService(
        prisma as unknown as PrismaService,
        tenantContext,
        { answerKnowledge: jest.fn() } as unknown as AiServiceGateway,
        { deleteKnowledgeBaseIndexes: jest.fn() } as unknown as KnowledgeIndexingService,
    );
    const fileService = {
        createMaterializedFile: createMaterializedFileSpy,
        deleteMaterializedFile: deleteMaterializedFileSpy,
    } as unknown as FileService;
    const indexingService = {
        kick: kickSpy,
        deleteDocumentVersionIndex: deleteVersionIndexSpy,
    } as unknown as KnowledgeIndexingService;
    return new KnowledgeDocumentService(
        prisma as unknown as PrismaService,
        tenantContext,
        knowledgeService,
        fileService,
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
        managedDocument: { findFirst: jest.fn() },
        conversationMessage: { findFirst: jest.fn() },
        membershipRole: { findMany: jest.fn() },
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

function messageRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        role: 'USER',
        content: '会议结论：项目延期两周。',
        conversationId: CONVERSATION_ID,
        createdAt: new Date('2026-09-16T08:00:00.000Z'),
        conversation: { ownerMembershipId: MEMBERSHIP_ID, deletedAt: null },
        ...overrides,
    };
}

function managedDocumentRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        title: '项目周报',
        content: '# 项目周报\n本周完成核心链路联调。',
        visibility: 'TENANT',
        resource: { ownerMembershipId: OTHER_MEMBERSHIP_ID, acls: [] },
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
