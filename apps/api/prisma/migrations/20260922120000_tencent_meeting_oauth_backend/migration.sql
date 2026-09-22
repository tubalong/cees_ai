CREATE TYPE "TencentMeetingConnectionState" AS ENUM ('AUTHORIZING', 'READY', 'ERROR');
CREATE TYPE "TencentMeetingTokenStatus" AS ENUM ('VALID', 'EXPIRING', 'REFRESH_FAILED', 'REVOKED');

CREATE TABLE "tencent_meeting_connections" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "access_token_ciphertext" TEXT,
  "refresh_token_ciphertext" TEXT,
  "access_token_expires_at" TIMESTAMP(3),
  "refresh_token_expires_at" TIMESTAMP(3),
  "external_user_id" TEXT,
  "display_name" TEXT,
  "organization_id" TEXT,
  "organization_name" TEXT,
  "granted_scopes" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "state" "TencentMeetingConnectionState" NOT NULL DEFAULT 'AUTHORIZING',
  "token_status" "TencentMeetingTokenStatus",
  "authorized_at" TIMESTAMP(3),
  "last_verified_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "last_error_message" TEXT,
  "refresh_lease_id" UUID,
  "refresh_lease_expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "tencent_meeting_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tencent_meeting_oauth_states" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "state_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "failure_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tencent_meeting_oauth_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tencent_meeting_connections_membership_id_key" ON "tencent_meeting_connections"("membership_id");
CREATE UNIQUE INDEX "tencent_meeting_connections_tenant_id_membership_id_key" ON "tencent_meeting_connections"("tenant_id", "membership_id");
CREATE INDEX "tencent_meeting_connections_tenant_id_state_idx" ON "tencent_meeting_connections"("tenant_id", "state");
CREATE INDEX "tencent_meeting_connections_refresh_lease_expires_at_idx" ON "tencent_meeting_connections"("refresh_lease_expires_at");
CREATE UNIQUE INDEX "tencent_meeting_oauth_states_state_hash_key" ON "tencent_meeting_oauth_states"("state_hash");
CREATE INDEX "tencent_meeting_oauth_states_tenant_id_membership_id_expire_idx" ON "tencent_meeting_oauth_states"("tenant_id", "membership_id", "expires_at");
CREATE INDEX "tencent_meeting_oauth_states_expires_at_consumed_at_idx" ON "tencent_meeting_oauth_states"("expires_at", "consumed_at");

ALTER TABLE "tencent_meeting_connections" ADD CONSTRAINT "tencent_meeting_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tencent_meeting_connections" ADD CONSTRAINT "tencent_meeting_connections_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tencent_meeting_oauth_states" ADD CONSTRAINT "tencent_meeting_oauth_states_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tencent_meeting_oauth_states" ADD CONSTRAINT "tencent_meeting_oauth_states_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON TABLE "tencent_meeting_connections" IS '腾讯会议成员级 OAuth 连接，第三方 Token 仅以服务端密文保存';
COMMENT ON TABLE "tencent_meeting_oauth_states" IS '腾讯会议 OAuth 一次性 State，仅保存 SHA-256 摘要';
