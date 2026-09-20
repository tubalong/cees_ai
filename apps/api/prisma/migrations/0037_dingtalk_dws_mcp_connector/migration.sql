CREATE TYPE "DingTalkIntegrationMode" AS ENUM ('SELF_MANAGED_APP', 'DWS_LOCAL');
CREATE TYPE "DingTalkSyncSource" AS ENUM ('SELF_MANAGED_APP', 'DWS_MCP');
CREATE TYPE "DingTalkSyncScope" AS ENUM ('FULL_SCOPE', 'VISIBLE_SCOPE');

ALTER TABLE "dingtalk_integrations"
    ADD COLUMN "mode" "DingTalkIntegrationMode" NOT NULL DEFAULT 'SELF_MANAGED_APP',
    ADD COLUMN "authorized_by_membership_id" UUID,
    ADD COLUMN "authorized_external_user_id" TEXT,
    ADD COLUMN "authorized_profile" TEXT,
    ADD COLUMN "granted_capabilities" JSONB,
    ALTER COLUMN "corp_id" DROP NOT NULL,
    ALTER COLUMN "app_key" DROP NOT NULL,
    ALTER COLUMN "app_secret_ciphertext" DROP NOT NULL;

DROP INDEX IF EXISTS "dingtalk_integrations_corp_id_key";
CREATE INDEX "dingtalk_integrations_corp_id_idx" ON "dingtalk_integrations"("corp_id");

ALTER TABLE "dingtalk_sync_jobs"
    ADD COLUMN "source" "DingTalkSyncSource" NOT NULL DEFAULT 'SELF_MANAGED_APP',
    ADD COLUMN "scope" "DingTalkSyncScope" NOT NULL DEFAULT 'FULL_SCOPE',
    ADD COLUMN "authorized_by_membership_id" UUID,
    ADD COLUMN "authorized_external_user_id" TEXT;

COMMENT ON COLUMN "dingtalk_integrations"."mode" IS '钉钉连接模式：企业应用凭证或本地 DWS/MCP';
COMMENT ON COLUMN "dingtalk_integrations"."authorized_by_membership_id" IS '最近一次 DWS/MCP 授权的 CEES 成员 UUID';
COMMENT ON COLUMN "dingtalk_integrations"."authorized_external_user_id" IS '最近一次 DWS/MCP 授权的钉钉用户 ID';
COMMENT ON COLUMN "dingtalk_integrations"."authorized_profile" IS '最近一次 DWS/MCP 授权的组织 profile';
COMMENT ON COLUMN "dingtalk_integrations"."granted_capabilities" IS '最近一次 DWS/MCP 授权返回的能力列表';
COMMENT ON COLUMN "dingtalk_sync_jobs"."source" IS '组织同步数据来源';
COMMENT ON COLUMN "dingtalk_sync_jobs"."scope" IS '组织同步数据范围；VISIBLE_SCOPE 不会将未返回数据标记删除';
COMMENT ON COLUMN "dingtalk_sync_jobs"."authorized_by_membership_id" IS '发起外部数据授权的 CEES 成员 UUID';
COMMENT ON COLUMN "dingtalk_sync_jobs"."authorized_external_user_id" IS '发起外部数据授权的钉钉用户 ID';
