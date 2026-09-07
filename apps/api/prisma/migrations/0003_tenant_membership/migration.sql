-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- Ensure global user identity can be introduced safely.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "users"
        GROUP BY "normalized_email"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot migrate users to global identity: duplicate normalized_email values exist';
    END IF;
END $$;

-- CreateTable
CREATE TABLE "tenant_memberships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "department_id" UUID,
    "display_name" TEXT,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id")
);

-- Backfill one membership for every existing tenant-scoped user. Reusing the
-- user id preserves compatibility with sessions and role assignments created
-- before the membership model existed.
INSERT INTO "tenant_memberships" (
    "id", "tenant_id", "user_id", "department_id", "display_name", "status",
    "joined_at", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "version"
)
SELECT
    "id", "tenant_id", "id", "department_id", NULL, 'ACTIVE'::"MembershipStatus",
    "created_at", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "version"
FROM "users";

-- Bind existing sessions to their backfilled memberships.
ALTER TABLE "auth_sessions" ADD COLUMN "membership_id" UUID;
UPDATE "auth_sessions" SET "membership_id" = "user_id";
ALTER TABLE "auth_sessions" ALTER COLUMN "membership_id" SET NOT NULL;

-- Convert user role assignments into membership role assignments.
ALTER TABLE "user_roles" RENAME TO "membership_roles";
ALTER TABLE "membership_roles" RENAME COLUMN "user_id" TO "membership_id";
ALTER INDEX "user_roles_pkey" RENAME TO "membership_roles_pkey";
ALTER INDEX "user_roles_tenant_id_user_id_idx" RENAME TO "membership_roles_tenant_id_membership_id_idx";
ALTER INDEX "user_roles_tenant_id_user_id_role_id_key" RENAME TO "membership_roles_tenant_id_membership_id_role_id_key";

-- Promote users from tenant-scoped accounts to global identities.
ALTER TABLE "users" DROP CONSTRAINT "users_tenant_id_fkey";
DROP INDEX "users_tenant_id_department_id_idx";
DROP INDEX "users_tenant_id_email_key";
DROP INDEX "users_tenant_id_normalized_email_key";
ALTER TABLE "users" DROP COLUMN "tenant_id";
ALTER TABLE "users" DROP COLUMN "department_id";

-- CreateIndex
CREATE UNIQUE INDEX "users_normalized_email_key" ON "users"("normalized_email");
CREATE UNIQUE INDEX "tenant_memberships_tenant_id_user_id_key" ON "tenant_memberships"("tenant_id", "user_id");
CREATE INDEX "tenant_memberships_tenant_id_department_id_idx" ON "tenant_memberships"("tenant_id", "department_id");
CREATE INDEX "tenant_memberships_tenant_id_status_idx" ON "tenant_memberships"("tenant_id", "status");
CREATE INDEX "auth_sessions_tenant_id_membership_id_idx" ON "auth_sessions"("tenant_id", "membership_id");

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
