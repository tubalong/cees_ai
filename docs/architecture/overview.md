# 总体架构

## 仓库结构

```text
cees_ai/
├── apps/
│   ├── api/                    # NestJS 业务事实源
│   ├── ai-service/             # FastAPI 通用 AI 基础设施
│   ├── desktop/                # Electron + React 桌面端
│   └── mobile/                 # Flutter 移动端
├── packages/
│   ├── contracts/              # 公开与内部 OpenAPI 契约
│   ├── api-client/             # 公开 API TypeScript 客户端
│   ├── ai-service-client/      # 内部 AI Service 生成客户端
│   ├── ui-kit/
│   └── config/
├── infra/                      # PostgreSQL、Redis 与腾讯云 COS 配置
└── docs/
```

## 边界与职责

- NestJS 是 Tenant、User、Permission、业务资源、正式写入和审计数据的唯一事实源。
- ai-service 当前只提供 health、ready 和受内部 Token 保护的通用 LLM invoke，不定义工作记录、会议、知识库或管理简报等业务能力。
- ai-service 不直接连接业务数据库，不创建或修改正式业务数据。
- 未来业务 AI 功能必须由 NestJS 建立可信租户/用户上下文，并在契约中定义专用输入输出，不能让客户端直接调用通用 invoke。
- COS 长期凭据只由 NestJS 持有；客户端和 ai-service 不持有长期 COS 密钥。
- 桌面端和移动端中的部分菜单仍是 UI 原型，占位入口不构成后端需求或可用能力。
- Docker 环境采用公共 Compose 与 local/staging/production 覆盖组合；连接地址和密钥来自环境变量或平台 Secrets。

## 契约与调用链路

```mermaid
flowchart LR
  C[packages/contracts]
  C --> P[公开 API 客户端]
  C --> I[ai-service 内部客户端]
  P --> A[NestJS API]
  A -->|可信上下文 + 内部 Token| F[FastAPI ai-service]
  A --> PG[(PostgreSQL)]
  A --> R[(Redis)]
  A --> S[(腾讯云 COS)]
```

跨语言行为只通过 `packages/contracts` 对齐。生成目录不得手改，契约变更必须运行 `contracts:lint`、`contracts:gen` 和 `contracts:check`。

## 专题设计

- [AI Service 通用基础设施](ai-service-foundation.md)
- [文件上传设计草案](file-upload.md)
