-- Add queryable audit outcome and actor membership fields.
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE');

ALTER TABLE "audit_logs"
    ADD COLUMN "actor_membership_id" UUID,
    ADD COLUMN "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS';

-- Backfill membership ids previously stored in metadata.
WITH candidates AS (
    SELECT
        "id",
        COALESCE("metadata"->>'actorMembershipId', "metadata"->>'membershipId') AS "membership_id"
    FROM "audit_logs"
)
UPDATE "audit_logs" AS logs
SET "actor_membership_id" = candidates."membership_id"::UUID
FROM candidates
WHERE logs."id" = candidates."id"
  AND candidates."membership_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

UPDATE "audit_logs"
SET "outcome" = 'FAILURE'
WHERE "action" LIKE '%FAILED%'
   OR "action" LIKE '%REUSE_DETECTED%';

DROP INDEX "audit_logs_tenant_id_created_at_idx";
CREATE INDEX "audit_logs_tenant_id_created_at_id_idx" ON "audit_logs"("tenant_id", "created_at", "id");
CREATE INDEX "audit_logs_tenant_id_action_created_at_idx" ON "audit_logs"("tenant_id", "action", "created_at");
CREATE INDEX "audit_logs_tenant_id_outcome_created_at_idx" ON "audit_logs"("tenant_id", "outcome", "created_at");
CREATE INDEX "audit_logs_tenant_id_actor_membership_id_created_at_idx" ON "audit_logs"("tenant_id", "actor_membership_id", "created_at");
CREATE INDEX "audit_logs_tenant_id_request_id_idx" ON "audit_logs"("tenant_id", "request_id");
