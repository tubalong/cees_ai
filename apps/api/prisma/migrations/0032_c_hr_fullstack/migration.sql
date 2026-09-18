-- CreateEnum
CREATE TYPE "HrProfileStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'TERMINATED', 'ON_LEAVE');

-- CreateEnum
CREATE TYPE "HrLeaveUnit" AS ENUM ('DAY', 'HALF_DAY', 'HOUR');

-- CreateEnum
CREATE TYPE "HrLeaveRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HrAttendanceStatus" AS ENUM ('NORMAL', 'LATE', 'EARLY_LEAVE', 'ABSENT', 'LEAVE', 'OVERTIME', 'EXCEPTION', 'CORRECTED');

-- CreateEnum
CREATE TYPE "HrAttendanceSource" AS ENUM ('MANUAL', 'IMPORT', 'DINGTALK');

-- CreateEnum
CREATE TYPE "HrOvertimeRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HrEmployeeChangeType" AS ENUM ('ONBOARD', 'PROBATION', 'TRANSFER', 'PROMOTION', 'DEMOTION', 'RESIGNATION', 'TERMINATION');

-- CreateEnum
CREATE TYPE "HrEmployeeChangeStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'EFFECTIVE');

-- CreateTable
CREATE TABLE "hr_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "employee_no" TEXT,
    "display_name" TEXT NOT NULL,
    "department_id" UUID,
    "position" TEXT,
    "employment_type" TEXT,
    "manager_membership_id" UUID,
    "entry_date" DATE,
    "leave_date" DATE,
    "status" "HrProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "phone" TEXT,
    "email" TEXT,
    "id_type" TEXT,
    "id_number" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "education_level" TEXT,
    "cost_center" TEXT,
    "job_level" TEXT,
    "probation_end_date" DATE,
    "regular_date" DATE,
    "work_location" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hr_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_leave_types" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "HrLeaveUnit" NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "default_days" DECIMAL(10,2),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hr_leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_leave_balances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "total_days" DECIMAL(10,2) NOT NULL,
    "used_days" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pending_days" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "remaining_days" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "unit" "HrLeaveUnit" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hr_leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_leave_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "duration_days" DECIMAL(10,2) NOT NULL,
    "reason" TEXT,
    "status" "HrLeaveRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hr_leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_attendance_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "check_in_at" TIMESTAMP(3),
    "check_out_at" TIMESTAMP(3),
    "status" "HrAttendanceStatus" NOT NULL DEFAULT 'NORMAL',
    "source" "HrAttendanceSource" NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hr_attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_overtime_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "duration_hours" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "HrOvertimeRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hr_overtime_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employee_changes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "type" "HrEmployeeChangeType" NOT NULL,
    "effective_date" DATE NOT NULL,
    "from_department_id" UUID,
    "to_department_id" UUID,
    "from_position" TEXT,
    "to_position" TEXT,
    "from_manager_membership_id" UUID,
    "to_manager_membership_id" UUID,
    "reason" TEXT,
    "status" "HrEmployeeChangeStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hr_employee_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hr_profiles_membership_id_key" ON "hr_profiles"("membership_id");

CREATE UNIQUE INDEX "hr_profiles_tenant_id_employee_no_key" ON "hr_profiles"("tenant_id", "employee_no") WHERE "deleted_at" IS NULL AND "employee_no" IS NOT NULL;

-- CreateIndex
CREATE INDEX "hr_profiles_tenant_id_department_id_idx" ON "hr_profiles"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "hr_profiles_tenant_id_status_idx" ON "hr_profiles"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "hr_profiles_tenant_id_manager_membership_id_idx" ON "hr_profiles"("tenant_id", "manager_membership_id");

-- CreateIndex
CREATE INDEX "hr_leave_types_tenant_id_enabled_idx" ON "hr_leave_types"("tenant_id", "enabled");

CREATE UNIQUE INDEX "hr_leave_types_tenant_id_code_key" ON "hr_leave_types"("tenant_id", "code") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "hr_leave_balances_tenant_id_membership_id_year_idx" ON "hr_leave_balances"("tenant_id", "membership_id", "year");

-- CreateIndex
CREATE INDEX "hr_leave_balances_tenant_id_leave_type_id_year_idx" ON "hr_leave_balances"("tenant_id", "leave_type_id", "year");

CREATE UNIQUE INDEX "hr_leave_balances_tenant_membership_type_year_key" ON "hr_leave_balances"("tenant_id", "membership_id", "leave_type_id", "year") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "hr_leave_requests_tenant_id_membership_id_status_idx" ON "hr_leave_requests"("tenant_id", "membership_id", "status");

-- CreateIndex
CREATE INDEX "hr_leave_requests_tenant_id_leave_type_id_idx" ON "hr_leave_requests"("tenant_id", "leave_type_id");

-- CreateIndex
CREATE INDEX "hr_leave_requests_tenant_id_start_at_end_at_idx" ON "hr_leave_requests"("tenant_id", "start_at", "end_at");

-- CreateIndex
CREATE INDEX "hr_attendance_records_tenant_id_membership_id_work_date_idx" ON "hr_attendance_records"("tenant_id", "membership_id", "work_date");

CREATE UNIQUE INDEX "hr_attendance_records_tenant_membership_work_date_key" ON "hr_attendance_records"("tenant_id", "membership_id", "work_date") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "hr_attendance_records_tenant_id_work_date_idx" ON "hr_attendance_records"("tenant_id", "work_date");

-- CreateIndex
CREATE INDEX "hr_attendance_records_tenant_id_status_idx" ON "hr_attendance_records"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "hr_overtime_requests_tenant_id_membership_id_status_idx" ON "hr_overtime_requests"("tenant_id", "membership_id", "status");

-- CreateIndex
CREATE INDEX "hr_overtime_requests_tenant_id_start_at_end_at_idx" ON "hr_overtime_requests"("tenant_id", "start_at", "end_at");

-- CreateIndex
CREATE INDEX "hr_employee_changes_tenant_id_membership_id_type_status_idx" ON "hr_employee_changes"("tenant_id", "membership_id", "type", "status");

-- CreateIndex
CREATE INDEX "hr_employee_changes_tenant_id_effective_date_idx" ON "hr_employee_changes"("tenant_id", "effective_date");

-- AddForeignKey
ALTER TABLE "hr_profiles" ADD CONSTRAINT "hr_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_profiles" ADD CONSTRAINT "hr_profiles_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_types" ADD CONSTRAINT "hr_leave_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_balances" ADD CONSTRAINT "hr_leave_balances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_balances" ADD CONSTRAINT "hr_leave_balances_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_balances" ADD CONSTRAINT "hr_leave_balances_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "hr_leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "hr_leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance_records" ADD CONSTRAINT "hr_attendance_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance_records" ADD CONSTRAINT "hr_attendance_records_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_overtime_requests" ADD CONSTRAINT "hr_overtime_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_overtime_requests" ADD CONSTRAINT "hr_overtime_requests_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_changes" ADD CONSTRAINT "hr_employee_changes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_changes" ADD CONSTRAINT "hr_employee_changes_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Register the HR capability permissions and grant them to existing tenant administrators.
INSERT INTO permissions (id, code, name, created_at, updated_at) VALUES
    (gen_random_uuid(), 'hr.attendance.read', '查看考勤记录', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'hr.attendance.manage', '管理考勤记录', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'hr.attendance.approve', '复核考勤异常', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'hr.overtime.read', '查看加班申请', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'hr.overtime.request', '发起加班申请', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'hr.overtime.approve', '审批加班申请', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'hr.employee_change.read', '查看人事异动', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'hr.employee_change.manage', '管理人事异动', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'hr.employee_change.approve', '审批人事异动', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'hr.report.read', '查看人力资源报表', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = CURRENT_TIMESTAMP;

INSERT INTO role_permissions (id, tenant_id, role_id, permission_id, created_at)
SELECT gen_random_uuid(), role.tenant_id, role.id, permission.id, CURRENT_TIMESTAMP
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.code = 'tenant_admin'
  AND role.deleted_at IS NULL
  AND permission.code IN (
    'hr.attendance.read',
    'hr.attendance.manage',
    'hr.attendance.approve',
    'hr.overtime.read',
    'hr.overtime.request',
    'hr.overtime.approve',
    'hr.employee_change.read',
    'hr.employee_change.manage',
    'hr.employee_change.approve',
    'hr.report.read'
  )
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

COMMENT ON TABLE "hr_profiles" IS '租户员工扩展档案，一名租户成员最多一份档案';
COMMENT ON TABLE "hr_leave_types" IS '租户请假类型配置';
COMMENT ON TABLE "hr_leave_balances" IS '成员按年度和假期类型维护的余额';
COMMENT ON TABLE "hr_leave_requests" IS '请假申请及审批状态';
COMMENT ON TABLE "hr_attendance_records" IS '成员每日考勤记录；钉钉同步当前暂停但保留来源枚举';
COMMENT ON TABLE "hr_overtime_requests" IS '成员加班申请及审批状态';
COMMENT ON TABLE "hr_employee_changes" IS '入职、转岗、晋升、离职等人事异动记录';
COMMENT ON COLUMN "hr_profiles"."tenant_id" IS '所属租户';
COMMENT ON COLUMN "hr_profiles"."membership_id" IS '对应的租户成员，一对一';
COMMENT ON COLUMN "hr_profiles"."employee_no" IS '租户内活跃员工工号';
COMMENT ON COLUMN "hr_profiles"."display_name" IS '建档时的员工显示名快照';
COMMENT ON COLUMN "hr_profiles"."department_id" IS '员工档案部门快照';
COMMENT ON COLUMN "hr_profiles"."position" IS '岗位名称';
COMMENT ON COLUMN "hr_profiles"."employment_type" IS '用工类型';
COMMENT ON COLUMN "hr_profiles"."manager_membership_id" IS '直属上级成员 ID';
COMMENT ON COLUMN "hr_profiles"."entry_date" IS '入职日期';
COMMENT ON COLUMN "hr_profiles"."leave_date" IS '离职日期';
COMMENT ON COLUMN "hr_profiles"."status" IS '员工档案状态';
COMMENT ON COLUMN "hr_profiles"."phone" IS '联系电话';
COMMENT ON COLUMN "hr_profiles"."email" IS '工作或个人邮箱';
COMMENT ON COLUMN "hr_profiles"."id_type" IS '证件类型';
COMMENT ON COLUMN "hr_profiles"."id_number" IS '证件号码';
COMMENT ON COLUMN "hr_profiles"."emergency_contact_name" IS '紧急联系人姓名';
COMMENT ON COLUMN "hr_profiles"."emergency_contact_phone" IS '紧急联系人电话';
COMMENT ON COLUMN "hr_profiles"."education_level" IS '最高学历';
COMMENT ON COLUMN "hr_profiles"."cost_center" IS '成本中心';
COMMENT ON COLUMN "hr_profiles"."job_level" IS '职级';
COMMENT ON COLUMN "hr_profiles"."probation_end_date" IS '试用期结束日期';
COMMENT ON COLUMN "hr_profiles"."regular_date" IS '转正日期';
COMMENT ON COLUMN "hr_profiles"."work_location" IS '工作地点';

COMMENT ON COLUMN "hr_leave_types"."tenant_id" IS '所属租户';
COMMENT ON COLUMN "hr_leave_types"."code" IS '租户内活跃假期类型唯一编码';
COMMENT ON COLUMN "hr_leave_types"."name" IS '假期类型名称';
COMMENT ON COLUMN "hr_leave_types"."unit" IS '额度单位：天、半天或小时';
COMMENT ON COLUMN "hr_leave_types"."paid" IS '是否带薪';
COMMENT ON COLUMN "hr_leave_types"."default_days" IS '建议默认年度额度';
COMMENT ON COLUMN "hr_leave_types"."enabled" IS '是否允许新申请';

COMMENT ON COLUMN "hr_leave_balances"."tenant_id" IS '所属租户';
COMMENT ON COLUMN "hr_leave_balances"."membership_id" IS '额度所属成员';
COMMENT ON COLUMN "hr_leave_balances"."leave_type_id" IS '假期类型';
COMMENT ON COLUMN "hr_leave_balances"."year" IS '额度自然年度';
COMMENT ON COLUMN "hr_leave_balances"."total_days" IS '年度总额度';
COMMENT ON COLUMN "hr_leave_balances"."used_days" IS '审批通过且未取消的已使用额度';
COMMENT ON COLUMN "hr_leave_balances"."pending_days" IS '待审批申请冻结额度';
COMMENT ON COLUMN "hr_leave_balances"."remaining_days" IS '当前可申请额度';
COMMENT ON COLUMN "hr_leave_balances"."unit" IS '额度单位快照';

COMMENT ON COLUMN "hr_leave_requests"."tenant_id" IS '所属租户';
COMMENT ON COLUMN "hr_leave_requests"."membership_id" IS '申请成员';
COMMENT ON COLUMN "hr_leave_requests"."leave_type_id" IS '请假类型';
COMMENT ON COLUMN "hr_leave_requests"."start_at" IS '请假开始时间';
COMMENT ON COLUMN "hr_leave_requests"."end_at" IS '请假结束时间';
COMMENT ON COLUMN "hr_leave_requests"."duration_days" IS '折算后的额度数量';
COMMENT ON COLUMN "hr_leave_requests"."reason" IS '申请原因';
COMMENT ON COLUMN "hr_leave_requests"."status" IS '请假状态';
COMMENT ON COLUMN "hr_leave_requests"."reviewed_by" IS '审批人成员 ID';
COMMENT ON COLUMN "hr_leave_requests"."reviewed_at" IS '审批时间';
COMMENT ON COLUMN "hr_leave_requests"."review_comment" IS '审批、取消说明';

COMMENT ON COLUMN "hr_attendance_records"."tenant_id" IS '所属租户';
COMMENT ON COLUMN "hr_attendance_records"."membership_id" IS '考勤所属成员';
COMMENT ON COLUMN "hr_attendance_records"."work_date" IS '工作日期';
COMMENT ON COLUMN "hr_attendance_records"."check_in_at" IS '签到时间';
COMMENT ON COLUMN "hr_attendance_records"."check_out_at" IS '签退时间';
COMMENT ON COLUMN "hr_attendance_records"."status" IS '考勤状态';
COMMENT ON COLUMN "hr_attendance_records"."source" IS '记录来源：手工、导入或钉钉';
COMMENT ON COLUMN "hr_attendance_records"."note" IS '考勤备注或复核说明';
COMMENT ON COLUMN "hr_attendance_records"."reviewed_by" IS '复核人成员 ID';
COMMENT ON COLUMN "hr_attendance_records"."reviewed_at" IS '复核时间';

COMMENT ON COLUMN "hr_overtime_requests"."tenant_id" IS '所属租户';
COMMENT ON COLUMN "hr_overtime_requests"."membership_id" IS '申请成员';
COMMENT ON COLUMN "hr_overtime_requests"."start_at" IS '加班开始时间';
COMMENT ON COLUMN "hr_overtime_requests"."end_at" IS '加班结束时间';
COMMENT ON COLUMN "hr_overtime_requests"."duration_hours" IS '加班小时数';
COMMENT ON COLUMN "hr_overtime_requests"."reason" IS '加班原因';
COMMENT ON COLUMN "hr_overtime_requests"."status" IS '加班申请状态';
COMMENT ON COLUMN "hr_overtime_requests"."reviewed_by" IS '审批人成员 ID';
COMMENT ON COLUMN "hr_overtime_requests"."reviewed_at" IS '审批时间';
COMMENT ON COLUMN "hr_overtime_requests"."review_comment" IS '审批说明';

COMMENT ON COLUMN "hr_employee_changes"."tenant_id" IS '所属租户';
COMMENT ON COLUMN "hr_employee_changes"."membership_id" IS '异动员工';
COMMENT ON COLUMN "hr_employee_changes"."type" IS '异动类型';
COMMENT ON COLUMN "hr_employee_changes"."effective_date" IS '计划或实际生效日期';
COMMENT ON COLUMN "hr_employee_changes"."from_department_id" IS '异动前部门快照';
COMMENT ON COLUMN "hr_employee_changes"."to_department_id" IS '异动后部门';
COMMENT ON COLUMN "hr_employee_changes"."from_position" IS '异动前职位快照';
COMMENT ON COLUMN "hr_employee_changes"."to_position" IS '异动后职位';
COMMENT ON COLUMN "hr_employee_changes"."from_manager_membership_id" IS '异动前直属上级';
COMMENT ON COLUMN "hr_employee_changes"."to_manager_membership_id" IS '异动后直属上级';
COMMENT ON COLUMN "hr_employee_changes"."reason" IS '异动原因';
COMMENT ON COLUMN "hr_employee_changes"."status" IS '异动审批及生效状态';
COMMENT ON COLUMN "hr_employee_changes"."reviewed_by" IS '审批人成员 ID';
COMMENT ON COLUMN "hr_employee_changes"."reviewed_at" IS '审批时间';
COMMENT ON COLUMN "hr_employee_changes"."review_comment" IS '审批说明';

COMMENT ON COLUMN "hr_profiles"."created_at" IS '创建时间';
COMMENT ON COLUMN "hr_profiles"."updated_at" IS '更新时间';
COMMENT ON COLUMN "hr_profiles"."created_by" IS '创建人用户 ID';
COMMENT ON COLUMN "hr_profiles"."updated_by" IS '更新人用户 ID';
COMMENT ON COLUMN "hr_profiles"."deleted_at" IS '软删除时间';
COMMENT ON COLUMN "hr_profiles"."version" IS '乐观锁版本';
COMMENT ON COLUMN "hr_leave_types"."created_at" IS '创建时间';
COMMENT ON COLUMN "hr_leave_types"."updated_at" IS '更新时间';
COMMENT ON COLUMN "hr_leave_types"."created_by" IS '创建人用户 ID';
COMMENT ON COLUMN "hr_leave_types"."updated_by" IS '更新人用户 ID';
COMMENT ON COLUMN "hr_leave_types"."deleted_at" IS '软删除时间';
COMMENT ON COLUMN "hr_leave_types"."version" IS '乐观锁版本';
COMMENT ON COLUMN "hr_leave_balances"."created_at" IS '创建时间';
COMMENT ON COLUMN "hr_leave_balances"."updated_at" IS '更新时间';
COMMENT ON COLUMN "hr_leave_balances"."created_by" IS '创建人用户 ID';
COMMENT ON COLUMN "hr_leave_balances"."updated_by" IS '更新人用户 ID';
COMMENT ON COLUMN "hr_leave_balances"."deleted_at" IS '软删除时间';
COMMENT ON COLUMN "hr_leave_balances"."version" IS '乐观锁版本';
COMMENT ON COLUMN "hr_leave_requests"."created_at" IS '创建时间';
COMMENT ON COLUMN "hr_leave_requests"."updated_at" IS '更新时间';
COMMENT ON COLUMN "hr_leave_requests"."created_by" IS '创建人用户 ID';
COMMENT ON COLUMN "hr_leave_requests"."updated_by" IS '更新人用户 ID';
COMMENT ON COLUMN "hr_leave_requests"."deleted_at" IS '软删除时间';
COMMENT ON COLUMN "hr_leave_requests"."version" IS '乐观锁版本';
COMMENT ON COLUMN "hr_attendance_records"."created_at" IS '创建时间';
COMMENT ON COLUMN "hr_attendance_records"."updated_at" IS '更新时间';
COMMENT ON COLUMN "hr_attendance_records"."created_by" IS '创建人用户 ID';
COMMENT ON COLUMN "hr_attendance_records"."updated_by" IS '更新人用户 ID';
COMMENT ON COLUMN "hr_attendance_records"."deleted_at" IS '软删除时间';
COMMENT ON COLUMN "hr_attendance_records"."version" IS '乐观锁版本';
COMMENT ON COLUMN "hr_overtime_requests"."created_at" IS '创建时间';
COMMENT ON COLUMN "hr_overtime_requests"."updated_at" IS '更新时间';
COMMENT ON COLUMN "hr_overtime_requests"."created_by" IS '创建人用户 ID';
COMMENT ON COLUMN "hr_overtime_requests"."updated_by" IS '更新人用户 ID';
COMMENT ON COLUMN "hr_overtime_requests"."deleted_at" IS '软删除时间';
COMMENT ON COLUMN "hr_overtime_requests"."version" IS '乐观锁版本';
COMMENT ON COLUMN "hr_employee_changes"."created_at" IS '创建时间';
COMMENT ON COLUMN "hr_employee_changes"."updated_at" IS '更新时间';
COMMENT ON COLUMN "hr_employee_changes"."created_by" IS '创建人用户 ID';
COMMENT ON COLUMN "hr_employee_changes"."updated_by" IS '更新人用户 ID';
COMMENT ON COLUMN "hr_employee_changes"."deleted_at" IS '软删除时间';
COMMENT ON COLUMN "hr_employee_changes"."version" IS '乐观锁版本';

