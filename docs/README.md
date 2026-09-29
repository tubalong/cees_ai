# 文档地图

| 目录 | 用途 |
| --- | --- |
| [product](product/README.md) | 产品范围、版本目标与验收口径 |
| [平台使用、接口与数据库字典](product/platform-usage-guide.md) | 本地使用、管理员模型、全部公开接口、参数、业务流转和数据表字段 |
| [项目与项目成员管理](product/project-management.md) | 项目可见范围、项目角色、状态机和完成后只读规则 |
| [通知中心与后台任务](product/notification-center.md) | 站内通知、阅读状态、后台清理和日报提醒 |
| [工作台与数据看板](product/dashboard-workbench.md) | 工作台概览、待办、任务统计和近期会议 |
| [知识库管理](product/knowledge-base-management.md) | 知识库 CRUD、成员授权、文档上传与处理状态机、公开知识库查询 |
| [钉钉组织架构与人员同步](product/dingtalk-organization-sync.md) | 企业应用凭证或 DWS/MCP 可见组织快照、部门和人员外部镜像同步 |
| [钉钉 DWS/MCP 连接器](product/dingtalk-mcp-connector.md) | 连接器市场、一键安装 DWS、本地授权、对话只读上下文、可见范围导入和租户管理员确认流程 |
| [腾讯会议连接器](product/tencent-meeting-connector.md) | Desktop 托管官方 CLI、浏览器 OAuth、版本化命令目录与写操作确认 |
| [企业微信 CLI 连接器](product/wecom-cli-connector.md) | 官方 CLI 托管安装、扫码授权智能机器人、动态工具与对话确认执行 |
| [GitHub 官方远程 MCP 连接器](product/github-remote-mcp-connector.md) | GitHub OAuth、官方远程 MCP、动态工具发现与 Desktop 本地执行 |
| [分配策略与人财法](product/assignment-and-hr-finance-legal.md) | AssignmentPolicy、完整 HR 与 Finance 已实现；Legal 契约已冻结待实现 |
| [AI 助手业务写操作](product/assistant-business-tools.md) | 聊天式部门/知识库写入：发现+动作两层工具、待确认草稿、确认前无副作用、幂等与重鉴权 |
| [AI 同事：定位与关系说明](product/ai-colleague.md) | 四个主体（企业/用户/总管/同事）的定义与关系、两种运行模式（前台对话与编排执行）、能力构成（职能/数据源/学习记录/工作记录/权限边界）、权限与临时授权、术语边界 |
| [AI 任务编排（需求设计）](product/ai-orchestration.md) | 对话与编排双通道、任务全流程（计划/派发前确认/逐步执行/草稿验收/沉淀）、三层上下文与三不变量、JEV 三方职责、建议/临时授权/主动问人交互与分块实施 |
| [AI 管家：主动跟进与推动](product/proactive-assistant.md) | 设计草案（未实施）：“事找人”定位与红线、规则发现 + LLM 翻译（引用校验）、跟进记录独立数据面与证据链、提醒设置与防打扰、反馈闭环 |
| [桌面端安全加固](engineering/desktop-security-hardening.md) | CSP（dev 响应头 + 打包 meta）、IPC 来源校验、导航锁定、webview 策略、令牌移出 Web Storage |
| [用户个人资料管理](product/user-profile-management.md) | 当前租户成员查询和修改自己的展示资料 |
| [密码修改与凭证安全](security/password-management.md) | 租户成员和平台管理员修改自己的密码及会话安全规则 |
| [architecture](architecture/overview.md) | 总体架构、目录树、边界与数据流 |
| [ai-service-foundation](architecture/ai-service-foundation.md) | 通用 LLM、多模型路由、LangGraph 与 LlamaIndex 基础设施 |
| [contextual-chat](architecture/contextual-chat.md) | Standard/Ultra、多轮上下文、SSE 与对话摘要压缩 |
| [用户级记忆](architecture/user-memory.md) | 跨会话用户级长期记忆设计：仅用户级不做租户级、提炼与合并流程、注入与分块计划 |
| [AI 调用与 Token 计量](architecture/public-chat-api-and-token-metering.md) | AiInvocationRecorderService 与 AIInvocationLog：模型调用、Token 记录与写入规则 |
| [ai-tool-calling](architecture/ai-tool-calling.md) | 通用 Tool Calling、Tool Turn SSE、NestJS 工具执行边界 |
| [连接器语义路由与调用审计](architecture/connector-routing-and-iteration.md) | 连接器语义路由、受控多步接力与调用审计（已落地，契约 `0.44.0` / `0.45.0` / `0.47.0`） |
| [审计日志保留策略](architecture/audit-log-retention.md) | 审计分级保留：连接器只读逐条审计到期删除、其余租户审计归档、平台审计永久 |
| [web-search](architecture/web-search.md) | Tavily 联网搜索工具、来源回填与安全边界 |
| [task-scope-proposal](architecture/task-scope-proposal.md) | 通用任务 tasks.scope 的 C/D 协调基线、来源追溯与跨职能任务边界 |
| [hr-finance-legal-data-contract](architecture/hr-finance-legal-data-contract.md) | HR、Finance 已实现基线及 Legal、老板经营概况聚合契约 |
| [Legal 合同台账设计](architecture/legal-contract-ledger.md) | 合同台账字段、状态机、数据范围、附件、到期任务和 Desktop 验收基线 |
| [backend-subject-p0-review](architecture/backend-subject-p0-review.md) | C 后端主体 P0 复检：租户/部门/导入/RBAC 边界与新模块权限接入 |
| [knowledge-rag](architecture/knowledge-rag.md) | 知识库 RAG：MinerU 解析、LlamaIndex 索引检索、权限过滤与分块计划 |
| [image-generation](architecture/image-generation.md) | 图片生成 profile、ImageRouter、内部生成接口与边界 |
| [document-generation](architecture/document-generation.md) | 领域无关的文档组合、DocumentSpec 与 DOCX 渲染 |
| [pdf-pptx-generation](architecture/pdf-pptx-generation.md) | PDF/PPTX 确定性渲染、PptxSpec 与三个生成工具接线 |
| [生成文档格式交付](architecture/generated-document-format-delivery.md) | 生成格式落库、文档详情契约与桌面端资源卡片下载 |
| [生成文档落 COS 与附件注入](architecture/generated-document-storage-and-attachment-injection.md) | 生成文件直传 COS、FileObject 关联与对话文档附件文本注入 |
| [file-upload](architecture/file-upload.md) | 已落地的 COS 基础直传接口与后续权限、额度、扫描设计 |
| [redis-foundation](architecture/redis-foundation.md) | NestJS Redis 基础 CRUD、命名空间和使用边界 |
| [本机工具与 Excel 读写实现](architecture/local-tools-and-excel-io-plan.md) | 聊天上传并生成 Excel、本机只读扫描、隔离/恢复/永久清理的实现边界与风险登记 |
| [AI 任务编排技术设计](architecture/ai-orchestration-technical.md) | 数据模型（同事表 / 任务五表 / 统一交互表）、状态机与幂等、对外契约与任务事件流、派发书与执行窗口算法、编排决策抽象（v1 规则 + LLM / v2 JEV）、调度运行器与实现落点 |
| [AI 管家技术设计（草案）](architecture/proactive-assistant-technical.md) | 设计草案（未实施）：跟进记录数据模型（主表/规则表/设置表）、状态机与幂等、证据链结构、接口草案、翻译调用链与规则框架要点 |
| [api](api/README.md) | 公开与内部契约及生成客户端约定 |
| [项目管理 API](api/project-management-api.md) | 项目、成员、负责人和状态命令接口 |
| [知识库管理 API](api/knowledge-base-api.md) | 知识库 CRUD、成员权限、文档上传和公开查询接口 |
| [钉钉组织架构与人员同步 API](api/dingtalk-organization-sync-api.md) | 钉钉绑定、组织人员同步和同步任务查询 |
| [腾讯会议连接器 API](api/tencent-meeting-connector-api.md) | `0.40.0` 官方 CLI 规划语义、本地 OAuth 边界与迁移说明 |
| [企业微信连接器 API](api/wecom-connector-api.md) | `0.39.0` 动态 CLI 工具规划与 `WECOM` 会话上下文 |
| [GitHub 连接器 API](api/github-connector-api.md) | `0.43.0` OAuth Broker、官方远程 MCP 工具规划与 `GITHUB` 会话上下文 |
| [连接器语义路由 API](api/assistant-connector-routing-api.md) | `0.44.0` 一级目录路由、`clarification` 语义与 `connectorRoutingHint` |
| [分配策略与人财法 API](api/assignment-and-hr-finance-legal-api.md) | AssignmentPolicy、HR 与 Finance 已实现；Legal 契约已冻结待实现 |
| [database](database/README.md) | 数据模型与迁移约定 |
| [security](security/README.md) | 安全模型、租户隔离与审计 |
| [基础设施](../infra/README.md) | 应用/数据库分离部署、环境隔离与服务器运维入口 |

## 工程实践

- [Git 协作规范](engineering/git-conventions.md)：分支与 Conventional Commit 命名规范。
- [持续集成（CI）](engineering/ci.md)：GitHub Actions 触发条件、必需检查与本地验证命令。
- [AI 合并冲突修复助手](engineering/ai-conflict-resolver.md)：维护者触发的半自动冲突修复、候选 PR、限制与安全边界。
- [桌面端状态管理约定](engineering/desktop-state-management.md)：服务端数据、全局 UI 偏好与局部 UI 状态的分层归属约定。
- [全系统手工测试用例集](engineering/system-manual-test-cases.md)：对话、联网、知识库、图片、文档生成、业务工具、本机能力、连接器与权限边界的人工验收问法与判定标准。
