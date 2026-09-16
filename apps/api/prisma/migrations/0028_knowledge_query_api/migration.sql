-- 知识库公开 Query API 前置结构：
-- 1) knowledge_bases 增加归属锚点 department_id / project_id（二选一，都为空即公司级知识库）；
-- 2) knowledge_base_members.permission 从 TEXT 收敛为数据库枚举，杜绝非法值入库；
-- 3) knowledge_query_logs 扩展知识库、grounded、延迟与 Token 用量字段（该表尚未有应用写入，加 NOT NULL 安全）。

-- 1. 知识库归属锚点
ALTER TABLE "knowledge_bases" ADD COLUMN "department_id" UUID;
ALTER TABLE "knowledge_bases" ADD COLUMN "project_id" UUID;

-- 2. 成员权限枚举
CREATE TYPE "KnowledgeBaseMemberPermission" AS ENUM ('READER', 'EDITOR', 'MANAGER');
ALTER TABLE "knowledge_base_members" ALTER COLUMN "permission" DROP DEFAULT;
ALTER TABLE "knowledge_base_members" ALTER COLUMN "permission" SET DATA TYPE "KnowledgeBaseMemberPermission"
    USING ("permission"::text::"KnowledgeBaseMemberPermission");

-- 3. 查询日志扩展字段
ALTER TABLE "knowledge_query_logs" ADD COLUMN "knowledge_base_id" UUID NOT NULL;
ALTER TABLE "knowledge_query_logs" ADD COLUMN "grounded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "knowledge_query_logs" ADD COLUMN "latency_ms" INTEGER;
ALTER TABLE "knowledge_query_logs" ADD COLUMN "input_tokens" INTEGER;
ALTER TABLE "knowledge_query_logs" ADD COLUMN "output_tokens" INTEGER;
ALTER TABLE "knowledge_query_logs" ADD COLUMN "total_tokens" INTEGER;

CREATE INDEX "knowledge_query_logs_tenant_id_knowledge_base_id_created_at_idx"
    ON "knowledge_query_logs"("tenant_id", "knowledge_base_id", "created_at");

-- 注释
COMMENT ON COLUMN knowledge_bases.department_id IS '归属部门；与 project_id 二选一，都为空即公司级知识库。';
COMMENT ON COLUMN knowledge_bases.project_id IS '归属项目；与 department_id 二选一，都为空即公司级知识库。';
COMMENT ON COLUMN knowledge_base_members.permission IS '成员权限：READER 可读可查询，EDITOR 可管理文档，MANAGER 可管理成员与知识库。';
COMMENT ON COLUMN knowledge_query_logs.knowledge_base_id IS '被查询的知识库 ID。';
COMMENT ON COLUMN knowledge_query_logs.grounded IS '答案是否被检索 chunk 引用支撑；false 表示证据不足拒答或答案无引用。';
COMMENT ON COLUMN knowledge_query_logs.latency_ms IS 'ai-service 问答生成耗时；空结果短路未调用模型时为 null。';
COMMENT ON COLUMN knowledge_query_logs.input_tokens IS '模型输入 Token 用量；未调用模型时为 null。';
COMMENT ON COLUMN knowledge_query_logs.output_tokens IS '模型输出 Token 用量；未调用模型时为 null。';
COMMENT ON COLUMN knowledge_query_logs.total_tokens IS '模型 Token 总用量；未调用模型时为 null。';
