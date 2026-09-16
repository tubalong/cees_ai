# 文档地图

| 目录 | 用途 |
| --- | --- |
| [product](product/README.md) | 产品范围、版本目标与验收口径 |
| [平台使用、接口与数据库字典](product/platform-usage-guide.md) | 本地使用、管理员模型、全部公开接口、参数、业务流转和数据表字段 |
| [项目与项目成员管理](product/project-management.md) | 项目可见范围、项目角色、状态机和完成后只读规则 |
| [通知中心与后台任务](product/notification-center.md) | 站内通知、阅读状态、后台清理和日报提醒 |
| [工作台与数据看板](product/dashboard-workbench.md) | 工作台概览、待办、任务统计和近期会议 |
| [知识库管理](product/knowledge-base-management.md) | 知识库 CRUD、成员授权、文档上传与处理状态机、公开知识库查询 |
| [钉钉组织架构与人员同步](product/dingtalk-organization-sync.md) | 一个租户绑定一个钉钉企业、凭证验证、部门和人员外部镜像同步 |
| [分配策略与人财法 MVP](product/assignment-and-hr-finance-legal.md) | AssignmentPolicy 已实现；通用任务范围、HR/Finance/Legal 与 P2 请假跳过设计草案 |
| [用户个人资料管理](product/user-profile-management.md) | 当前租户成员查询和修改自己的展示资料 |
| [密码修改与凭证安全](security/password-management.md) | 租户成员和平台管理员修改自己的密码及会话安全规则 |
| [architecture](architecture/overview.md) | 总体架构、目录树、边界与数据流 |
| [ai-service-foundation](architecture/ai-service-foundation.md) | 通用 LLM、多模型路由、LangGraph 与 LlamaIndex 基础设施 |
| [contextual-chat](architecture/contextual-chat.md) | Standard/Ultra、多轮上下文、SSE 与对话摘要压缩 |
| [公开 AI 对话链路与 Token 计量](architecture/public-chat-api-and-token-metering.md) | 客户端本地历史、NestJS Chat API、ai-service 调用和企业/成员/会话/轮次用量记录 |
| [ai-tool-calling](architecture/ai-tool-calling.md) | 通用 Tool Calling、Tool Turn SSE、NestJS 工具执行边界 |
| [web-search](architecture/web-search.md) | Tavily 联网搜索工具、来源回填与安全边界 |
| [task-scope-proposal](architecture/task-scope-proposal.md) | 通用任务 tasks.scope 的 C/D 协调基线、来源追溯与跨职能任务边界 |
| [hr-finance-legal-data-contract](architecture/hr-finance-legal-data-contract.md) | C 人财法 OpenAPI 数据形状、状态机与老板经营概况聚合契约 |
| [backend-subject-p0-review](architecture/backend-subject-p0-review.md) | C 后端主体 P0 复检：租户/部门/导入/RBAC 边界与新模块权限接入 |
| [knowledge-rag](architecture/knowledge-rag.md) | 知识库 RAG：MinerU 解析、LlamaIndex 索引检索、权限过滤与分块计划 |
| [image-generation](architecture/image-generation.md) | 图片生成 profile、ImageRouter、内部生成接口与边界 |
| [document-generation](architecture/document-generation.md) | 领域无关的文档组合、DocumentSpec 与 DOCX 渲染 |
| [file-upload](architecture/file-upload.md) | 已落地的 COS 基础直传接口与后续权限、额度、扫描设计 |
| [redis-foundation](architecture/redis-foundation.md) | NestJS Redis 基础 CRUD、命名空间和使用边界 |
| [api](api/README.md) | 公开与内部契约及生成客户端约定 |
| [项目管理 API](api/project-management-api.md) | 项目、成员、负责人和状态命令接口 |
| [知识库管理 API](api/knowledge-base-api.md) | 知识库 CRUD、成员权限、文档上传和公开查询接口 |
| [钉钉组织架构与人员同步 API](api/dingtalk-organization-sync-api.md) | 钉钉绑定、组织人员同步和同步任务查询 |
| [分配策略与人财法 API](api/assignment-and-hr-finance-legal-api.md) | AssignmentPolicy 已实现；HR/Finance/Legal 仍为 OpenAPI 契约草案 |
| [database](database/README.md) | 数据模型与迁移约定 |
| [security](security/README.md) | 安全模型、租户隔离与审计 |
| [基础设施](../infra/README.md) | 应用/数据库分离部署、环境隔离与服务器运维入口 |

## 工程实践

- [Git 协作规范](engineering/git-conventions.md)：分支与 Conventional Commit 命名规范。
- [持续集成（CI）](engineering/ci.md)：GitHub Actions 触发条件、必需检查与本地验证命令。
- [AI 合并冲突修复助手](engineering/ai-conflict-resolver.md)：维护者触发的半自动冲突修复、候选 PR、限制与安全边界。
