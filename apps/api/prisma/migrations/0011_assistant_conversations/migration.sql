-- 服务端权威 AI 会话：Conversation、ConversationMessage、ConversationSummary、
-- AssistantTurn 与 AssistantEvent。会话事实源从客户端本地迁移到 PostgreSQL，
-- 断线重连通过 (turn_id, seq) 重放事件；本迁移不改变既有 ai_invocation_logs 语义。

CREATE TYPE "ConversationVisibility" AS ENUM ('PRIVATE');
CREATE TYPE "ConversationMessageRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL');
CREATE TYPE "AssistantTurnStatus" AS ENUM ('RECEIVED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "AssistantEventType" AS ENUM ('STARTED', 'STATUS', 'CONTENT_DELTA', 'TOOL_CALL', 'TOOL_RESULT', 'USAGE', 'COMPLETED', 'ERROR');

-- 会话表：按租户与所属成员索引，列表按 updated_at 倒序分页。
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "owner_membership_id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "visibility" "ConversationVisibility" NOT NULL DEFAULT 'PRIVATE',
    "last_turn_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversations_tenant_id_owner_membership_id_updated_at_idx"
    ON "conversations"("tenant_id", "owner_membership_id", "updated_at");

COMMENT ON TABLE "conversations" IS
    '服务端权威 AI 会话；当前仅支持成员私有可见，visibility 为后续共享能力预留。';
COMMENT ON COLUMN "conversations"."owner_membership_id" IS
    '会话所属租户成员 UUID；会话正文仅该成员可访问。';
COMMENT ON COLUMN "conversations"."title" IS
    '会话标题；未显式提供时在首轮完成后按首条消息自动生成。';

-- 会话消息表：USER/ASSISTANT 为对话正文，TOOL 为工具结果（工具阶段启用）。
CREATE TABLE "conversation_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID,
    "role" "ConversationMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "tool_call_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversation_messages_tenant_id_conversation_id_created_at_idx"
    ON "conversation_messages"("tenant_id", "conversation_id", "created_at");

CREATE INDEX "conversation_messages_turn_id_idx"
    ON "conversation_messages"("turn_id");

-- 会话摘要表：Turn 编排在消息量超阈值时自动压缩生成。
CREATE TABLE "conversation_summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "summarized_through_message_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_summaries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversation_summaries_tenant_id_conversation_id_created_at_idx"
    ON "conversation_summaries"("tenant_id", "conversation_id", "created_at");

-- 轮次表：幂等键按会话去重，request_hash 防止同键不同内容重放。
CREATE TABLE "assistant_turns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "AssistantTurnStatus" NOT NULL DEFAULT 'RECEIVED',
    "mode" TEXT NOT NULL DEFAULT 'standard',
    "error" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "assistant_turns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assistant_turns_conversation_id_idempotency_key_key"
    ON "assistant_turns"("conversation_id", "idempotency_key");

CREATE UNIQUE INDEX "assistant_turns_conversation_id_seq_key"
    ON "assistant_turns"("conversation_id", "seq");

CREATE INDEX "assistant_turns_tenant_id_created_at_idx"
    ON "assistant_turns"("tenant_id", "created_at");

COMMENT ON TABLE "assistant_turns" IS
    '一轮完整 Assistant 运行；状态机由 NestJS TurnRunner 驱动，模型只产出建议。';
COMMENT ON COLUMN "assistant_turns"."seq" IS
    '会话内递增的轮次序号，从 1 开始。';
COMMENT ON COLUMN "assistant_turns"."idempotency_key" IS
    '客户端生成的幂等键；同一会话内同键重复提交返回原轮次。';
COMMENT ON COLUMN "assistant_turns"."request_hash" IS
    '幂等键对应的请求内容哈希，重复提交同键不同内容时返回 409。';

-- 事件表：断线重连按 (turn_id, seq) 重放。
CREATE TABLE "assistant_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" "AssistantEventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assistant_events_turn_id_seq_key"
    ON "assistant_events"("turn_id", "seq");

COMMENT ON TABLE "assistant_events" IS
    '带递增序号的轮次事件；payload 为公开 TurnStreamEvent JSON，支持断线重连重放。';

-- 外键：消息/摘要/轮次归属于会话；消息可关联轮次；事件归属于轮次。
ALTER TABLE "conversation_messages"
    ADD CONSTRAINT "conversation_messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "conversation_messages"
    ADD CONSTRAINT "conversation_messages_turn_id_fkey"
    FOREIGN KEY ("turn_id") REFERENCES "assistant_turns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "conversation_summaries"
    ADD CONSTRAINT "conversation_summaries_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assistant_turns"
    ADD CONSTRAINT "assistant_turns_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assistant_events"
    ADD CONSTRAINT "assistant_events_turn_id_fkey"
    FOREIGN KEY ("turn_id") REFERENCES "assistant_turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
