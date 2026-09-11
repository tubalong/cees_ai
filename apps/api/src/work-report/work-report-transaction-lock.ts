import { Prisma } from '@prisma/client';

export async function lockWorkReportForUpdate(transaction: Prisma.TransactionClient, tenantId: string, workReportId: string): Promise<void> {
    await transaction.$queryRaw(Prisma.sql`
        SELECT id FROM work_reports
        WHERE id = CAST(${workReportId} AS uuid)
          AND tenant_id = CAST(${tenantId} AS uuid)
          AND deleted_at IS NULL
        FOR UPDATE
    `);
}
