-- 连接器读操作审计开关：租户级配置，默认 false（只读调用按轮次级聚合成一条审计）。
-- 写/破坏性调用始终逐条审计，不受该开关影响；开关本身只能通过 PATCH /tenants/current 修改（tenant.update）。
-- 存量租户由默认值回填，无需数据迁移。
ALTER TABLE "tenants"
    ADD COLUMN "connector_read_audit_enabled" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "tenants"."connector_read_audit_enabled" IS '连接器读操作是否逐条审计；false 表示读调用按轮次级聚合成一条审计，写/破坏性调用始终逐条审计';
