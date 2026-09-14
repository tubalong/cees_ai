CREATE TYPE "DingTalkIntegrationStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ERROR');
CREATE TYPE "DingTalkSyncJobStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "DingTalkSyncType" AS ENUM ('FULL_ORGANIZATION');

CREATE TABLE dingtalk_integrations (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    corp_id TEXT NOT NULL,
    app_key TEXT NOT NULL,
    app_secret_ciphertext TEXT NOT NULL,
    status "DingTalkIntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    last_verified_at TIMESTAMP(3),
    last_synced_at TIMESTAMP(3),
    last_error_code TEXT,
    last_error_message TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL,
    created_by UUID,
    updated_by UUID,
    version INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT dingtalk_integrations_pkey PRIMARY KEY (id)
);

CREATE TABLE dingtalk_departments (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    integration_id UUID NOT NULL,
    external_department_id TEXT NOT NULL,
    parent_external_department_id TEXT,
    department_id UUID,
    name TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    last_seen_at TIMESTAMP(3) NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL,
    CONSTRAINT dingtalk_departments_pkey PRIMARY KEY (id)
);

CREATE TABLE dingtalk_users (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    integration_id UUID NOT NULL,
    external_user_id TEXT NOT NULL,
    union_id TEXT,
    membership_id UUID,
    name TEXT NOT NULL,
    title TEXT,
    job_number TEXT,
    department_external_ids JSONB NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    admin BOOLEAN NOT NULL DEFAULT false,
    boss BOOLEAN NOT NULL DEFAULT false,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    last_seen_at TIMESTAMP(3) NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL,
    CONSTRAINT dingtalk_users_pkey PRIMARY KEY (id)
);

CREATE TABLE dingtalk_sync_jobs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    integration_id UUID NOT NULL,
    type "DingTalkSyncType" NOT NULL DEFAULT 'FULL_ORGANIZATION',
    status "DingTalkSyncJobStatus" NOT NULL DEFAULT 'RUNNING',
    department_count INTEGER NOT NULL DEFAULT 0,
    user_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    started_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP(3),
    created_by UUID,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT dingtalk_sync_jobs_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX dingtalk_integrations_tenant_id_key ON dingtalk_integrations (tenant_id);
CREATE UNIQUE INDEX dingtalk_integrations_corp_id_key ON dingtalk_integrations (corp_id);
CREATE INDEX dingtalk_integrations_tenant_id_status_idx ON dingtalk_integrations (tenant_id, status);
CREATE UNIQUE INDEX dingtalk_departments_integration_id_external_department_id_key ON dingtalk_departments (integration_id, external_department_id);
CREATE INDEX dingtalk_departments_tenant_id_parent_external_department_i_idx ON dingtalk_departments (tenant_id, parent_external_department_id);
CREATE INDEX dingtalk_departments_tenant_id_department_id_idx ON dingtalk_departments (tenant_id, department_id);
CREATE UNIQUE INDEX dingtalk_users_integration_id_external_user_id_key ON dingtalk_users (integration_id, external_user_id);
CREATE UNIQUE INDEX dingtalk_users_integration_id_membership_id_key ON dingtalk_users (integration_id, membership_id);
CREATE INDEX dingtalk_users_tenant_id_membership_id_idx ON dingtalk_users (tenant_id, membership_id);
CREATE INDEX dingtalk_users_tenant_id_active_is_deleted_idx ON dingtalk_users (tenant_id, active, is_deleted);
CREATE INDEX dingtalk_sync_jobs_tenant_id_created_at_idx ON dingtalk_sync_jobs (tenant_id, created_at);
CREATE INDEX dingtalk_sync_jobs_integration_id_status_idx ON dingtalk_sync_jobs (integration_id, status);
CREATE UNIQUE INDEX dingtalk_sync_jobs_one_running_idx ON dingtalk_sync_jobs (integration_id) WHERE status = 'RUNNING';

ALTER TABLE dingtalk_integrations
    ADD CONSTRAINT dingtalk_integrations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE dingtalk_departments
    ADD CONSTRAINT dingtalk_departments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT dingtalk_departments_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES dingtalk_integrations(id) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT dingtalk_departments_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE dingtalk_users
    ADD CONSTRAINT dingtalk_users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT dingtalk_users_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES dingtalk_integrations(id) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT dingtalk_users_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES tenant_memberships(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE dingtalk_sync_jobs
    ADD CONSTRAINT dingtalk_sync_jobs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT dingtalk_sync_jobs_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES dingtalk_integrations(id) ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO permissions (id, code, name, created_at, updated_at) VALUES
    (gen_random_uuid(), 'dingtalk.integration.read', '查看钉钉企业绑定', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'dingtalk.integration.manage', '管理钉钉企业绑定', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'dingtalk.organization.read', '查看钉钉组织镜像', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'dingtalk.organization.sync', '同步钉钉组织架构和人员', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = CURRENT_TIMESTAMP;

INSERT INTO role_permissions (id, tenant_id, role_id, permission_id, created_at)
SELECT gen_random_uuid(), role.tenant_id, role.id, permission.id, CURRENT_TIMESTAMP
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.code = 'tenant_admin'
  AND role.deleted_at IS NULL
  AND permission.code IN ('dingtalk.integration.read', 'dingtalk.integration.manage', 'dingtalk.organization.read', 'dingtalk.organization.sync')
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

COMMENT ON TYPE "DingTalkIntegrationStatus" IS '钉钉企业集成状态：启用、禁用或错误';
COMMENT ON TYPE "DingTalkSyncJobStatus" IS '钉钉同步任务状态：运行中、成功或失败';
COMMENT ON TYPE "DingTalkSyncType" IS '钉钉同步类型';
COMMENT ON TABLE dingtalk_integrations IS '租户绑定的钉钉企业应用凭证，不保存明文密钥';
COMMENT ON TABLE dingtalk_departments IS '钉钉部门外部镜像，不直接等同于 CEES 部门';
COMMENT ON TABLE dingtalk_users IS '钉钉人员外部镜像，不自动创建 CEES 登录账号';
COMMENT ON TABLE dingtalk_sync_jobs IS '钉钉组织架构和人员同步任务及结果';
COMMENT ON COLUMN dingtalk_integrations.id IS '集成记录 UUID';
COMMENT ON COLUMN dingtalk_integrations.tenant_id IS '所属租户 UUID，一个租户最多绑定一个钉钉企业';
COMMENT ON COLUMN dingtalk_integrations.corp_id IS '钉钉企业 CorpId，全局唯一';
COMMENT ON COLUMN dingtalk_integrations.app_key IS '钉钉应用 AppKey';
COMMENT ON COLUMN dingtalk_integrations.app_secret_ciphertext IS '使用 AES-256-GCM 加密后的钉钉 AppSecret';
COMMENT ON COLUMN dingtalk_integrations.status IS '集成状态';
COMMENT ON COLUMN dingtalk_integrations.last_verified_at IS '最近一次凭证验证时间';
COMMENT ON COLUMN dingtalk_integrations.last_synced_at IS '最近一次成功同步时间';
COMMENT ON COLUMN dingtalk_integrations.last_error_code IS '最近一次错误编码';
COMMENT ON COLUMN dingtalk_integrations.last_error_message IS '最近一次错误信息';
COMMENT ON COLUMN dingtalk_integrations.created_at IS '创建时间';
COMMENT ON COLUMN dingtalk_integrations.updated_at IS '更新时间';
COMMENT ON COLUMN dingtalk_integrations.created_by IS '创建人 User UUID';
COMMENT ON COLUMN dingtalk_integrations.updated_by IS '最后修改人 User UUID';
COMMENT ON COLUMN dingtalk_integrations.version IS '乐观锁版本号';
COMMENT ON COLUMN dingtalk_departments.id IS '镜像记录 UUID';
COMMENT ON COLUMN dingtalk_departments.tenant_id IS '所属租户 UUID';
COMMENT ON COLUMN dingtalk_departments.integration_id IS '所属钉钉企业集成 UUID';
COMMENT ON COLUMN dingtalk_departments.external_department_id IS '钉钉部门 ID';
COMMENT ON COLUMN dingtalk_departments.parent_external_department_id IS '钉钉上级部门 ID';
COMMENT ON COLUMN dingtalk_departments.department_id IS '可选的 CEES 部门 UUID，需后续人工绑定';
COMMENT ON COLUMN dingtalk_departments.name IS '钉钉部门名称';
COMMENT ON COLUMN dingtalk_departments.display_order IS '钉钉部门排序值';
COMMENT ON COLUMN dingtalk_departments.is_deleted IS '是否已从钉钉组织中删除';
COMMENT ON COLUMN dingtalk_departments.last_seen_at IS '最近一次同步发现时间';
COMMENT ON COLUMN dingtalk_departments.created_at IS '创建时间';
COMMENT ON COLUMN dingtalk_departments.updated_at IS '更新时间';
COMMENT ON COLUMN dingtalk_users.id IS '镜像记录 UUID';
COMMENT ON COLUMN dingtalk_users.tenant_id IS '所属租户 UUID';
COMMENT ON COLUMN dingtalk_users.integration_id IS '所属钉钉企业集成 UUID';
COMMENT ON COLUMN dingtalk_users.external_user_id IS '钉钉用户 UserId';
COMMENT ON COLUMN dingtalk_users.union_id IS '钉钉用户 UnionId';
COMMENT ON COLUMN dingtalk_users.membership_id IS '可选的 CEES 租户成员 UUID，需后续人工绑定';
COMMENT ON COLUMN dingtalk_users.name IS '钉钉用户姓名';
COMMENT ON COLUMN dingtalk_users.title IS '钉钉职位';
COMMENT ON COLUMN dingtalk_users.job_number IS '钉钉工号';
COMMENT ON COLUMN dingtalk_users.department_external_ids IS '用户所属钉钉部门 ID 列表';
COMMENT ON COLUMN dingtalk_users.active IS '钉钉用户是否在职或启用';
COMMENT ON COLUMN dingtalk_users.admin IS '是否为钉钉管理员';
COMMENT ON COLUMN dingtalk_users.boss IS '是否为钉钉企业负责人';
COMMENT ON COLUMN dingtalk_users.is_deleted IS '是否已从钉钉组织中删除';
COMMENT ON COLUMN dingtalk_users.last_seen_at IS '最近一次同步发现时间';
COMMENT ON COLUMN dingtalk_users.created_at IS '创建时间';
COMMENT ON COLUMN dingtalk_users.updated_at IS '更新时间';
COMMENT ON COLUMN dingtalk_sync_jobs.id IS '同步任务 UUID';
COMMENT ON COLUMN dingtalk_sync_jobs.tenant_id IS '所属租户 UUID';
COMMENT ON COLUMN dingtalk_sync_jobs.integration_id IS '所属钉钉企业集成 UUID';
COMMENT ON COLUMN dingtalk_sync_jobs.type IS '同步任务类型';
COMMENT ON COLUMN dingtalk_sync_jobs.status IS '同步任务状态';
COMMENT ON COLUMN dingtalk_sync_jobs.department_count IS '本次同步部门数量';
COMMENT ON COLUMN dingtalk_sync_jobs.user_count IS '本次同步人员数量';
COMMENT ON COLUMN dingtalk_sync_jobs.error_code IS '失败错误编码';
COMMENT ON COLUMN dingtalk_sync_jobs.error_message IS '失败错误信息';
COMMENT ON COLUMN dingtalk_sync_jobs.started_at IS '任务开始时间';
COMMENT ON COLUMN dingtalk_sync_jobs.completed_at IS '任务完成时间';
COMMENT ON COLUMN dingtalk_sync_jobs.created_by IS '发起人 User UUID';
COMMENT ON COLUMN dingtalk_sync_jobs.created_at IS '任务创建时间';
