-- 阶段 5/9 工具循环与图片生成：ToolCall 工具调用流水、ManagedImage 图片正式资源、
-- ResourceType.IMAGE / FilePurpose.GENERATED_IMAGE 枚举扩展，
-- 以及 AIActionDraft / AIInvocationLog 的 tool_call_id 工具执行幂等关联。
-- 注：DraftStatus 自 0001_init 起已含 EXECUTED / FAILED 等全部状态，无需扩展。

ALTER TYPE "ResourceType" ADD VALUE 'IMAGE';
ALTER TYPE "FilePurpose" ADD VALUE 'GENERATED_IMAGE';

CREATE TYPE "ToolCallStatus" AS ENUM ('APPROVED', 'EXECUTING', 'COMPLETED', 'FAILED', 'REJECTED');

-- 工具调用流水：批准结论、执行结果与正式资源引用；公开 tool_call / tool_result
-- 事件以本表 ID 为稳定标识，上游模型的调用 ID 存 upstream_call_id 供 ToolMessage 回填。
CREATE TABLE "tool_calls" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "upstream_call_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "status" "ToolCallStatus" NOT NULL DEFAULT 'APPROVED',
    "result" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "executed_resource_type" TEXT,
    "executed_resource_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tool_calls_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tool_calls_turn_id_seq_key"
    ON "tool_calls"("turn_id", "seq");

CREATE INDEX "tool_calls_tenant_id_created_at_idx"
    ON "tool_calls"("tenant_id", "created_at");

COMMENT ON TABLE "tool_calls" IS
    '模型提出的工具调用：批准结论、执行结果与正式资源引用；轮次内按 seq 递增。';
COMMENT ON COLUMN "tool_calls"."upstream_call_id" IS
    '上游模型返回的调用 ID；回填 ToolMessage.tool_call_id 时使用。';
COMMENT ON COLUMN "tool_calls"."status" IS
    '工具调用生命周期：APPROVED 批准通过、EXECUTING 执行中、COMPLETED 成功、FAILED 失败、REJECTED 批准拒绝。';

-- AI 图片生成结果挂到 Resource（IMAGE）上的受管图片，与 managed_documents 同模式；
-- 生成即写入正式文件，不做待确认交互。
CREATE TABLE "managed_images" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "file_object_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "size" TEXT,
    "content_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "managed_images_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "managed_images_tenant_id_created_at_idx"
    ON "managed_images"("tenant_id", "created_at");

COMMENT ON TABLE "managed_images" IS
    'AI 图片生成结果挂到 Resource（IMAGE）上的受管图片；provider / model / prompt 为生成快照。';

-- 外键：工具调用归属轮次；受管图片复用 Resource 主键并挂正式文件。
ALTER TABLE "tool_calls"
    ADD CONSTRAINT "tool_calls_turn_id_fkey"
    FOREIGN KEY ("turn_id") REFERENCES "assistant_turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "managed_images"
    ADD CONSTRAINT "managed_images_id_fkey"
    FOREIGN KEY ("id") REFERENCES "resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "managed_images"
    ADD CONSTRAINT "managed_images_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "managed_images"
    ADD CONSTRAINT "managed_images_file_object_id_fkey"
    FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 工具执行幂等：AI 工具直接执行的动作以 request_id + tool_call_id 去重。
ALTER TABLE "ai_action_drafts" ADD COLUMN "tool_call_id" UUID;
ALTER TABLE "ai_invocation_logs" ADD COLUMN "tool_call_id" UUID;

COMMENT ON COLUMN "ai_action_drafts"."tool_call_id" IS
    '关联的工具调用 ID；AI 工具直接执行的动作用 request_id + tool_call_id 做幂等。';
COMMENT ON COLUMN "ai_invocation_logs"."tool_call_id" IS
    '工具执行对应的 ToolCall ID；图片生成等工具调用填写，配合 request_id 做幂等。';
