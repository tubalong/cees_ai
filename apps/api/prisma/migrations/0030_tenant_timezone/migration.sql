-- 租户时区：用于业务日界线（工作台“今日/明日”、日报提醒所属日期）和项目编码年份。
-- 存量租户由默认值回填；本次不提供配置界面，只能通过 PATCH /tenants/current 修改。
ALTER TABLE "tenants"
    ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai';

COMMENT ON COLUMN "tenants"."timezone" IS '租户时区，IANA 标识（例如 Asia/Shanghai）；用于业务日界线与项目编码年份';
