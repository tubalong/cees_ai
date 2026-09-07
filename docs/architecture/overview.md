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
├── infra/                      # 分离式应用、数据库部署与腾讯云 COS 配置
└── docs/
```

## 边界与职责

- NestJS 是 Tenant、User、Permission、业务资源、正式写入和审计数据的唯一事实源。
- ai-service 当前只提供 health、ready 和受内部 Token 保护的通用 LLM invoke，不定义工作记录、会议、知识库或管理简报等业务能力。
- ai-service 不直接连接业务数据库，不创建或修改正式业务数据。
- 未来业务 AI 功能必须由 NestJS 建立可信租户/用户上下文，并在契约中定义专用输入输出，不能让客户端直接调用通用 invoke。
- COS 长期凭据只由 NestJS 持有；客户端和 ai-service 不持有长期 COS 密钥。
- 桌面端和移动端中的部分菜单仍是 UI 原型，占位入口不构成后端需求或可用能力。
- 本地开发在开发电脑运行 PostgreSQL/Redis；共享环境将应用与数据库部署到同一 VPC 内的两台独立服务器。
- Staging 与 Production 在每台物理服务器内通过独立目录、Compose 项目、容器、网络、端口、数据卷和 Secret 隔离。
- 连接地址和密钥只来自未提交的环境文件或平台 Secrets。

## 物理部署拓扑

```mermaid
flowchart LR
  subgraph APP["应用服务器 1.14.103.59 / 172.27.0.2"]
    SA[Staging API + ai-service]
    PA[Production API + ai-service]
  end

  subgraph DB["数据库服务器 45.40.251.151 / 172.27.0.3"]
    SPG[(Staging PostgreSQL)]
    SR[(Staging Redis)]
    PPG[(Production PostgreSQL)]
    PR[(Production Redis)]
  end

  SA -->|VPC 15432| SPG
  SA -->|VPC 16379| SR
  PA -->|VPC 25432| PPG
  PA -->|VPC 26379| PR
```

应用服务器保存两个独立代码目录 `/opt/cees-ai/staging` 和 `/opt/cees-ai/production`。数据库服务器不保存业务源码，只保存 `/opt/cees-db` 数据库部署单元及两个环境的受限权限配置文件。服务器间数据库流量不得经过公网 IP。

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
- [通用文档生成](document-generation.md)
- [文件上传设计草案](file-upload.md)
