# 钉钉组织架构与人员同步

## 1. 功能范围

本阶段支持一个 CEES 租户绑定一个钉钉企业，并由租户管理员维护钉钉应用凭证、验证连接、手动全量同步组织架构和人员。同步结果保存为钉钉外部镜像，当前不自动创建 CEES 登录账号、不覆盖 CEES 密码、角色、权限和项目成员关系。

本阶段暂不包含考勤、请假、审批、钉钉文档、聊天消息、日程、待办和 AI 派发。

## 2. 业务规则

- `tenantId` 唯一：一个租户最多绑定一个钉钉企业。
- `corpId` 全局唯一：同一个钉钉企业不能绑定多个租户。
- `appSecret` 只在请求中接收，使用 AES-256-GCM 加密后保存，接口响应不返回明文或密文。
- 组织同步采用幂等 upsert；同一钉钉用户属于多个部门时只保存一条人员镜像和多个部门 ID。
- 本次同步未发现的部门标记 `isDeleted=true`，未发现或已停用的人员标记 `isDeleted=true`、`active=false`，不物理删除。
- `DingTalkDepartment.departmentId` 和 `DingTalkUser.membershipId` 需要后续人工确认绑定，不能按姓名自动绑定。
- 同一钉钉集成同时只能有一个 `RUNNING` 同步任务。
- 所有接口都在当前租户上下文内执行，并受 JWT、租户守卫和权限守卫保护。

## 3. 使用流程

1. 租户管理员在钉钉开放平台创建企业内部应用，准备 `corpId`、`appKey` 和 `appSecret`。
2. 配置 `DINGTALK_CREDENTIAL_ENCRYPTION_KEY`，生产环境必须使用平台 Secrets 注入的 32 字节密钥，不能使用 `change_me`。
3. 调用 `POST /api/v1/dingtalk/integration` 创建绑定。服务端先向钉钉获取 Access Token，验证成功后才入库。
4. 调用 `POST /api/v1/dingtalk/integration/verify` 可再次验证凭证。
5. 调用 `POST /api/v1/dingtalk/organization/sync` 执行全量同步。
6. 使用部门、人员和同步任务查询接口检查结果，管理员确认后再设计 CEES 部门和成员绑定流程。

## 4. 数据模型

| 表 | 用途 |
| --- | --- |
| `dingtalk_integrations` | 租户与钉钉企业绑定、加密凭证、状态、最近验证/同步时间 |
| `dingtalk_departments` | 钉钉部门外部镜像，保留钉钉部门 ID 和层级 |
| `dingtalk_users` | 钉钉人员外部镜像，保留 UserId、姓名、职位、工号和部门 ID 列表 |
| `dingtalk_sync_jobs` | 记录同步任务状态、数量、错误和发起人 |

数据库迁移为 `apps/api/prisma/migrations/0016_dingtalk_organization_sync/migration.sql`。迁移包含枚举、索引、租户/集成/绑定外键、运行中任务部分唯一索引，以及全部表和字段的 PostgreSQL 中文注释。

## 5. 权限

| 权限 | 用途 |
| --- | --- |
| `dingtalk.integration.read` | 查看当前租户钉钉绑定 |
| `dingtalk.integration.manage` | 创建、修改和验证钉钉绑定 |
| `dingtalk.organization.read` | 查看部门和人员镜像 |
| `dingtalk.organization.sync` | 发起组织架构和人员同步 |

上述权限通过迁移授予已有 `tenant_admin` 系统角色；权限目录同步维护在 `apps/api/src/rbac/permission-catalog.ts`。

## 6. 失败与安全

- 钉钉网络、HTTP 或业务错误统一转换为 `502`，同步任务记录 `FAILED` 和错误信息，集成状态置为 `ERROR`。
- 凭证更新使用 `version` 乐观锁，版本不一致返回 `409`。
- 并发同步由数据库部分唯一索引兜底，重复请求返回同步已运行错误。
- 查询始终按当前租户过滤，禁止通过镜像 ID 访问其他租户数据。
- 当前同步接口为同步执行；大规模企业接入后应迁移到后台任务，并保留同一任务记录模型。
