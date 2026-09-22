-- 写操作确认机制（块：AI 助手业务写操作）：
--   1) ToolCallStatus 新增 AWAITING_CONFIRMATION——写工具通过程序化批准后不再直接执行，
--      而是把参数与预览落为草稿，等待用户在同一会话内确认；该状态下副作用尚未发生。
--   2) 新增 assistant_action_drafts 作为「待确认草稿」的唯一事实源，与 AIActionDraft
--      （已执行动作流水，见 assistant-tool-loop.md 第 14 节）语义分离。
-- 本迁移只声明枚举值、不写入该值，因此可与 ALTER TYPE 同事务执行。

-- AlterEnum
ALTER TYPE "ToolCallStatus" ADD VALUE 'AWAITING_CONFIRMATION';

-- CreateTable
CREATE TABLE "assistant_action_drafts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "request_id" TEXT NOT NULL,
    "tool_call_id" UUID NOT NULL,
    "tool_name" TEXT NOT NULL,
    "tool_version" TEXT NOT NULL,
    "risk_level" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" UUID,
    "result_summary" TEXT,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "assistant_action_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_action_drafts_tool_call_id_key" ON "assistant_action_drafts"("tool_call_id");

-- CreateIndex
CREATE INDEX "assistant_action_drafts_tenant_id_conversation_id_status_idx" ON "assistant_action_drafts"("tenant_id", "conversation_id", "status");

-- CreateIndex
CREATE INDEX "assistant_action_drafts_status_expires_at_idx" ON "assistant_action_drafts"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "assistant_action_drafts" ADD CONSTRAINT "assistant_action_drafts_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "assistant_turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_action_drafts" ADD CONSTRAINT "assistant_action_drafts_tool_call_id_fkey" FOREIGN KEY ("tool_call_id") REFERENCES "tool_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON TABLE "assistant_action_drafts" IS 'AI 写操作的待确认草稿：用户确认前不产生业务副作用；arguments 为确认时唯一信任的参数快照';
COMMENT ON COLUMN "assistant_action_drafts"."status" IS 'PENDING_CONFIRMATION → CONFIRMED → EXECUTED / FAILED；用户取消为 REJECTED；超时后不可确认';
