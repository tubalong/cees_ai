-- Promote the existing role name to a stable machine-readable code.
ALTER TABLE "roles" RENAME COLUMN "name" TO "code";
ALTER INDEX "roles_tenant_id_name_key" RENAME TO "roles_tenant_id_code_key";

-- Add user-facing metadata and system-role protection.
ALTER TABLE "roles"
    ADD COLUMN "name" TEXT,
    ADD COLUMN "description" TEXT,
    ADD COLUMN "is_system" BOOLEAN NOT NULL DEFAULT false;

UPDATE "roles" SET "name" = "code";
UPDATE "roles"
SET "name" = '租户管理员', "is_system" = true
WHERE "code" = 'tenant_admin';

ALTER TABLE "roles" ALTER COLUMN "name" SET NOT NULL;
CREATE INDEX "roles_tenant_id_deleted_at_idx" ON "roles"("tenant_id", "deleted_at");
