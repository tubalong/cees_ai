# apps/api — NestJS 业务后端

业务事实源：认证、租户、RBAC、业务写入、统计和审计。

## 目录说明

```text
src/
├── auth/             # 登录、JWT、刷新令牌
├── tenant/           # 租户上下文与守卫
├── rbac/             # 权限与数据范围
├── resource/         # 资源级授权计算与 ACL
├── document/         # 第一种受控业务资源
├── common/           # 异常过滤器、响应封装
├── audit/            # 审计
├── ai-orchestration/ # 通用 AI 服务客户端、调用审计与确认策略
├── database/         # Prisma 接入
└── integration/      # 外部服务适配
```

NestJS 通过生成的 `@cees/ai-service-client` 调用内部 AI 服务。通用 invoke 不暴露给桌面端或移动端，任何未来业务 AI 功能都必须先定义正式契约和业务边界。

依赖清单按需通过 `pnpm --filter @cees/api add ...` 补充后：

```text
pnpm --filter @cees/api dev
```

初始化数据库并创建开发管理员：

```text
pnpm --filter @cees/api prisma:migrate
pnpm --filter @cees/api prisma:seed
```

默认开发登录信息来自仓库根目录 `.env` 中的 `SEED_TENANT_CODE`、
`SEED_ADMIN_EMAIL` 和 `SEED_ADMIN_PASSWORD`，部署前必须替换 `change_me`。

认证接口：

```text
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me

GET    /api/v1/tenants/current
PATCH  /api/v1/tenants/current
GET    /api/v1/tenants/current/members
GET    /api/v1/tenants/current/members/{membershipId}
PATCH  /api/v1/tenants/current/members/{membershipId}
DELETE /api/v1/tenants/current/members/{membershipId}
PUT    /api/v1/tenants/current/members/{membershipId}/roles

GET    /api/v1/permissions
GET    /api/v1/roles
POST   /api/v1/roles
GET    /api/v1/roles/{roleId}
PATCH  /api/v1/roles/{roleId}
DELETE /api/v1/roles/{roleId}?version={version}
PUT    /api/v1/roles/{roleId}/permissions

GET    /api/v1/documents
POST   /api/v1/documents
GET    /api/v1/documents/{documentId}
PATCH  /api/v1/documents/{documentId}
DELETE /api/v1/documents/{documentId}?version={version}

GET    /api/v1/resources/{resourceId}/acl
POST   /api/v1/resources/{resourceId}/acl
DELETE /api/v1/resources/{resourceId}/acl/{aclEntryId}?version={version}

GET /api/v1/audit-events
GET /api/v1/audit-events/{auditEventId}
```

截至 2026-09-07，第一期身份、租户、RBAC、Document、ACL 和审计共 28 个接口均已实现。

Refresh Token 采用单次轮换；`logout` 会撤销当前数据库 Session，之后对应的
Access Token 即使尚未到 JWT 过期时间也不能继续访问受保护接口。

执行 `0003_tenant_membership` 后，User 是全局身份，登录和权限分配通过真实的
TenantMembership 关联租户；旧 Token 需要重新登录获取。

执行 `0004_rbac_role_metadata` 后，Role 使用不可变 `code` 和展示 `name`；
`tenant_admin` 是受保护的系统角色，角色修改与权限替换会立即影响后续请求授权。

执行 `0005_audit_query_fields` 后，审计事件可以按结果、操作者成员、资源、请求 ID
和时间范围查询；所有查询始终限制在当前租户并要求 `audit.read` 权限。

执行 `0006_resource_acl_documents` 后，Resource 作为统一授权根，ManagedDocument
与 Resource 共用 ID。Document 操作先检查 RBAC，再按 Owner、`TENANT` 可见性、
Membership ACL、Role ACL 或 `document.manage_all` 判断资源范围；ACL 不能绕过 RBAC。

从宿主机运行 API、Prisma migration 或 seed 时，`DATABASE_URL` 的主机名使用
`localhost`；在 Docker Compose 容器内运行时使用服务名 `postgres`。

Swagger 文档地址（骨架就绪后）：`http://localhost:3000/api/docs`。
## 启动

```text
pnpm --filter @cees/ai-service-client build
pnpm --filter @cees/api prisma:generate
pnpm --filter @cees/api dev
```

Swagger 文档：`http://localhost:3000/api/docs`。

文件上传涉及租户权限、COS、配额和审计，设计草案见 `docs/architecture/file-upload.md`。公开接口必须先落入 OpenAPI 契约，再由本应用实现。

容器镜像必须从仓库根目录构建：

```text
docker build -f apps/api/Dockerfile .
```
