-- Extend tenant lifecycle for tenants waiting on their first administrator.
ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'PENDING_ACTIVATION' BEFORE 'ACTIVE';
ALTER TYPE "MembershipStatus" ADD VALUE IF NOT EXISTS 'PENDING_ACTIVATION' BEFORE 'ACTIVE';

-- Move tenant credentials from the global user into the tenant membership realm.
ALTER TABLE "users"
    ALTER COLUMN "email" DROP NOT NULL,
    ALTER COLUMN "normalized_email" DROP NOT NULL,
    ALTER COLUMN "password_hash" DROP NOT NULL;

ALTER TABLE "tenant_memberships"
    ADD COLUMN "account" TEXT,
    ADD COLUMN "normalized_account" TEXT,
    ADD COLUMN "password_hash" TEXT,
    ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "locked_until" TIMESTAMP(3),
    ADD COLUMN "last_login_at" TIMESTAMP(3);

WITH account_candidates AS (
    SELECT
        membership."id",
        membership."tenant_id",
        CASE
            WHEN length(regexp_replace(split_part(COALESCE("user"."email", ''), '@', 1), '[^a-zA-Z0-9]', '', 'g')) >= 3
                THEN left(lower(regexp_replace(split_part("user"."email", '@', 1), '[^a-zA-Z0-9]', '', 'g')), 24)
            ELSE 'user' || left(replace(membership."id"::text, '-', ''), 8)
        END AS base_account,
        "user"."password_hash"
    FROM "tenant_memberships" membership
    JOIN "users" "user" ON "user"."id" = membership."user_id"
), ranked_accounts AS (
    SELECT
        *,
        row_number() OVER (PARTITION BY "tenant_id", base_account ORDER BY "id") AS account_rank
    FROM account_candidates
)
UPDATE "tenant_memberships" membership
SET
    "account" = ranked.base_account || CASE WHEN ranked.account_rank = 1 THEN '' ELSE ranked.account_rank::text END,
    "normalized_account" = ranked.base_account || CASE WHEN ranked.account_rank = 1 THEN '' ELSE ranked.account_rank::text END,
    "password_hash" = ranked."password_hash"
FROM ranked_accounts ranked
WHERE membership."id" = ranked."id";

ALTER TABLE "tenant_memberships"
    ALTER COLUMN "account" SET NOT NULL,
    ALTER COLUMN "normalized_account" SET NOT NULL;

CREATE UNIQUE INDEX "tenant_memberships_tenant_id_normalized_account_key"
    ON "tenant_memberships"("tenant_id", "normalized_account");

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN');
CREATE TYPE "PlatformAdministratorStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "TenantInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "platform_administrators" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account" TEXT NOT NULL,
    "normalized_account" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL DEFAULT 'SUPER_ADMIN',
    "status" "PlatformAdministratorStatus" NOT NULL DEFAULT 'ACTIVE',
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "platform_administrators_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_auth_sessions" (
    "id" UUID NOT NULL,
    "platform_administrator_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "device_name" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant_invitations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account" TEXT NOT NULL,
    "normalized_account" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "target_membership_id" UUID,
    "token_hash" TEXT NOT NULL,
    "status" "TenantInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "is_initial_administrator" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_by_user_id" UUID,
    "invited_by_user_id" UUID NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_invitations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant_invitation_roles" (
    "id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_invitation_roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_platform_administrator_id" UUID,
    "action" TEXT NOT NULL,
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID,
    "request_id" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_administrators_user_id_key" ON "platform_administrators"("user_id");
CREATE UNIQUE INDEX "platform_administrators_normalized_account_key" ON "platform_administrators"("normalized_account");
CREATE INDEX "platform_administrators_status_deleted_at_idx" ON "platform_administrators"("status", "deleted_at");
CREATE UNIQUE INDEX "platform_auth_sessions_refresh_token_hash_key" ON "platform_auth_sessions"("refresh_token_hash");
CREATE INDEX "platform_auth_sessions_platform_administrator_id_revoked_at_idx" ON "platform_auth_sessions"("platform_administrator_id", "revoked_at");
CREATE INDEX "platform_auth_sessions_user_id_revoked_at_idx" ON "platform_auth_sessions"("user_id", "revoked_at");
CREATE INDEX "platform_auth_sessions_expires_at_idx" ON "platform_auth_sessions"("expires_at");
CREATE UNIQUE INDEX "tenant_invitations_token_hash_key" ON "tenant_invitations"("token_hash");
CREATE INDEX "tenant_invitations_tenant_id_status_created_at_idx" ON "tenant_invitations"("tenant_id", "status", "created_at");
CREATE INDEX "tenant_invitations_tenant_id_normalized_account_status_idx" ON "tenant_invitations"("tenant_id", "normalized_account", "status");
CREATE INDEX "tenant_invitations_expires_at_idx" ON "tenant_invitations"("expires_at");
CREATE UNIQUE INDEX "tenant_invitation_roles_invitation_id_role_id_key" ON "tenant_invitation_roles"("invitation_id", "role_id");
CREATE INDEX "tenant_invitation_roles_role_id_idx" ON "tenant_invitation_roles"("role_id");
CREATE INDEX "platform_audit_logs_created_at_id_idx" ON "platform_audit_logs"("created_at", "id");
CREATE INDEX "platform_audit_logs_action_created_at_idx" ON "platform_audit_logs"("action", "created_at");
CREATE INDEX "platform_audit_logs_outcome_created_at_idx" ON "platform_audit_logs"("outcome", "created_at");
CREATE INDEX "platform_audit_actor_admin_created_idx" ON "platform_audit_logs"("actor_platform_administrator_id", "created_at");
CREATE INDEX "platform_audit_logs_request_id_idx" ON "platform_audit_logs"("request_id");
CREATE INDEX "platform_audit_logs_resource_type_resource_id_idx" ON "platform_audit_logs"("resource_type", "resource_id");

-- AddForeignKey
ALTER TABLE "platform_administrators" ADD CONSTRAINT "platform_administrators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_auth_sessions" ADD CONSTRAINT "platform_auth_sessions_platform_administrator_id_fkey" FOREIGN KEY ("platform_administrator_id") REFERENCES "platform_administrators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_auth_sessions" ADD CONSTRAINT "platform_auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tenant_invitation_roles" ADD CONSTRAINT "tenant_invitation_roles_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "tenant_invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_invitation_roles" ADD CONSTRAINT "tenant_invitation_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add the invitation capability and grant it to every built-in tenant administrator role.
INSERT INTO "permissions" ("id", "code", "name", "created_at", "updated_at")
VALUES
    ('f0000000-0000-0000-0000-000000000001', 'member.invite', '邀请租户成员', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('f0000000-0000-0000-0000-000000000002', 'member.account.update', '修改租户成员账号', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('f0000000-0000-0000-0000-000000000003', 'member.credential.reset', '重置租户成员凭证', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "tenant_id", "role_id", "permission_id", "created_at")
SELECT
    md5(role."id"::text || permission."id"::text)::uuid,
    role."tenant_id",
    role."id",
    permission."id",
    CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission ON permission."code" IN ('member.invite', 'member.account.update', 'member.credential.reset')
WHERE role."code" = 'tenant_admin' AND role."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "role_id", "permission_id") DO NOTHING;
