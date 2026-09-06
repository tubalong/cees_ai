# 文档地图

| 目录 | 用途 |
| --- | --- |
| [product](product/README.md) | 产品范围、版本目标与验收口径 |
| [architecture](architecture/overview.md) | 总体架构、目录树、边界与数据流 |
| [file-upload](architecture/file-upload.md) | 文件上传、COS、权限、状态与额度设计草案 |
| [api](api/README.md) | 契约与 API 约定 |
| [database](database/README.md) | 数据模型与迁移约定 |
| [security](security/README.md) | 安全模型、租户隔离与审计 |

## 工程实践

- [持续集成（CI）](engineering/ci.md)：GitHub Actions 触发条件、必需检查与本地验证命令。
- [AI 合并冲突修复助手](engineering/ai-conflict-resolver.md)：维护者触发的半自动冲突修复、候选 PR、限制与安全边界。