# apps/api — NestJS 业务后端

业务事实源：认证、租户、RBAC、业务写入、统计和审计。

## 目录说明

```text
src/
├── auth/             # 登录、JWT、刷新令牌
├── tenant/           # 租户上下文与守卫
├── rbac/             # 权限与数据范围
├── common/           # 异常过滤器、响应封装
├── audit/            # 审计
├── ai-orchestration/ # 通用 AI 服务客户端、调用审计与确认策略
├── database/         # Prisma 接入
└── integration/      # 外部服务适配
```

NestJS 通过生成的 `@cees/ai-service-client` 调用内部 AI 服务。通用 invoke 不暴露给桌面端或移动端，任何未来业务 AI 功能都必须先定义正式契约和业务边界。

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
