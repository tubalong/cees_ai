# 安全模型

- [密码修改与凭证安全](password-management.md)：租户成员和平台超级管理员修改自己的密码、会话撤销与审计规则。

- API 入口由 JWT 建立用户身份，再由租户守卫建立租户上下文。
- 平台超级管理员使用独立 Platform JWT、PlatformAuthSession 和权限 Guard，不能通过租户 `tenant_admin` 角色获得平台权限。
- Production 必须为平台 JWT 配置独立的 `JWT_PLATFORM_ACCESS_SECRET`，不得与租户 Access Token 共用 Secret。
- 服务端不接受客户端提供的租户 ID 作为授权依据；查询必须按租户与数据范围过滤。
- AI 服务只接收 NestJS 传入的内部可信上下文，生产环境校验内部 Token 或请求签名。
- 审计事件记录租户、操作者、请求、资源与扩展元数据。
- 平台登录和跨租户管理写入独立 PlatformAuditLog；涉及具体租户的变更同时写入目标租户审计。
- 租户邀请只保存 Token Hash，明文令牌仅在创建响应中出现一次并通过受控渠道交付；新用户接受邀请时自行设置密码。
- Secret 只允许来自环境变量或平台 Secrets，示例值一律 `change_me`。
- 腾讯云 COS Bucket 默认私有；长期凭据只注入 NestJS，并使用限定 Bucket 和操作范围的 CAM 子账号或角色。
- 客户端与 AI 服务访问 COS 时使用短时签名 URL 或 STS 临时凭证，不得获得长期 SecretId/SecretKey。
- COS 基础上传接口必须经过 JWT 和 TenantContext，只签名单一服务端对象键，并在完成时通过 COS HEAD 校验；当前尚未启用 `file.*` 细粒度权限和租户额度，不应在补齐这些策略前扩大正式生产使用范围。
- 本地、Staging 和 Production 使用独立数据库与 Redis 命名空间；COS 在同一 Bucket 中以 `cees/local`、`cees/staging`、`cees/prod` 前缀隔离，并使用权限互斥的三套 CAM 凭据。
- 应用与数据库通过各自环境的私网通信；数据库连接串不得使用数据库主机公网 IP。
- Staging 与 Production 部署在不同服务器；两个环境不得共享数据库容器、账号、密码或数据卷。
- 安全组只允许对应环境的应用来源访问 PostgreSQL `5432` 和 Redis `6379`，不得向 `0.0.0.0/0` 开放数据库端口。
- ai-service 在 Production 不映射宿主机端口；Staging 为调试文档映射 `AI_SERVICE_PORT`（默认 `8000`）。Staging 对外端口必须通过安全组或防火墙限制来源，内部业务接口仍要求 `AI_INTERNAL_TOKEN`。
- 公开 Chat 接口必须同时通过租户 JWT、有效 Session 和 TenantContext；客户端不能提交 tenant/user/membership、系统指令或模型路由字段，对话正文与摘要不得写入 `ai_invocation_logs`。
