import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuditOutcome, KnowledgeDocumentStatus, Prisma, VisibilityScope } from '@prisma/client';
import type {
    KnowledgeIndexDeleteResponse,
    KnowledgeIndexRequest,
    KnowledgeVisibilityScope,
    ParsedDocument,
} from '@cees/ai-service-client';
import { randomUUID } from 'node:crypto';
import { AiServiceGateway, AiServiceInvocationError } from '../ai-orchestration/ai-service-gateway.service';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
    KNOWLEDGE_DOCUMENT_PARSER,
    KnowledgeDocumentFileInput,
    KnowledgeDocumentParser,
    KnowledgeDocumentParserError,
} from './knowledge-document-parser';

const LOCK_KEY = 'jobs:knowledge-document-indexer';
const DEFAULT_INTERVAL_SECONDS = 15;
const DEFAULT_MAX_RETRIES = 3;
const BATCH_SIZE = 10;
/** 记录最近观测到的向量索引 epoch；用于识别「向量已随 ai-service 重启丢失」。 */
const INDEX_EPOCH_KEY = 'jobs:knowledge-index-epoch';
/** 索引丢失后自动重排的原因说明，写回 lastError 便于排查。 */
const VOLATILE_INDEX_LOST_MESSAGE = '向量索引随 ai-service 重启丢失，已自动重新排队索引';

interface PendingDocumentRow {
    id: string;
    tenantId: string;
    knowledgeBaseId: string;
    fileObjectId: string;
    name: string;
    createdBy: string | null;
    currentVersionId: string | null;
    status: KnowledgeDocumentStatus;
    retryCount: number;
}

interface IndexFailure {
    message: string;
    retryable: boolean;
}

/**
 * 知识库文档索引 Worker：轮询 PENDING 文档并推进处理状态机
 * PENDING -> PARSING -> PARSED -> INDEXING -> READY / FAILED。
 * 解析由可替换的 KnowledgeDocumentParser 完成（块 3 为 MinerU 占位实现），
 * 索引调用 ai-service /internal/v1/knowledge/index（幂等 upsert）。
 * 失败按 retryable 语义重试，超过上限置 FAILED 并记录原因。
 */
@Injectable()
export class KnowledgeIndexingService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(KnowledgeIndexingService.name);
    private timer: NodeJS.Timeout | undefined;
    private readonly intervalSeconds = readPositiveInteger(
        process.env.KNOWLEDGE_INDEXING_INTERVAL_SECONDS,
        DEFAULT_INTERVAL_SECONDS,
    );
    private readonly maxRetries = readPositiveInteger(
        process.env.KNOWLEDGE_INDEX_MAX_RETRIES,
        DEFAULT_MAX_RETRIES,
    );
    // 索引三元组在构造时读取，允许按环境覆盖（chunking / embedding profile / index 版本）。
    private readonly indexVersions = readIndexVersions();
    // 孤儿状态回收阈值：解析最长耗时（MinerU 超时）的 2 倍。超过该时长仍停留在
    // PARSING/INDEXING 的文档视为处理进程已丢失（崩溃/重启），自动回 PENDING 重新排队。
    private readonly stallRecoveryAfterMs = 2 * readPositiveInteger(
        process.env.MINERU_API_TIMEOUT_MS,
        30 * 60 * 1000,
    );

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly gateway: AiServiceGateway,
        @Inject(KNOWLEDGE_DOCUMENT_PARSER) private readonly parser: KnowledgeDocumentParser,
    ) { }

    onModuleInit(): void {
        if (process.env.KNOWLEDGE_INDEXING_ENABLED === 'false') return;
        this.timer = setInterval(
            () => void this.runOnce().catch((error: unknown) => this.logger.error(error)),
            this.intervalSeconds * 1000,
        );
        this.timer.unref();
    }

    onModuleDestroy(): void {
        if (this.timer) clearInterval(this.timer);
    }

    /** 上传完成后的即时触发；与定时轮询共用 Redis 锁，不会重复处理同一文档。 */
    async kick(): Promise<void> {
        void this.runOnce().catch((error: unknown) => this.logger.error(error));
    }

    /**
     * 删除指定文档版本的派生索引。失败抛 AiServiceInvocationError，由调用方
     * 决定降级策略（当前：fire-and-forget 记日志，不阻塞业务写入）。
     */
    async deleteDocumentVersionIndex(
        tenantId: string,
        userId: string,
        documentVersionId: string,
    ): Promise<KnowledgeIndexDeleteResponse> {
        return this.gateway.deleteKnowledgeIndex({
            request_id: randomUUID(),
            tenant_id: tenantId,
            user_id: userId,
            document_version_id: documentVersionId,
            index_version: this.indexVersions.indexVersion,
        });
    }

    /**
     * 清理知识库下全部文档版本的派生索引（知识库删除后的卫生清理）。
     * 单个版本删除失败只记日志并继续清理其余版本，最坏遗留向量垃圾，
     * 幂等重试后收敛。
     */
    async deleteKnowledgeBaseIndexes(tenantId: string, userId: string, knowledgeBaseId: string): Promise<void> {
        const documents = await this.prisma.knowledgeDocument.findMany({
            where: { tenantId, knowledgeBaseId },
            select: { id: true },
        });
        if (documents.length === 0) return;
        const versions = await this.prisma.documentVersion.findMany({
            where: { tenantId, documentId: { in: documents.map((document) => document.id) } },
            select: { id: true },
        });
        for (const version of versions) {
            try {
                await this.deleteDocumentVersionIndex(tenantId, userId, version.id);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'unknown error';
                this.logger.warn(`清理知识库派生索引失败（版本 ${version.id}）：${message}`);
            }
        }
    }

    async runOnce(): Promise<{ skipped: boolean; processed: number }> {
        const lockToken = randomUUID();
        const acquired = await this.redis.setIfAbsent(LOCK_KEY, lockToken, Math.max(this.intervalSeconds * 2, 30));
        if (!acquired) return { skipped: true, processed: 0 };
        try {
            // 先回收孤儿状态（进程崩溃时卡在 PARSING/INDEXING 的文档），再处理 PENDING 队列。
            await this.recoverStalledDocuments();
            await this.rebuildLostVolatileIndex();
            const pending = await this.prisma.knowledgeDocument.findMany({
                where: { status: KnowledgeDocumentStatus.PENDING, deletedAt: null },
                select: {
                    id: true,
                    tenantId: true,
                    knowledgeBaseId: true,
                    fileObjectId: true,
                    name: true,
                    createdBy: true,
                    currentVersionId: true,
                    status: true,
                    retryCount: true,
                },
                orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
                take: BATCH_SIZE,
            });
            let processed = 0;
            for (const document of pending) {
                const handled = await this.processDocument(document);
                if (handled) processed += 1;
            }
            return { skipped: false, processed };
        } finally {
            await this.redis.deleteIfValue(LOCK_KEY, lockToken);
        }
    }

    /**
     * 对账向量索引与文档状态，重建随 ai-service 重启丢失的索引。
     *
     * memory 后端（`durable=false`）的向量只活在 ai-service 进程内：进程重启后
     * 向量全部清空，而业务库里的文档仍是 READY，检索会静默返回空结果——用户看到
     * 「文档都在、检索却什么都查不到」。这里以 ai-service 上报的索引身份为准：
     * 非持久化后端且 epoch 变化（含首次观测）时，把全部 READY 文档回退到 PENDING
     * 重新索引。索引写入本身是幂等 upsert，重建期间检索只会命中旧向量或新向量，
     * 不会出现半截结果。
     *
     * 持久化后端（pgvector）epoch 恒定，只在首次观测时写一次基线，不触发重建。
     * 读取失败时跳过本轮：把「读不到索引身份」当成「索引已丢」会造成无意义的全量重建。
     */
    private async rebuildLostVolatileIndex(): Promise<void> {
        const status = await this.gateway.fetchKnowledgeIndexStatus();
        if (!status) return;
        const previousEpoch = await this.redis.get(INDEX_EPOCH_KEY);
        if (previousEpoch === status.epoch) return;
        await this.redis.set(INDEX_EPOCH_KEY, status.epoch);
        if (status.durable) return;
        const result = await this.prisma.knowledgeDocument.updateMany({
            where: { status: KnowledgeDocumentStatus.READY, deletedAt: null },
            data: {
                status: KnowledgeDocumentStatus.PENDING,
                lastError: VOLATILE_INDEX_LOST_MESSAGE,
            },
        });
        if (result.count === 0) return;
        this.logger.warn(
            `知识库向量索引后端为 ${status.backend}（非持久化），epoch 变化后已重新排队 ${result.count} 篇文档重建索引。`,
        );
    }

    /**
     * 回收超时滞留的孤儿文档：超过阈值仍停留在 PARSING/INDEXING（正常流程已推进到
     * READY/FAILED），说明处理进程已丢失（崩溃/重启），回 PENDING 重新排队。
     * 条件更新按原状态声明所有权，与并发处理实例互不干扰；恢复时审计记录原状态。
     */
    private async recoverStalledDocuments(): Promise<number> {
        const cutoff = new Date(Date.now() - this.stallRecoveryAfterMs);
        const stalled = await this.prisma.knowledgeDocument.findMany({
            where: {
                status: { in: [KnowledgeDocumentStatus.PARSING, KnowledgeDocumentStatus.INDEXING] },
                lastProcessedAt: { lt: cutoff },
                deletedAt: null,
            },
            select: { id: true, tenantId: true, knowledgeBaseId: true, status: true },
            orderBy: { lastProcessedAt: 'asc' },
            take: BATCH_SIZE,
        });
        let recovered = 0;
        for (const document of stalled) {
            const updated = await this.prisma.knowledgeDocument.updateMany({
                where: { id: document.id, status: document.status, deletedAt: null },
                data: {
                    status: KnowledgeDocumentStatus.PENDING,
                    lastError: '处理超时，已自动回收重新排队',
                },
            });
            if (updated.count !== 1) continue;
            recovered += 1;
            await this.writeAudit(document, 'KNOWLEDGE_DOCUMENT_PROCESS_RECOVERED', AuditOutcome.SUCCESS, {
                priorStatus: document.status,
            });
        }
        return recovered;
    }

    /** 推进单个文档的状态机；返回是否由本实例完成了一次迁移。 */
    private async processDocument(document: PendingDocumentRow): Promise<boolean> {
        // 条件更新声明所有权，防止多实例同时处理同一文档。
        const claimed = await this.prisma.knowledgeDocument.updateMany({
            where: { id: document.id, status: KnowledgeDocumentStatus.PENDING, deletedAt: null },
            data: { status: KnowledgeDocumentStatus.PARSING },
        });
        if (claimed.count !== 1) return false;

        try {
            const version = await this.requireCurrentVersion(document);
            const file = await this.requireFileObject(document);
            const parsed = await this.parser.parse({
                documentId: document.id,
                documentVersionId: version.id,
                fileObjectId: file.id,
                name: file.originalName,
                mimeType: file.mimeType,
                sizeBytes: file.sizeBytes,
                objectKey: file.objectKey,
                tenantId: document.tenantId,
                userId: document.createdBy ?? 'system',
            });
            await this.markStatus(document.id, KnowledgeDocumentStatus.PARSED);
            await this.markStatus(document.id, KnowledgeDocumentStatus.INDEXING);
            const indexResult = await this.gateway.indexKnowledge(
                this.buildIndexRequest(document, version, parsed),
            );
            // 删除与索引并发竞态：索引完成后文档可能已被软删，此时不再标回 READY，
            // 并补删刚写入的向量索引，避免已删文档残留可检索的向量数据。
            // 恢复竞态同理：删除→恢复→追加新版本后，处理中的旧版本不再是
            // currentVersionId；若旧任务晚于补删才写向量，此校验能兜住残留
            // （见 knowledge-document.service restoreSourceDocument）。
            const surviving = await this.prisma.knowledgeDocument.findFirst({
                where: {
                    id: document.id,
                    deletedAt: null,
                    currentVersionId: version.id,
                },
                select: { id: true },
            });
            if (!surviving) {
                void this.deleteDocumentVersionIndex(
                    document.tenantId,
                    document.createdBy ?? 'system',
                    version.id,
                ).catch((error: unknown) => {
                    const message = error instanceof Error ? error.message : 'unknown error';
                    this.logger.warn(`已删文档索引竞态清理失败（版本 ${version.id}）：${message}`);
                });
                return true;
            }
            // 标 READY 同样要求版本仍为当前版本：校验与写入之间被追加新版本时
            // 放弃标 READY 并补删，避免旧任务把新版本重置的状态写坏。
            const marked = await this.prisma.knowledgeDocument.updateMany({
                where: { id: document.id, currentVersionId: version.id },
                data: {
                    status: KnowledgeDocumentStatus.READY,
                    retryCount: 0,
                    lastError: null,
                    lastProcessedAt: new Date(),
                },
            });
            if (marked.count !== 1) {
                void this.deleteDocumentVersionIndex(
                    document.tenantId,
                    document.createdBy ?? 'system',
                    version.id,
                ).catch((error: unknown) => {
                    const message = error instanceof Error ? error.message : 'unknown error';
                    this.logger.warn(`版本已替换索引竞态清理失败（版本 ${version.id}）：${message}`);
                });
                return true;
            }
            await this.writeAudit(document, 'KNOWLEDGE_DOCUMENT_INDEXED', AuditOutcome.SUCCESS, {
                documentVersionId: version.id,
                indexedChunks: indexResult.indexed_chunks,
                ...this.indexVersions,
            });
            return true;
        } catch (error) {
            const failure = this.toFailure(error);
            return this.handleFailure(document, failure);
        }
    }

    private async handleFailure(document: PendingDocumentRow, failure: IndexFailure): Promise<boolean> {
        const updated = await this.prisma.knowledgeDocument.update({
            where: { id: document.id },
            data: {
                retryCount: { increment: 1 },
                lastError: failure.message,
                lastProcessedAt: new Date(),
            },
            select: { retryCount: true },
        });
        if (!failure.retryable || updated.retryCount >= this.maxRetries) {
            await this.prisma.knowledgeDocument.update({
                where: { id: document.id },
                data: { status: KnowledgeDocumentStatus.FAILED, lastError: failure.message },
            });
            await this.writeAudit(document, 'KNOWLEDGE_DOCUMENT_PROCESS_FAILED', AuditOutcome.FAILURE, {
                retryCount: updated.retryCount,
                reason: failure.message,
            });
        } else {
            await this.prisma.knowledgeDocument.update({
                where: { id: document.id },
                data: { status: KnowledgeDocumentStatus.PENDING },
            });
        }
        return true;
    }

    private async requireCurrentVersion(document: PendingDocumentRow) {
        if (!document.currentVersionId) {
            throw new KnowledgeDocumentParserError(
                'KNOWLEDGE_DOCUMENT_VERSION_MISSING',
                '文档缺少当前处理版本，无法解析',
                false,
            );
        }
        const version = await this.prisma.documentVersion.findFirst({
            where: { id: document.currentVersionId, tenantId: document.tenantId, documentId: document.id },
        });
        if (!version) {
            throw new KnowledgeDocumentParserError(
                'KNOWLEDGE_DOCUMENT_VERSION_MISSING',
                '文档当前处理版本不存在',
                false,
            );
        }
        return version;
    }

    private async requireFileObject(document: PendingDocumentRow) {
        const file = await this.prisma.fileObject.findFirst({
            where: { id: document.fileObjectId, tenantId: document.tenantId, deletedAt: null },
        });
        if (!file) {
            throw new KnowledgeDocumentParserError(
                'KNOWLEDGE_DOCUMENT_FILE_MISSING',
                '文档文件不存在或已被删除',
                false,
            );
        }
        return file;
    }

    private buildIndexRequest(
        document: PendingDocumentRow,
        version: {
            id: string;
            visibilityScope: VisibilityScope;
            departmentId: string | null;
            projectId: string | null;
        },
        parsed: ParsedDocument,
    ): KnowledgeIndexRequest {
        const visibilityScope: KnowledgeVisibilityScope = {
            visibility_scope: version.visibilityScope,
            department_id: version.departmentId,
            project_id: version.projectId,
            // 块 3 用版本 ID 派生稳定快照标识；块 5 检索侧引入真正的 ACL 版本机制。
            acl_version: `acl-${version.id.slice(0, 8)}`,
        };
        return {
            request_id: randomUUID(),
            tenant_id: document.tenantId,
            user_id: document.createdBy ?? 'system',
            knowledge_base_id: document.knowledgeBaseId,
            document_id: document.id,
            document_version_id: version.id,
            parsed_document: parsed,
            chunking_version: this.indexVersions.chunkingVersion,
            embedding_profile: this.indexVersions.embeddingProfile,
            index_version: this.indexVersions.indexVersion,
            visibility_scope: visibilityScope,
        };
    }

    private async markStatus(documentId: string, status: KnowledgeDocumentStatus): Promise<void> {
        await this.prisma.knowledgeDocument.update({
            where: { id: documentId },
            data: { status, lastProcessedAt: new Date() },
        });
    }

    private async writeAudit(
        document: Pick<PendingDocumentRow, 'id' | 'tenantId' | 'knowledgeBaseId'>,
        action: string,
        outcome: AuditOutcome,
        metadata: Record<string, unknown>,
    ): Promise<void> {
        await this.prisma.auditLog.create({
            data: {
                tenantId: document.tenantId,
                actorUserId: null,
                actorMembershipId: null,
                action,
                outcome,
                resourceType: 'KNOWLEDGE_DOCUMENT',
                resourceId: document.id,
                requestId: randomUUID(),
                metadata: {
                    knowledgeBaseId: document.knowledgeBaseId,
                    ...metadata,
                } as Prisma.InputJsonValue,
            },
        });
    }

    private toFailure(error: unknown): IndexFailure {
        if (error instanceof KnowledgeDocumentParserError) {
            return { message: `解析失败：${error.message}`, retryable: error.retryable };
        }
        if (error instanceof AiServiceInvocationError) {
            return { message: `索引失败：${error.message}`, retryable: error.retryable };
        }
        const message = error instanceof Error ? error.message : 'unknown error';
        this.logger.error(`知识库文档索引异常：${message}`);
        return { message: `索引异常：${message}`, retryable: true };
    }
}

function readEnv(name: string, fallback: string): string {
    const value = process.env[name]?.trim();
    return value || fallback;
}

/**
 * 读取索引三元组的当前环境配置。索引侧与查询侧共用，保证检索请求
 * 默认的 index_version 与写入侧一致；切换 embedding 或切分策略必须换新
 * index_version（见 knowledge-rag.md 3.4）。
 */
export function readIndexVersions() {
    return {
        chunkingVersion: readEnv('KNOWLEDGE_CHUNKING_VERSION', 'knowledge-chunking-v1'),
        embeddingProfile: readEnv('KNOWLEDGE_EMBEDDING_PROFILE', 'deterministic'),
        indexVersion: readEnv('KNOWLEDGE_INDEX_VERSION', 'knowledge-index-v1'),
    };
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
