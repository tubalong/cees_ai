-- 在现有 AI 调用指标表上增加可选的租户成员、客户端会话和轮次维度。
-- 旧日志与非 Chat 调用无需回填；本迁移不保存任何消息正文或摘要。
ALTER TABLE "ai_invocation_logs"
    ADD COLUMN "membership_id" UUID,
    ADD COLUMN "conversation_id" TEXT,
    ADD COLUMN "turn_id" TEXT;

-- 支持按企业、成员和时间范围统计模型用量。
CREATE INDEX "ai_invocation_logs_tenant_created_at_idx"
    ON "ai_invocation_logs"("tenant_id", "created_at");

CREATE INDEX "ai_invocation_logs_member_created_at_idx"
    ON "ai_invocation_logs"("tenant_id", "membership_id", "created_at");

-- 支持查看某企业成员在指定本地会话、轮次中的全部调用。
-- 同一轮可能同时包含 chat.compact 与 chat.invoke/chat.stream，统计时应求和而不是去重。
CREATE INDEX "ai_invocation_logs_chat_turn_idx"
    ON "ai_invocation_logs"("tenant_id", "membership_id", "conversation_id", "turn_id");

COMMENT ON TABLE "ai_invocation_logs" IS
    'NestJS 编排 AI 调用时记录的模型执行与 Token 指标；可关联租户成员、本地会话和轮次，但不保存消息正文或摘要。';
COMMENT ON COLUMN "ai_invocation_logs"."membership_id" IS
    '发起调用时的 TenantMembership UUID 快照；旧日志和非成员调用可为空，不建立级联外键。';
COMMENT ON COLUMN "ai_invocation_logs"."conversation_id" IS
    '客户端本地会话标识；只用于调用关联和统计，不代表服务端 Conversation 实体。';
COMMENT ON COLUMN "ai_invocation_logs"."turn_id" IS
    '客户端本地轮次标识；同一轮的压缩与回答调用共享该值并按实际 Token 求和。';
