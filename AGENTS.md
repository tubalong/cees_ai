# CEES AI 工程约定

## 1. 架构边界

- `apps/api` 是业务事实源：认证、租户、权限、业务写入、统计和审计的唯一权威。
- `apps/ai-service` 只产出草稿、建议、结构化提取与权限过滤后的 RAG 结果，不直接创建或修改正式业务数据。
- `apps/desktop` 与 `apps/mobile` 是客户端运行单元，不复制服务端状态机；业务界面通过共享模块或版本化 API 适配。
- 数据库结构只通过 Prisma 迁移演进；迁移文件提交入库。

## 2. 依赖方向

- 跨语言（TS / Python / Dart）只通过 `packages/contracts`（OpenAPI）对齐。
- 各端 API 客户端由 `packages/contracts` 生成，生成物不手改。
- `apps/ai-service` 与 `apps/mobile` 不参与 pnpm workspace，保留各自工具链（Python、Flutter）。
- TS 包之间只通过 `packages/*` 显式依赖；应用不得 import 另一个应用的内部代码。

## 3. 契约优先

- 改变外部行为、默认值或公开接口前，先修改 `packages/contracts`。
- 兼容新增默认可选项并声明默认值；破坏性变更必须提升契约版本并写迁移说明。
- 修改契约必须重新生成 `packages/api-client`，必要时更新 Dart/Python 客户端与 `docs/api`。
- 契约相关 PR 必须由契约负责人评审。

## 4. 分支与 PR

- `main` 是唯一长期分支并始终可发布；所有变更通过短生命周期任务分支和 PR squash 合入。
- 分支格式为 `<type>/<description>`，有任务编号时使用 `<type>/<ticket-id>-<description>`。
- 分支常用 type：`feat/fix/docs/refactor/test/ci/chore/security`；名称使用英文小写和连字符。
- 一个分支对应一个工作项和一个 PR，合并后删除；不建立个人、模块或 `develop` 长期分支。
- PR 必须通过 CI 与对应目录 owner 评审；只有真实契约依赖才约束相关 PR 的合并顺序。
- 完整规范见 `docs/engineering/git-conventions.md`。

## 5. 提交信息

- 采用 Conventional Commits：`type(scope): subject`。
- type 使用 `feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert/security`。
- scope 使用 `api/ai-service/desktop/mobile/contracts/ui-kit/config/infra`。
- subject 尽量使用简体中文，应简洁具体且不以句号结尾；一个 commit 只包含一个逻辑目标，避免“更新”“修复问题”“进行中”等模糊描述。
- 破坏性变更使用 `!` 并同步提供版本与迁移说明，例如 `feat(contracts)!: 重命名客户状态字段`。

## 6. 验证矩阵

| 变更 | 最低验证 |
| --- | --- |
| NestJS 局部逻辑 | jest 受影响模块 |
| AI 服务 | pytest 受影响模块 |
| 桌面端 | TypeScript 检查 + 生产构建 |
| 移动端 | flutter test |
| 契约 | 校验 + 重新生成客户端 + 受影响端集成验证 |
| 发布 | 对应端全量验证 + 兼容矩阵核对 |

## 7. 密钥与安全

- Secret 只来自环境变量或平台 Secrets；`.env` 不入库，示例值一律 `change_me`。
- AI 服务只接收 NestJS 传入的内部可信上下文；生产环境校验内部 Token 或请求签名。
- 审计事件记录租户、操作者、请求、资源和扩展元数据。

## 8. 文档同步

- 新增功能时，必须在 `docs/` 下创建或明确指定该功能的主设计文档，并从对应架构、API、产品或基础设施文档建立入口。
- 修改功能的外部行为、业务流程、权限与租户边界、状态机、数据模型、额度计费、安全策略或失败语义时，必须在同一变更中同步对应功能文档。
- 修改契约、数据库迁移或部署方式时，文档必须同时链接或说明受影响的 OpenAPI、Prisma migration、配置项和兼容/迁移方式。
- 设计草案开始实现后，应及时标明已经落地、暂缓和仍待确认的内容，避免文档中的建议被误认为现状，也避免代码实现偏离设计而没有记录。
- 功能变更只有在代码、契约、测试和对应文档保持一致后才视为完成；PR 评审需要核对这种一致性。
- 纯内部重构、格式调整以及不改变既有设计和外部行为的局部修复，不要求制造无意义文档改动。
