-- Assistant Tool Loop 持久化状态机、多模态消息引用与外部副作用幂等收束。
-- 会话事实只保存稳定 file/resource ID；COS 签名 URL 仅在读取或模型调用前临时生成。

CREATE TYPE "AssistantTurnStage" AS ENUM (
    'QUEUED',
    'MODEL_CALL',
    'TOOL_EXECUTION',
    'FINALIZING'
);

CREATE TYPE "ManagedImageStatus" AS ENUM (
    'PENDING',
    'GENERATING',
    'UPLOADING',
    'READY',
    'FAILED',
    'ORPHANED'
);

-- 0014 的状态枚举缺少“模型已提议”和“不确定副作用待恢复”两个状态。
-- 重建枚举可避免在同一事务中新增枚举值后立即使用新值的 PostgreSQL 限制。
ALTER TABLE "tool_calls" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "ToolCallStatus" RENAME TO "ToolCallStatus_legacy";
CREATE TYPE "ToolCallStatus" AS ENUM (
    'PROPOSED',
    'APPROVED',
    'EXECUTING',
    'COMPLETED',
    'FAILED',
    'REJECTED',
    'RECOVERY_REQUIRED'
);
ALTER TABLE "tool_calls"
    ALTER COLUMN "status" TYPE "ToolCallStatus"
    USING ("status"::text::"ToolCallStatus");
DROP TYPE "ToolCallStatus_legacy";
ALTER TABLE "tool_calls" ALTER COLUMN "status" SET DEFAULT 'PROPOSED';

ALTER TABLE "conversations"
    ADD COLUMN "next_turn_seq" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "conversation_messages"
    ADD COLUMN "image_file_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "assistant_turns"
    ADD COLUMN "stage" "AssistantTurnStage" NOT NULL DEFAULT 'QUEUED',
    ADD COLUMN "user_id" UUID NOT NULL,
    ADD COLUMN "membership_id" UUID NOT NULL,
    ADD COLUMN "request_id" TEXT NOT NULL,
    ADD COLUMN "next_event_seq" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "next_tool_call_seq" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "execution_owner" TEXT,
    ADD COLUMN "lease_expires_at" TIMESTAMP(3),
    ADD COLUMN "heartbeat_at" TIMESTAMP(3),
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "assistant_turns" ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "tool_calls"
    ADD COLUMN "model_step" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "approved_at" TIMESTAMP(3),
    ADD COLUMN "started_at" TIMESTAMP(3),
    ADD COLUMN "completed_at" TIMESTAMP(3),
    ADD COLUMN "execution_token" UUID,
    ADD COLUMN "lease_expires_at" TIMESTAMP(3);

ALTER TABLE "managed_documents"
    ADD COLUMN "generated_by_tool_call_id" UUID;

ALTER TABLE "managed_images"
    ADD COLUMN "tool_call_id" UUID NOT NULL,
    ADD COLUMN "status" "ManagedImageStatus" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "object_key" TEXT NOT NULL,
    ADD COLUMN "failure_code" TEXT,
    ADD COLUMN "failure_message" TEXT,
    ADD COLUMN "ready_at" TIMESTAMP(3),
    ALTER COLUMN "file_object_id" DROP NOT NULL,
    ALTER COLUMN "provider" DROP NOT NULL,
    ALTER COLUMN "model" DROP NOT NULL,
    ALTER COLUMN "content_type" DROP NOT NULL;

DROP INDEX "managed_images_tenant_id_created_at_idx";

CREATE UNIQUE INDEX "conversation_messages_tool_call_id_key"
    ON "conversation_messages"("tool_call_id");
CREATE UNIQUE INDEX "managed_documents_generated_by_tool_call_id_key"
    ON "managed_documents"("generated_by_tool_call_id");
CREATE UNIQUE INDEX "managed_images_tool_call_id_key"
    ON "managed_images"("tool_call_id");
CREATE UNIQUE INDEX "managed_images_file_object_id_key"
    ON "managed_images"("file_object_id");
CREATE UNIQUE INDEX "managed_images_tenant_id_object_key_key"
    ON "managed_images"("tenant_id", "object_key");
CREATE INDEX "managed_images_tenant_id_status_created_at_idx"
    ON "managed_images"("tenant_id", "status", "created_at");
CREATE UNIQUE INDEX "tool_calls_turn_id_model_step_upstream_call_id_key"
    ON "tool_calls"("turn_id", "model_step", "upstream_call_id");
CREATE INDEX "tool_calls_status_lease_expires_at_idx"
    ON "tool_calls"("status", "lease_expires_at");
CREATE INDEX "assistant_turns_status_lease_expires_at_idx"
    ON "assistant_turns"("status", "lease_expires_at");
CREATE UNIQUE INDEX "ai_action_drafts_tool_call_id_key"
    ON "ai_action_drafts"("tool_call_id");

ALTER TABLE "conversation_messages"
    ADD CONSTRAINT "conversation_messages_tool_call_id_fkey"
    FOREIGN KEY ("tool_call_id") REFERENCES "tool_calls"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "managed_documents"
    ADD CONSTRAINT "managed_documents_generated_by_tool_call_id_fkey"
    FOREIGN KEY ("generated_by_tool_call_id") REFERENCES "tool_calls"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "managed_images"
    ADD CONSTRAINT "managed_images_tool_call_id_fkey"
    FOREIGN KEY ("tool_call_id") REFERENCES "tool_calls"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_action_drafts"
    ADD CONSTRAINT "ai_action_drafts_tool_call_id_fkey"
    FOREIGN KEY ("tool_call_id") REFERENCES "tool_calls"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_invocation_logs"
    ADD CONSTRAINT "ai_invocation_logs_tool_call_id_fkey"
    FOREIGN KEY ("tool_call_id") REFERENCES "tool_calls"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 权限目录和租户管理员默认授权必须随迁移落库，不能只依赖开发环境 seed。
INSERT INTO "permissions" ("id", "code", "name", "created_at", "updated_at")
VALUES
    (gen_random_uuid(), 'image.read', '查看图片', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'ai.image.generate', '调用 AI 生成图片', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'ai.document.generate', '调用 AI 生成文档', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name", "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "tenant_id", "role_id", "permission_id", "created_at")
SELECT
    gen_random_uuid(),
    role."tenant_id",
    role."id",
    permission."id",
    CURRENT_TIMESTAMP
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."code" = 'tenant_admin'
  AND role."is_system" = true
  AND role."deleted_at" IS NULL
  AND permission."code" IN ('image.read', 'ai.image.generate', 'ai.document.generate')
ON CONFLICT ("tenant_id", "role_id", "permission_id") DO NOTHING;

COMMENT ON COLUMN "conversation_messages"."image_file_ids" IS
    'Assistant 消息引用的稳定 FileObject ID；签名 URL 不持久化。';
COMMENT ON COLUMN "assistant_turns"."stage" IS
    '轮次执行检查点，用于租约心跳、故障判断和保守恢复。';
COMMENT ON COLUMN "managed_images"."object_key" IS
    '由 tenantId 与 toolCallId 生成的确定性 COS 对象键。';
COMMENT ON COLUMN "tool_calls"."execution_token" IS
    'EXECUTING 状态的执行权令牌，阻止失去租约的旧执行者提交结果。';
