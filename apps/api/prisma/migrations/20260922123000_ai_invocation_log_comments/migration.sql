-- 修正 ai_invocation_logs 的表级与会话/轮次字段 PostgreSQL 注释：
-- /chat/* 无状态代理时代记录客户端本地标识；/conversations/* 服务端会话架构落地后，
-- 这两列实际保存服务端 conversations 与 assistant_turns 的标识。仅更新注释，不改列结构。
COMMENT ON TABLE "ai_invocation_logs" IS
    'NestJS 编排 AI 调用时记录的模型执行与 Token 指标；可关联租户成员、服务端会话和轮次，但不保存消息正文或摘要。';
COMMENT ON COLUMN "ai_invocation_logs"."conversation_id" IS
    '服务端会话标识（conversations 表）；仅 Chat/ToolTurn 类调用填写，不建外键以保留历史快照。';
COMMENT ON COLUMN "ai_invocation_logs"."turn_id" IS
    '服务端轮次标识（assistant_turns 表）；同一轮内的压缩与多次模型调用共享该值。';
