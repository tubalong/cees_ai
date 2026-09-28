-- M2 子执行：ToolCall 挂接任务步骤执行载体（轮次 / 任务步骤二选一），
-- 并为 AssistantTaskStep 增加步内工具调用序号原子分配列。

-- 1. 轮次载体改为可空：任务步骤内发起的工具调用不再关联 AssistantTurn。
ALTER TABLE "tool_calls" ALTER COLUMN "turn_id" DROP NOT NULL;

-- 2. 新增任务步骤载体列与外键（步骤删除时级联清理其调用记录）。
ALTER TABLE "tool_calls" ADD COLUMN "task_step_id" UUID;
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_task_step_id_fkey" FOREIGN KEY ("task_step_id") REFERENCES "assistant_task_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. 步骤载体的幂等唯一约束（轮次载体沿用既有 [turn_id, ...] 约束；
--    Postgres 唯一索引对 NULL 不冲突，两个载体互不干扰）。
CREATE UNIQUE INDEX "tool_calls_task_step_id_seq_key" ON "tool_calls"("task_step_id", "seq");
CREATE UNIQUE INDEX "tool_calls_task_step_id_model_step_upstream_call_id_key" ON "tool_calls"("task_step_id", "model_step", "upstream_call_id");

-- 4. AssistantTaskStep 步内工具调用序号（同 assistant_turns.next_tool_call_seq 模式）。
ALTER TABLE "assistant_task_steps" ADD COLUMN "next_tool_call_seq" INTEGER NOT NULL DEFAULT 1;
