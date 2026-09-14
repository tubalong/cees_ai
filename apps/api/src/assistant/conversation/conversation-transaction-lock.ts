import { Prisma } from '@prisma/client';

/** Serialize title updates, deletion and turn creation for one conversation. */
export async function lockConversationForUpdate(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  conversationId: string,
): Promise<void> {
  await transaction.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "conversations"
    WHERE "id" = CAST(${conversationId} AS uuid)
      AND "tenant_id" = CAST(${tenantId} AS uuid)
    FOR UPDATE
  `);
}
