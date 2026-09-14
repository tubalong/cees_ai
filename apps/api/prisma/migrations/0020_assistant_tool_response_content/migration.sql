-- 保存模型在 tool_calls 前输出的 assistant 正文，确保工具轮次历史可完整重建。
ALTER TABLE "tool_calls"
    ADD COLUMN "assistant_content" TEXT;

COMMENT ON COLUMN "tool_calls"."assistant_content" IS
    '同一模型调用提出工具调用前的 assistant 正文；仅首个 tool call 通常有值。';
