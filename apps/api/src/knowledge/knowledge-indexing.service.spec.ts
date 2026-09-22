import { KnowledgeDocumentStatus, VisibilityScope } from '@prisma/client';
import { AiServiceGateway, AiServiceInvocationError } from '../ai-orchestration/ai-service-gateway.service';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { KnowledgeDocumentParser, KnowledgeDocumentParserError } from './knowledge-document-parser';
import { KnowledgeIndexingService } from './knowledge-indexing.service';

describe('KnowledgeIndexingService', () => {
    it('walks a document from PENDING to READY and submits the index request', async () => {
        const mocks = createMocks();
        mocks.prisma.knowledgeDocument.findMany.mockResolvedValueOnce([]).mockResolvedValue([pendingDocument()]);
        mocks.prisma.knowledgeDocument.updateMany.mockResolvedValue({ count: 1 });
        mocks.prisma.documentVersion.findFirst.mockResolvedValue(documentVersion());
        mocks.prisma.fileObject.findFirst.mockResolvedValue(fileObject());
        mocks.prisma.knowledgeDocument.update.mockResolvedValue(undefined);
        mocks.parser.parse.mockResolvedValue(parsedDocument());
        mocks.gateway.indexKnowledge.mockResolvedValue({
            request_id: 'request-id',
            indexed_chunks: 1,
            chunking_version: 'knowledge-chunking-v1',
            embedding_profile: 'deterministic',
            index_version: 'knowledge-index-v1',
            latency_ms: 12,
        });
        const service = createService(mocks);

        const result = await service.runOnce();

        expect(result).toEqual({ skipped: false, processed: 1 });
        expect(mocks.prisma.knowledgeDocument.updateMany).toHaveBeenCalledWith({
            where: { id: DOCUMENT_ID, status: KnowledgeDocumentStatus.PENDING, deletedAt: null },
            data: { status: KnowledgeDocumentStatus.PARSING },
        });
        expect(mocks.gateway.indexKnowledge).toHaveBeenCalledWith(expect.objectContaining({
            tenant_id: TENANT_ID,
            knowledge_base_id: KNOWLEDGE_BASE_ID,
            document_id: DOCUMENT_ID,
            document_version_id: VERSION_ID,
            chunking_version: 'knowledge-chunking-v1',
            embedding_profile: 'deterministic',
            index_version: 'knowledge-index-v1',
            visibility_scope: {
                visibility_scope: VisibilityScope.DEPARTMENT,
                department_id: DEPARTMENT_ID,
                project_id: null,
                acl_version: `acl-${VERSION_ID.slice(0, 8)}`,
            },
        }));
        expect(mocks.prisma.knowledgeDocument.updateMany).toHaveBeenNthCalledWith(2, {
            where: { id: DOCUMENT_ID, currentVersionId: VERSION_ID },
            data: expect.objectContaining({ status: KnowledgeDocumentStatus.READY, retryCount: 0, lastError: null }),
        });
        expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'KNOWLEDGE_DOCUMENT_INDEXED',
                outcome: 'SUCCESS',
                resourceType: 'KNOWLEDGE_DOCUMENT',
                resourceId: DOCUMENT_ID,
            }),
        });
    });

    it('returns to PENDING after a retryable parse failure and retries', async () => {
        const mocks = createMocks();
        mocks.prisma.knowledgeDocument.findMany.mockResolvedValueOnce([]).mockResolvedValue([pendingDocument()]);
        mocks.prisma.knowledgeDocument.updateMany.mockResolvedValue({ count: 1 });
        mocks.prisma.documentVersion.findFirst.mockResolvedValue(documentVersion());
        mocks.prisma.fileObject.findFirst.mockResolvedValue(fileObject());
        mocks.parser.parse.mockRejectedValue(
            new KnowledgeDocumentParserError('MINERU_TIMEOUT', '解析超时', true),
        );
        mocks.prisma.knowledgeDocument.update
            .mockResolvedValueOnce({ retryCount: 1 })
            .mockResolvedValueOnce(undefined);
        const service = createService(mocks);

        const result = await service.runOnce();

        expect(result.processed).toBe(1);
        expect(mocks.gateway.indexKnowledge).not.toHaveBeenCalled();
        expect(mocks.prisma.knowledgeDocument.update).toHaveBeenNthCalledWith(2, {
            where: { id: DOCUMENT_ID },
            data: { status: KnowledgeDocumentStatus.PENDING },
        });
        expect(mocks.prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('marks FAILED after retryable failures reach the limit', async () => {
        const mocks = createMocks();
        mocks.prisma.knowledgeDocument.findMany.mockResolvedValueOnce([]).mockResolvedValue([pendingDocument()]);
        mocks.prisma.knowledgeDocument.updateMany.mockResolvedValue({ count: 1 });
        mocks.prisma.documentVersion.findFirst.mockResolvedValue(documentVersion());
        mocks.prisma.fileObject.findFirst.mockResolvedValue(fileObject());
        mocks.parser.parse.mockRejectedValue(
            new KnowledgeDocumentParserError('MINERU_TIMEOUT', '解析超时', true),
        );
        mocks.prisma.knowledgeDocument.update
            .mockResolvedValueOnce({ retryCount: 3 })
            .mockResolvedValueOnce(undefined);
        const service = createService(mocks);

        await service.runOnce();

        expect(mocks.prisma.knowledgeDocument.update).toHaveBeenNthCalledWith(2, {
            where: { id: DOCUMENT_ID },
            data: expect.objectContaining({
                status: KnowledgeDocumentStatus.FAILED,
                lastError: expect.stringContaining('解析超时'),
            }),
        });
        expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'KNOWLEDGE_DOCUMENT_PROCESS_FAILED',
                outcome: 'FAILURE',
                metadata: expect.objectContaining({ retryCount: 3 }),
            }),
        });
    });

    it('fails immediately for non-retryable parse errors', async () => {
        const mocks = createMocks();
        mocks.prisma.knowledgeDocument.findMany.mockResolvedValueOnce([]).mockResolvedValue([pendingDocument()]);
        mocks.prisma.knowledgeDocument.updateMany.mockResolvedValue({ count: 1 });
        mocks.prisma.documentVersion.findFirst.mockResolvedValue(documentVersion());
        mocks.prisma.fileObject.findFirst.mockResolvedValue(fileObject());
        mocks.parser.parse.mockRejectedValue(
            new KnowledgeDocumentParserError('MINERU_NOT_CONFIGURED', 'MinerU 未部署', false),
        );
        mocks.prisma.knowledgeDocument.update
            .mockResolvedValueOnce({ retryCount: 1 })
            .mockResolvedValueOnce(undefined);
        const service = createService(mocks);

        await service.runOnce();

        expect(mocks.prisma.knowledgeDocument.update).toHaveBeenNthCalledWith(2, {
            where: { id: DOCUMENT_ID },
            data: expect.objectContaining({ status: KnowledgeDocumentStatus.FAILED }),
        });
    });

    it('retries a retryable index failure from the gateway', async () => {
        const mocks = createMocks();
        mocks.prisma.knowledgeDocument.findMany.mockResolvedValueOnce([]).mockResolvedValue([pendingDocument()]);
        mocks.prisma.knowledgeDocument.updateMany.mockResolvedValue({ count: 1 });
        mocks.prisma.documentVersion.findFirst.mockResolvedValue(documentVersion());
        mocks.prisma.fileObject.findFirst.mockResolvedValue(fileObject());
        mocks.parser.parse.mockResolvedValue(parsedDocument());
        mocks.gateway.indexKnowledge.mockRejectedValue(
            new AiServiceInvocationError('AI_SERVICE_UNAVAILABLE', '暂时不可用', true, 503),
        );
        // 调用顺序：markStatus(PARSED) -> markStatus(INDEXING) -> handleFailure increment -> handleFailure PENDING
        mocks.prisma.knowledgeDocument.update
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce({ retryCount: 1 })
            .mockResolvedValueOnce(undefined);
        const service = createService(mocks);

        await service.runOnce();

        expect(mocks.prisma.knowledgeDocument.update).toHaveBeenNthCalledWith(4, {
            where: { id: DOCUMENT_ID },
            data: { status: KnowledgeDocumentStatus.PENDING },
        });
    });

    it('recovers stalled PARSING/INDEXING documents back to PENDING', async () => {
        const mocks = createMocks();
        const stalled = pendingDocument({ status: KnowledgeDocumentStatus.PARSING });
        mocks.prisma.knowledgeDocument.findMany
            .mockResolvedValueOnce([stalled])
            .mockResolvedValueOnce([]);
        mocks.prisma.knowledgeDocument.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(mocks);

        const result = await service.runOnce();

        expect(result).toEqual({ skipped: false, processed: 0 });
        expect(mocks.prisma.knowledgeDocument.updateMany).toHaveBeenCalledWith({
            where: { id: DOCUMENT_ID, status: KnowledgeDocumentStatus.PARSING, deletedAt: null },
            data: {
                status: KnowledgeDocumentStatus.PENDING,
                lastError: '处理超时，已自动回收重新排队',
            },
        });
        expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'KNOWLEDGE_DOCUMENT_PROCESS_RECOVERED',
                outcome: 'SUCCESS',
                metadata: expect.objectContaining({ priorStatus: 'PARSING' }),
            }),
        });
    });

    it('skips a document already claimed by another instance', async () => {
        const mocks = createMocks();
        mocks.prisma.knowledgeDocument.findMany.mockResolvedValueOnce([]).mockResolvedValue([pendingDocument()]);
        mocks.prisma.knowledgeDocument.updateMany.mockResolvedValue({ count: 0 });
        const service = createService(mocks);

        const result = await service.runOnce();

        expect(result.processed).toBe(0);
        expect(mocks.parser.parse).not.toHaveBeenCalled();
    });

    it('fails immediately when the document has no current version', async () => {
        const mocks = createMocks();
        mocks.prisma.knowledgeDocument.findMany
            .mockResolvedValueOnce([])
            .mockResolvedValue([
            pendingDocument({ currentVersionId: null }),
        ]);
        mocks.prisma.knowledgeDocument.updateMany.mockResolvedValue({ count: 1 });
        mocks.prisma.knowledgeDocument.update
            .mockResolvedValueOnce({ retryCount: 1 })
            .mockResolvedValueOnce(undefined);
        const service = createService(mocks);

        await service.runOnce();

        expect(mocks.parser.parse).not.toHaveBeenCalled();
        expect(mocks.prisma.knowledgeDocument.update).toHaveBeenNthCalledWith(2, {
            where: { id: DOCUMENT_ID },
            data: expect.objectContaining({
                status: KnowledgeDocumentStatus.FAILED,
                lastError: expect.stringContaining('版本'),
            }),
        });
    });

    it('fails immediately when the file object is missing', async () => {
        const mocks = createMocks();
        mocks.prisma.knowledgeDocument.findMany.mockResolvedValueOnce([]).mockResolvedValue([pendingDocument()]);
        mocks.prisma.knowledgeDocument.updateMany.mockResolvedValue({ count: 1 });
        mocks.prisma.documentVersion.findFirst.mockResolvedValue(documentVersion());
        mocks.prisma.fileObject.findFirst.mockResolvedValue(null);
        mocks.prisma.knowledgeDocument.update
            .mockResolvedValueOnce({ retryCount: 1 })
            .mockResolvedValueOnce(undefined);
        const service = createService(mocks);

        await service.runOnce();

        expect(mocks.parser.parse).not.toHaveBeenCalled();
        expect(mocks.prisma.knowledgeDocument.update).toHaveBeenNthCalledWith(2, {
            where: { id: DOCUMENT_ID },
            data: expect.objectContaining({ status: KnowledgeDocumentStatus.FAILED }),
        });
    });

    it('skips the run when the Redis lock is held', async () => {
        const mocks = createMocks();
        mocks.redis.setIfAbsent.mockResolvedValue(false);
        const service = createService(mocks);

        const result = await service.runOnce();

        expect(result).toEqual({ skipped: true, processed: 0 });
        expect(mocks.prisma.knowledgeDocument.findMany).not.toHaveBeenCalled();
    });

    it('derives stable index identity from configuration', async () => {
        process.env.KNOWLEDGE_INDEX_VERSION = 'custom-index-v2';
        const mocks = createMocks();
        mocks.prisma.knowledgeDocument.findMany.mockResolvedValueOnce([]).mockResolvedValue([pendingDocument()]);
        mocks.prisma.knowledgeDocument.updateMany.mockResolvedValue({ count: 1 });
        mocks.prisma.documentVersion.findFirst.mockResolvedValue(documentVersion());
        mocks.prisma.fileObject.findFirst.mockResolvedValue(fileObject());
        mocks.parser.parse.mockResolvedValue(parsedDocument());
        mocks.gateway.indexKnowledge.mockResolvedValue({
            request_id: 'request-id',
            indexed_chunks: 1,
            chunking_version: 'knowledge-chunking-v1',
            embedding_profile: 'deterministic',
            index_version: 'custom-index-v2',
            latency_ms: 12,
        });
        const service = createService(mocks);

        await service.runOnce();

        expect(mocks.gateway.indexKnowledge).toHaveBeenCalledWith(expect.objectContaining({
            index_version: 'custom-index-v2',
        }));
        delete process.env.KNOWLEDGE_INDEX_VERSION;
    });

    it('deletes a document version index with the configured index version', async () => {
        const mocks = createMocks();
        mocks.gateway.deleteKnowledgeIndex.mockResolvedValue({
            request_id: 'request-id',
            deleted_chunks: 3,
            document_version_id: VERSION_ID,
            index_version: 'knowledge-index-v1',
        });
        const service = createService(mocks);

        await service.deleteDocumentVersionIndex(TENANT_ID, 'user-1', VERSION_ID);

        expect(mocks.gateway.deleteKnowledgeIndex).toHaveBeenCalledWith({
            request_id: expect.any(String),
            tenant_id: TENANT_ID,
            user_id: 'user-1',
            document_version_id: VERSION_ID,
            index_version: 'knowledge-index-v1',
        });
    });

    it('cleans the fresh index when the document was soft-deleted during indexing', async () => {
        const mocks = createMocks();
        mocks.prisma.knowledgeDocument.findMany.mockResolvedValueOnce([]).mockResolvedValue([pendingDocument()]);
        mocks.prisma.knowledgeDocument.updateMany.mockResolvedValue({ count: 1 });
        mocks.prisma.documentVersion.findFirst.mockResolvedValue(documentVersion());
        mocks.prisma.fileObject.findFirst.mockResolvedValue(fileObject());
        mocks.parser.parse.mockResolvedValue(parsedDocument());
        mocks.gateway.indexKnowledge.mockResolvedValue({
            request_id: 'request-id',
            indexed_chunks: 1,
            chunking_version: 'knowledge-chunking-v1',
            embedding_profile: 'deterministic',
            index_version: 'knowledge-index-v1',
            latency_ms: 12,
        });
        // 索引完成后文档已被软删：findFirst 返回 null，不再标回 READY。
        mocks.prisma.knowledgeDocument.findFirst.mockResolvedValue(null);
        mocks.gateway.deleteKnowledgeIndex.mockResolvedValue({
            request_id: 'request-id',
            deleted_chunks: 1,
            document_version_id: VERSION_ID,
            index_version: 'knowledge-index-v1',
        });
        const service = createService(mocks);

        await service.runOnce();

        // 已删文档不再标回 READY（PARSED/INDEXING 状态更新仍正常发生）。
        expect(mocks.prisma.knowledgeDocument.update).not.toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: KnowledgeDocumentStatus.READY }),
        }));
        expect(mocks.gateway.deleteKnowledgeIndex).toHaveBeenCalledWith(expect.objectContaining({
            tenant_id: TENANT_ID,
            document_version_id: VERSION_ID,
        }));
    });

    it('cleans the fresh index when the document was restored with a newer version during indexing', async () => {
        const mocks = createMocks();
        mocks.prisma.knowledgeDocument.findMany.mockResolvedValueOnce([]).mockResolvedValue([pendingDocument()]);
        mocks.prisma.knowledgeDocument.updateMany.mockResolvedValue({ count: 1 });
        mocks.prisma.documentVersion.findFirst.mockResolvedValue(documentVersion());
        mocks.prisma.fileObject.findFirst.mockResolvedValue(fileObject());
        mocks.parser.parse.mockResolvedValue(parsedDocument());
        mocks.gateway.indexKnowledge.mockResolvedValue({
            request_id: 'request-id',
            indexed_chunks: 1,
            chunking_version: 'knowledge-chunking-v1',
            embedding_profile: 'deterministic',
            index_version: 'knowledge-index-v1',
            latency_ms: 12,
        });
        // 索引完成后文档已被恢复并追加新版本：旧版本不再是 currentVersionId。
        mocks.prisma.knowledgeDocument.findFirst.mockResolvedValue(null);
        mocks.gateway.deleteKnowledgeIndex.mockResolvedValue({
            request_id: 'request-id',
            deleted_chunks: 1,
            document_version_id: VERSION_ID,
            index_version: 'knowledge-index-v1',
        });
        const service = createService(mocks);

        await service.runOnce();

        // 存活校验必须同时声明 currentVersionId，否则恢复竞态下旧任务仍会写坏状态。
        expect(mocks.prisma.knowledgeDocument.findFirst).toHaveBeenCalledWith({
            where: { id: DOCUMENT_ID, deletedAt: null, currentVersionId: VERSION_ID },
            select: { id: true },
        });
        expect(mocks.prisma.knowledgeDocument.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: KnowledgeDocumentStatus.READY }),
        }));
        expect(mocks.gateway.deleteKnowledgeIndex).toHaveBeenCalledWith(expect.objectContaining({
            tenant_id: TENANT_ID,
            document_version_id: VERSION_ID,
        }));
    });

    it('cleans the fresh index when the version is replaced between the survival check and READY marking', async () => {
        const mocks = createMocks();
        mocks.prisma.knowledgeDocument.findMany.mockResolvedValueOnce([]).mockResolvedValue([pendingDocument()]);
        mocks.prisma.documentVersion.findFirst.mockResolvedValue(documentVersion());
        mocks.prisma.fileObject.findFirst.mockResolvedValue(fileObject());
        mocks.parser.parse.mockResolvedValue(parsedDocument());
        mocks.gateway.indexKnowledge.mockResolvedValue({
            request_id: 'request-id',
            indexed_chunks: 1,
            chunking_version: 'knowledge-chunking-v1',
            embedding_profile: 'deterministic',
            index_version: 'knowledge-index-v1',
            latency_ms: 12,
        });
        // 存活校验通过（版本仍是当前版本），但 claim 之后、标 READY 之前被追加了新版本：
        // updateMany 按 currentVersionId 条件命中 0 行。
        mocks.prisma.knowledgeDocument.findFirst.mockResolvedValue({ id: DOCUMENT_ID });
        mocks.prisma.knowledgeDocument.updateMany
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 0 });
        mocks.gateway.deleteKnowledgeIndex.mockResolvedValue({
            request_id: 'request-id',
            deleted_chunks: 1,
            document_version_id: VERSION_ID,
            index_version: 'knowledge-index-v1',
        });
        const service = createService(mocks);

        await service.runOnce();

        expect(mocks.prisma.knowledgeDocument.updateMany).toHaveBeenNthCalledWith(2, {
            where: { id: DOCUMENT_ID, currentVersionId: VERSION_ID },
            data: expect.objectContaining({ status: KnowledgeDocumentStatus.READY }),
        });
        expect(mocks.prisma.auditLog.create).not.toHaveBeenCalled();
        expect(mocks.gateway.deleteKnowledgeIndex).toHaveBeenCalledWith(expect.objectContaining({
            tenant_id: TENANT_ID,
            document_version_id: VERSION_ID,
        }));
    });

    it('cleans all version indexes of a knowledge base and tolerates single failures', async () => {
        const mocks = createMocks();
        mocks.prisma.knowledgeDocument.findMany.mockResolvedValue([
            { id: DOCUMENT_ID },
            { id: '40000000-0000-0000-0000-000000000002' },
        ]);
        mocks.prisma.documentVersion.findMany.mockResolvedValue([
            { id: VERSION_ID },
            { id: '50000000-0000-0000-0000-000000000002' },
            { id: '50000000-0000-0000-0000-000000000003' },
        ]);
        mocks.gateway.deleteKnowledgeIndex
            .mockResolvedValueOnce({ request_id: 'r', deleted_chunks: 1, document_version_id: VERSION_ID, index_version: 'knowledge-index-v1' })
            .mockRejectedValueOnce(new AiServiceInvocationError('AI_SERVICE_UNAVAILABLE', 'down', true, 503))
            .mockResolvedValueOnce({ request_id: 'r', deleted_chunks: 2, document_version_id: 'v3', index_version: 'knowledge-index-v1' });
        const service = createService(mocks);

        await service.deleteKnowledgeBaseIndexes(TENANT_ID, 'user-1', KNOWLEDGE_BASE_ID);

        expect(mocks.prisma.documentVersion.findMany).toHaveBeenCalledWith({
            where: { tenantId: TENANT_ID, documentId: { in: [DOCUMENT_ID, '40000000-0000-0000-0000-000000000002'] } },
            select: { id: true },
        });
        expect(mocks.gateway.deleteKnowledgeIndex).toHaveBeenCalledTimes(3);
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const KNOWLEDGE_BASE_ID = '30000000-0000-0000-0000-000000000001';
const DOCUMENT_ID = '40000000-0000-0000-0000-000000000001';
const VERSION_ID = '50000000-0000-0000-0000-000000000001';
const FILE_OBJECT_ID = '60000000-0000-0000-0000-000000000001';
const DEPARTMENT_ID = '70000000-0000-0000-0000-000000000001';

interface Mocks {
    prisma: Record<string, any>;
    redis: { setIfAbsent: jest.Mock; deleteIfValue: jest.Mock };
    gateway: { indexKnowledge: jest.Mock; deleteKnowledgeIndex: jest.Mock };
    parser: { parse: jest.Mock };
}

function createService(mocks: Mocks): KnowledgeIndexingService {
    return new KnowledgeIndexingService(
        mocks.prisma as unknown as PrismaService,
        mocks.redis as unknown as RedisService,
        mocks.gateway as unknown as AiServiceGateway,
        mocks.parser as unknown as KnowledgeDocumentParser,
    );
}

function createMocks(): Mocks {
    const prisma: Record<string, any> = {
        knowledgeDocument: {
            findMany: jest.fn().mockResolvedValue([]),
            updateMany: jest.fn(),
            update: jest.fn(),
            findFirst: jest.fn().mockResolvedValue({ id: DOCUMENT_ID }),
        },
        documentVersion: { findFirst: jest.fn(), findMany: jest.fn() },
        fileObject: { findFirst: jest.fn() },
        auditLog: { create: jest.fn() },
    };
    return {
        prisma,
        redis: { setIfAbsent: jest.fn().mockResolvedValue(true), deleteIfValue: jest.fn().mockResolvedValue(undefined) },
        gateway: { indexKnowledge: jest.fn(), deleteKnowledgeIndex: jest.fn() },
        parser: { parse: jest.fn() },
    };
}

function pendingDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: DOCUMENT_ID,
        tenantId: TENANT_ID,
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        fileObjectId: FILE_OBJECT_ID,
        name: '产品手册',
        createdBy: '10000000-0000-0000-0000-000000000002',
        currentVersionId: VERSION_ID,
        status: KnowledgeDocumentStatus.PENDING,
        retryCount: 0,
        ...overrides,
    };
}

function documentVersion(): Record<string, unknown> {
    return {
        id: VERSION_ID,
        tenantId: TENANT_ID,
        documentId: DOCUMENT_ID,
        visibilityScope: VisibilityScope.DEPARTMENT,
        departmentId: DEPARTMENT_ID,
        projectId: null,
    };
}

function fileObject(): Record<string, unknown> {
    return {
        id: FILE_OBJECT_ID,
        tenantId: TENANT_ID,
        originalName: 'manual.pdf',
        mimeType: 'application/pdf',
        sizeBytes: BigInt(1024),
        objectKey: 'uploads/tenant/manual.pdf',
    };
}

function parsedDocument() {
    return {
        document_id: DOCUMENT_ID,
        document_version_id: VERSION_ID,
        parser_name: 'mineru',
        parser_version: '2.0',
        blocks: [{
            block_id: 'block-00000',
            type: 'paragraph',
            text: '项目延期需要升级到项目委员会。',
            source_order: 0,
        }],
    };
}
