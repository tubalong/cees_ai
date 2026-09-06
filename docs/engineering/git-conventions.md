# Git 协作规范

## 分支命名

格式：

```text
<type>/<description>
```

有任务编号时：

```text
<type>/<ticket-id>-<description>
```

常用 type：

| Type | 使用场景 |
| --- | --- |
| `feat` | 开发新功能或新增业务能力 |
| `fix` | 修复缺陷或错误行为 |
| `docs` | 仅修改文档 |
| `refactor` | 重构代码且不改变外部行为 |
| `test` | 新增或调整测试 |
| `ci` | 修改 CI/CD、GitHub Actions |
| `chore` | 依赖升级、工具调整等工程维护 |
| `security` | 修复安全问题或加强安全控制 |

示例：

```text
feat/customer-import
fix/api-tenant-filter
ci/pull-request-checks
feat/cees-123-customer-import
```

要求：

- 使用英文小写和连字符；
- 一个分支对应一个工作项和一个 PR；
- 经 PR squash 合入 `main`，合并后删除分支；
- 不建立个人、模块或 `develop` 长期分支。

## Commit 命名

采用 Conventional Commits：

```text
<type>(<scope>): <subject>
```

允许的 type 及使用场景：

| Type | 使用场景 |
| --- | --- |
| `feat` | 新增用户可见功能或业务能力 |
| `fix` | 修复缺陷、异常或错误行为 |
| `docs` | 仅修改文档，不修改程序逻辑 |
| `style` | 调整格式、空格、命名等，不改变逻辑 |
| `refactor` | 重构实现，不新增功能也不修复缺陷 |
| `perf` | 优化性能、资源消耗或响应速度 |
| `test` | 新增、修改或修复测试 |
| `build` | 修改构建工具、打包流程或构建依赖 |
| `ci` | 修改 CI/CD、GitHub Actions 或流水线配置 |
| `chore` | 日常维护、普通依赖升级或辅助工具调整 |
| `revert` | 回滚之前的提交或功能变更 |
| `security` | 修复漏洞、权限越界或进行安全加固 |

允许的 scope：

```text
api ai-service desktop mobile contracts ui-kit config infra
```

示例：

```text
feat(api): add customer import endpoint
fix(ai-service): enforce tenant filter
test(mobile): cover offline synchronization
ci(infra): add pull request checks
docs(contracts): document API migration
```

要求：

- type 和 scope 使用英文小写；
- subject 简洁描述具体改动，不以句号结尾；
- 一个 commit 只包含一个逻辑目标；
- 避免 `update`、`fix bug`、`wip` 等模糊描述；
- 破坏性变更使用 `!`，并同步提供版本与迁移说明，例如 `feat(contracts)!: rename customer status field`。
