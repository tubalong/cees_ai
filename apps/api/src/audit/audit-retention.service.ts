import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface AuditRetentionRunResult {
    purgedConnectorReadEvents: number;
    archivedAuditEvents: number;
}

const CONNECTOR_RESOURCE_TYPE = 'CONNECTOR';
const CONNECTOR_READ_ACTION = 'CONNECTOR_READ_OPERATION';
const DEFAULT_CONNECTOR_READ_RETENTION_DAYS = 90;
const DEFAULT_ARCHIVE_AFTER_DAYS = 1095;
const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_MAX_BATCHES_PER_RUN = 5;
const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * 审计分级保留：连接器只读逐条审计到期物理删除，其余租户审计到期迁移到 audit_logs_archive。
 * 平台审计（platform_audit_logs）永久保留，不参与删除或归档。
 * 调用方必须串行执行（当前由 BackgroundJobsService 在 Redis 锁内调用），避免并发归档同一批行。
 */
@Injectable()
export class AuditRetentionService {
    private readonly logger = new Logger(AuditRetentionService.name);

    constructor(private readonly prisma: PrismaService) { }

    async runOnce(now = new Date()): Promise<AuditRetentionRunResult> {
        if (process.env.AUDIT_RETENTION_ENABLED === 'false') {
            return { purgedConnectorReadEvents: 0, archivedAuditEvents: 0 };
        }
        const batchSize = readPositiveInteger(process.env.AUDIT_RETENTION_BATCH_SIZE, DEFAULT_BATCH_SIZE);
        const maxBatches = readPositiveInteger(process.env.AUDIT_RETENTION_MAX_BATCHES, DEFAULT_MAX_BATCHES_PER_RUN);
        const readCutoff = retentionCutoff(now, process.env.AUDIT_CONNECTOR_READ_RETENTION_DAYS, DEFAULT_CONNECTOR_READ_RETENTION_DAYS);
        const archiveCutoff = retentionCutoff(now, process.env.AUDIT_ARCHIVE_AFTER_DAYS, DEFAULT_ARCHIVE_AFTER_DAYS);

        const purgedConnectorReadEvents = await this.purgeVerboseConnectorReads(readCutoff, batchSize, maxBatches);
        const archivedAuditEvents = await this.archiveExpiredEvents(archiveCutoff, batchSize, maxBatches);
        return { purgedConnectorReadEvents, archivedAuditEvents };
    }

    /**
     * 删除超过保留期的连接器只读逐条审计（metadata.aggregated = false）。
     * 轮次级聚合审计（metadata.aggregated = true）每轮只有一条，按普通业务审计处理，不在这里删除。
     */
    private async purgeVerboseConnectorReads(cutoff: Date, batchSize: number, maxBatches: number): Promise<number> {
        let purged = 0;
        for (let batch = 0; batch < maxBatches; batch += 1) {
            const affected = await this.prisma.$executeRaw(Prisma.sql`
                DELETE FROM "audit_logs"
                WHERE "id" IN (
                    SELECT "id"
                    FROM "audit_logs"
                    WHERE "resource_type" = ${CONNECTOR_RESOURCE_TYPE}
                      AND "action" = ${CONNECTOR_READ_ACTION}
                      AND "metadata" ->> 'aggregated' = 'false'
                      AND "created_at" < ${cutoff}
                    ORDER BY "created_at"
                    LIMIT ${batchSize}
                )
            `);
            purged += affected;
            if (affected < batchSize) break;
        }
        if (purged > 0) this.logger.log(`purged ${purged} per-call connector read audit event(s)`);
        return purged;
    }

    /** 把超过保留期的租户审计整批搬进 audit_logs_archive：事实保留，但不再占用热表与公开查询接口。 */
    private async archiveExpiredEvents(cutoff: Date, batchSize: number, maxBatches: number): Promise<number> {
        let archived = 0;
        for (let batch = 0; batch < maxBatches; batch += 1) {
            const affected = await this.prisma.$executeRaw(Prisma.sql`
                WITH "expired" AS (
                    SELECT "id"
                    FROM "audit_logs"
                    WHERE "created_at" < ${cutoff}
                    ORDER BY "created_at"
                    LIMIT ${batchSize}
                ), "moved" AS (
                    INSERT INTO "audit_logs_archive" (
                        "id", "tenant_id", "actor_user_id", "actor_membership_id", "action", "outcome",
                        "resource_type", "resource_id", "request_id", "ip_address", "user_agent", "metadata", "created_at"
                    )
                    SELECT
                        "id", "tenant_id", "actor_user_id", "actor_membership_id", "action", "outcome",
                        "resource_type", "resource_id", "request_id", "ip_address", "user_agent", "metadata", "created_at"
                    FROM "audit_logs"
                    WHERE "id" IN (SELECT "id" FROM "expired")
                    RETURNING "id"
                )
                DELETE FROM "audit_logs" WHERE "id" IN (SELECT "id" FROM "moved")
            `);
            archived += affected;
            if (affected < batchSize) break;
        }
        if (archived > 0) this.logger.log(`archived ${archived} expired audit event(s)`);
        return archived;
    }
}

function retentionCutoff(now: Date, raw: string | undefined, fallbackDays: number): Date {
    return new Date(now.getTime() - readPositiveInteger(raw, fallbackDays) * MILLISECONDS_PER_DAY);
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}