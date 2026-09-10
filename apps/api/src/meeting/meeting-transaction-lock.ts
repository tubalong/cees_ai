import { Prisma } from '@prisma/client';

export async function lockMeetingForUpdate(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    meetingId: string,
): Promise<void> {
    await transaction.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "meetings"
        WHERE "id" = CAST(${meetingId} AS uuid)
          AND "tenant_id" = CAST(${tenantId} AS uuid)
        FOR UPDATE
    `);
}
