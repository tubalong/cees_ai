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

- `main` 始终可发布；任务分支短生命周期（`feat/xxx`、`fix/xxx`），完成后经 PR squash 合入。
- PR 必须通过 CI 与对应目录 owner 评审；CI 按路径触发。
- 只有真实契约依赖才约束相关 PR 的合并顺序。

## 5. 提交信息

采用 Conventional Commits：`type(scope): subject`。
type 使用 `feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert/security`。
scope 使用 `api/ai-service/desktop/mobile/contracts/ui-kit/config/infra`。

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

改变外部行为、契约、部署方式时，必须同步 `docs/` 下对应文档；纯内部重构与局部修复不要求制造无意义文档改动。
