# 安全模型

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
- 本地、Staging 和 Production 使用独立数据库与 Redis 命名空间；COS 在同一 Bucket 中以 `cees/local`、`cees/staging`、`cees/prod` 前缀隔离，并使用权限互斥的三套 CAM 凭据。
- 应用服务器 `172.27.0.2` 与数据库服务器 `172.27.0.3` 只通过腾讯云 VPC 通信；应用连接串不得使用两台服务器的公网 IP。
- 数据库服务器分别运行 Staging/Production PostgreSQL 与 Redis 容器，两个环境不得共享容器、数据库账号、密码或数据卷。
- 腾讯云安全组只允许来源 `172.27.0.2` 访问数据库服务器对应端口，不得向 `0.0.0.0/0` 开放 PostgreSQL 或 Redis。
- ai-service 在 Staging/Production 不映射宿主机端口，内部接口只允许同一应用 Compose 项目中的 NestJS 访问。
