# apps/api — NestJS 业务后端

业务事实源：认证、租户、RBAC、业务写入、统计与审计。

## 目录说明

```text
src/
├── auth/             # 登录、JWT、刷新令牌
├── tenant/           # 租户上下文与守卫
├── rbac/             # 权限与数据范围
├── common/           # 异常过滤器、响应封装
├── audit/            # 审计
├── ai-orchestration/ # AI 调用编排、草稿与人工确认
├── dashboard/        # 统计聚合
├── database/         # Prisma 接入
└── integration/      # 外部服务适配
```

## 启动

依赖清单按需通过 `pnpm --filter @cees/api add ...` 补充后：

```text
pnpm --filter @cees/api dev
```

Swagger 文档地址（骨架就绪后）：`http://localhost:3000/api/docs`。
