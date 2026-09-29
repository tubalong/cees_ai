import { PrismaService } from '../database/prisma.service';
import { AuditRetentionService } from './audit-retention.service';

const NOW = new Date('2026-09-29T00:00:00.000Z');
const MILLISECONDS_PER_DAY = 86_400_000;

describe('AuditRetentionService', () => {
    afterEach(() => {
        delete process.env.AUDIT_RETENTION_ENABLED;
        delete process.env.AUDIT_RETENTION_BATCH_SIZE;
        delete process.env.AUDIT_RETENTION_MAX_BATCHES;
        delete process.env.AUDIT_CONNECTOR_READ_RETENTION_DAYS;
        delete process.env.AUDIT_ARCHIVE_AFTER_DAYS;
    });

    it('does nothing when AUDIT_RETENTION_ENABLED is false', async () => {
        process.env.AUDIT_RETENTION_ENABLED = 'false';
        const prisma = createPrismaMock();
        const service = new AuditRetentionService(prisma as unknown as PrismaService);

        await expect(service.runOnce(NOW)).resolves.toEqual({ purgedConnectorReadEvents: 0, archivedAuditEvents: 0 });
        expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('purges per-call connector reads after 90 days and archives audits older than 3 years', async () => {
        const prisma = createPrismaMock();
        const service = new AuditRetentionService(prisma as unknown as PrismaService);

        await expect(service.runOnce(NOW)).resolves.toEqual({ purgedConnectorReadEvents: 0, archivedAuditEvents: 0 });
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);

        const purge = readSql(prisma, 0);
        expect(purge.text).toContain('DELETE FROM "audit_logs"');
        expect(purge.text).toContain('"resource_type" = $1');
        expect(purge.text).toContain('"action" = $2');
        expect(purge.text).toContain('"metadata" ->> \'aggregated\' = \'false\'');
        expect(purge.values).toEqual([
            'CONNECTOR',
            'CONNECTOR_READ_OPERATION',
            new Date(NOW.getTime() - 90 * MILLISECONDS_PER_DAY),
            1000,
        ]);

        const archive = readSql(prisma, 1);
        expect(archive.text).toContain('INSERT INTO "audit_logs_archive"');
        expect(archive.text).toContain('DELETE FROM "audit_logs"');
        expect(archive.values).toEqual([new Date(NOW.getTime() - 1095 * MILLISECONDS_PER_DAY), 1000]);
    });

    it('drains in batches until a batch is not full', async () => {
        const prisma = createPrismaMock();
        prisma.$executeRaw
            .mockResolvedValueOnce(1000)
            .mockResolvedValueOnce(2)
            .mockResolvedValueOnce(1000)
            .mockResolvedValueOnce(1000)
            .mockResolvedValueOnce(5);
        const service = new AuditRetentionService(prisma as unknown as PrismaService);

        await expect(service.runOnce(NOW)).resolves.toEqual({ purgedConnectorReadEvents: 1002, archivedAuditEvents: 2005 });
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(5);
    });

    it('stops at the configured per-run batch cap', async () => {
        process.env.AUDIT_RETENTION_BATCH_SIZE = '10';
        process.env.AUDIT_RETENTION_MAX_BATCHES = '2';
        const prisma = createPrismaMock();
        prisma.$executeRaw.mockResolvedValue(10);
        const service = new AuditRetentionService(prisma as unknown as PrismaService);

        await expect(service.runOnce(NOW)).resolves.toEqual({ purgedConnectorReadEvents: 20, archivedAuditEvents: 20 });
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(4);
        expect(readSql(prisma, 0).values).toEqual([
            'CONNECTOR',
            'CONNECTOR_READ_OPERATION',
            new Date(NOW.getTime() - 90 * MILLISECONDS_PER_DAY),
            10,
        ]);
    });

    it('applies retention overrides and falls back on invalid values', async () => {
        process.env.AUDIT_CONNECTOR_READ_RETENTION_DAYS = '30';
        process.env.AUDIT_ARCHIVE_AFTER_DAYS = 'not-a-number';
        const prisma = createPrismaMock();
        const service = new AuditRetentionService(prisma as unknown as PrismaService);

        await service.runOnce(NOW);

        expect(readSql(prisma, 0).values[2]).toEqual(new Date(NOW.getTime() - 30 * MILLISECONDS_PER_DAY));
        expect(readSql(prisma, 1).values[0]).toEqual(new Date(NOW.getTime() - 1095 * MILLISECONDS_PER_DAY));
    });
});

function createPrismaMock(): Record<string, any> {
    return { $executeRaw: jest.fn().mockResolvedValue(0) };
}

function readSql(prisma: Record<string, any>, callIndex: number): { text: string; values: unknown[] } {
    return prisma.$executeRaw.mock.calls[callIndex][0] as { text: string; values: unknown[] };
}