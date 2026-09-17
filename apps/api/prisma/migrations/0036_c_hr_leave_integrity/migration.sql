-- 请假额度按租户本地年度拆分占用，修复跨年度申请只扣开始年度余额的问题。
ALTER TABLE "hr_leave_requests" ADD COLUMN "year_allocations" JSONB;

COMMENT ON COLUMN "hr_leave_requests"."year_allocations" IS '按租户本地年度拆分的额度占用明细，格式 [{year, days}]；为空表示按开始年度单年占用';
COMMENT ON COLUMN "hr_leave_requests"."duration_days" IS '服务端按申请时间与假期单位折算后的额度数量，不再采信客户端传值';
