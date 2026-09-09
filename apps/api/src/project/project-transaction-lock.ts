import { Prisma } from '@prisma/client';

export async function lockProjectForUpdate(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    projectId: string,
): Promise<void> {
    await transaction.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "projects"
        WHERE "id" = CAST(${projectId} AS uuid)
          AND "tenant_id" = CAST(${tenantId} AS uuid)
        FOR UPDATE
    `);
}
