# 文档地图

| 目录 | 用途 |
| --- | --- |
| [product](product/README.md) | 产品范围、版本目标与验收口径 |
| [平台使用、接口与数据库字典](product/platform-usage-guide.md) | 本地使用、管理员模型、全部公开接口、参数、业务流转和数据表字段 |
| [architecture](architecture/overview.md) | 总体架构、目录树、边界与数据流 |
| [ai-service-foundation](architecture/ai-service-foundation.md) | 通用 LLM、多模型路由、LangGraph 与 LlamaIndex 基础设施 |
| [document-generation](architecture/document-generation.md) | 领域无关的文档组合、DocumentSpec 与 DOCX 渲染 |
| [file-upload](architecture/file-upload.md) | 已落地的 COS 基础直传接口与后续权限、额度、扫描设计 |
| [redis-foundation](architecture/redis-foundation.md) | NestJS Redis 基础 CRUD、命名空间和使用边界 |
| [api](api/README.md) | 公开与内部契约及生成客户端约定 |
| [database](database/README.md) | 数据模型与迁移约定 |
| [security](security/README.md) | 安全模型、租户隔离与审计 |
| [基础设施](../infra/README.md) | 应用/数据库分离部署、环境隔离与服务器运维入口 |

## 工程实践

- [Git 协作规范](engineering/git-conventions.md)：分支与 Conventional Commit 命名规范。
- [持续集成（CI）](engineering/ci.md)：GitHub Actions 触发条件、必需检查与本地验证命令。
- [AI 合并冲突修复助手](engineering/ai-conflict-resolver.md)：维护者触发的半自动冲突修复、候选 PR、限制与安全边界。
