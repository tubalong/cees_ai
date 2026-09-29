-- 审计保留策略（分级保留 + 过期归档）：
--  1) 连接器只读逐条审计（resource_type = 'CONNECTOR'、action = 'CONNECTOR_READ_OPERATION'、
--     metadata.aggregated = false）量级最高而追溯价值最低，超过保留期（默认 90 天）物理删除；
--  2) 其余租户审计（含连接器写/破坏性调用与业务审计）超过保留期（默认 1095 天）迁移到
--     audit_logs_archive：事实保留，但不再占用 audit_logs 热表与公开查询接口；
--  3) platform_audit_logs 永久保留，不参与删除或归档。
-- 执行入口是 BackgroundJobsService 的 Redis 锁内任务，批大小与保留期由环境变量配置。
-- 两个新增索引支撑跨租户扫描：audit_logs(created_at, id) 供归档扫描，audit_logs(action, created_at) 供只读逐条清理。

-- CreateTable
CREATE TABLE "audit_logs_archive" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_membership_id" UUID,
    "action" TEXT NOT NULL,
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID,
    "request_id" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_archive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_archive_tenant_id_created_at_idx" ON "audit_logs_archive"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_id_idx" ON "audit_logs"("created_at", "id");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

COMMENT ON TABLE "audit_logs_archive" IS '租户审计归档表：audit_logs 中超过保留期的行迁移至此，字段与 audit_logs 一致；公开查询接口不返回归档数据。';
COMMENT ON COLUMN "audit_logs_archive"."id" IS '审计 UUID，与原行一致';
COMMENT ON COLUMN "audit_logs_archive"."tenant_id" IS '所属租户';
COMMENT ON COLUMN "audit_logs_archive"."actor_user_id" IS '操作者全局 User UUID';
COMMENT ON COLUMN "audit_logs_archive"."actor_membership_id" IS '操作者 Membership UUID';
COMMENT ON COLUMN "audit_logs_archive"."action" IS '操作动作编码';
COMMENT ON COLUMN "audit_logs_archive"."outcome" IS 'SUCCESS 或 FAILURE';
COMMENT ON COLUMN "audit_logs_archive"."resource_type" IS '操作资源类型';
COMMENT ON COLUMN "audit_logs_archive"."resource_id" IS '操作资源 UUID，可空';
COMMENT ON COLUMN "audit_logs_archive"."request_id" IS 'HTTP 请求追踪 ID';
COMMENT ON COLUMN "audit_logs_archive"."ip_address" IS '客户端 IP';
COMMENT ON COLUMN "audit_logs_archive"."user_agent" IS '客户端 User-Agent';
COMMENT ON COLUMN "audit_logs_archive"."metadata" IS '操作前后值、原因等扩展 JSON';
COMMENT ON COLUMN "audit_logs_archive"."created_at" IS '审计发生时间，与原行一致';
COMMENT ON COLUMN "audit_logs_archive"."archived_at" IS '归档时间；归档后不再参与热表查询与分级清理';