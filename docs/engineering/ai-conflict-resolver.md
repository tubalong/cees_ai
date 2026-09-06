# AI 合并冲突修复助手

> 状态：**已落地（半自动候选 PR 模式）**。工作流定义位于
> [`.github/workflows/ai-conflict-resolver.yml`](../../.github/workflows/ai-conflict-resolver.yml)。

## 目标与边界

此功能在 PR 与当前基线分支产生 Git 文本冲突时，使用 Codex 生成一个**草稿替代 PR**。它的职责是减少机械冲突处理工作，不是代替维护者决定产品、契约、数据或安全语义。

工作流不会：

- 推送 `main`；
- 修改原始 PR 分支；
- 自动 approve、标记 ready for review 或合并任何 PR；
- 对 fork 来源的 PR 签出或运行代码；
- 自动修改契约、Prisma、CI/部署、依赖锁文件、密钥配置等受保护路径。

候选 PR 必须按正常规则通过 CI 与目录 owner 的人工 Review 后，才能被合并。AI 的提交不改变 `apps/api` 作为业务事实源、`packages/contracts` 契约优先以及 Prisma migration 唯一演进路径等工程约束。

## 启用前配置

仓库管理员需要完成以下一次性设置：

1. 在 GitHub Actions secrets 中创建 `OPENAI_API_KEY`。该值只保存于 GitHub Secret，绝不提交 `.env` 或工作流文件。
2. 在仓库 **Settings → Actions → General** 允许工作流申请 `contents: write` 权限。该权限只授予工作流的 `publish` job，用于新建 `ai/conflict-pr-*` 分支和草稿 PR；分支保护仍应禁止直接推送 `main`。
3. 创建标签 `ai:resolve-conflict`（建议颜色 `D93F0B`）。
4. 确认 `main` 的 Ruleset/branch protection 仍要求现有 CI 检查和人工 Review；不要把该工作流本身配置成可绕过这些规则的 required check。

若要立即停用，禁用该 GitHub Actions workflow 或删除 `OPENAI_API_KEY` Secret；两者都不会影响主 CI。

## 使用方法

仅仓库中拥有 `write`、`maintain` 或 `admin` 权限的成员可触发。PR 必须来自本仓库分支，而不是 fork。

二选一：

1. 给冲突 PR 添加 `ai:resolve-conflict` 标签；或
2. 在 PR 讨论中发送一条内容完全为：

   ```text
   /ai resolve-conflict
   ```

工作流会重新获取 PR head 与当前 base SHA，并尝试 `git merge --no-commit --no-ff`。没有未解决冲突时，它只在原 PR 留言，不创建候选 PR。

有冲突时，Codex 仅在隔离的 GitHub-hosted Linux runner 中修改工作区并暂存补丁；其 job 不具备 `contents: write` 或 `pull-requests: write` 权限。随后工作流执行结构检查，使用另一个短生命周期 job 再次校验补丁，才创建：

```text
ai/conflict-pr-<原PR号>-<Actions运行号>
```

以及一个以原 base 分支为目标的 **draft replacement PR**。原 PR 会收到候选 PR 链接；维护者决定是否以候选 PR 替代原 PR。

## 受保护路径与失败语义

下列路径一旦出现在 AI 补丁中，工作流会失败且不推送候选分支：

| 类别 | 路径/文件 |
| --- | --- |
| CI 与部署 | `.github/**`、`infra/**` |
| 契约与生成物 | `packages/contracts/**`、`packages/api-client/**` |
| 数据库 | `apps/api/prisma/**` |
| Secret | `.env`、`.env.*` |
| 依赖锁定 | `pnpm-lock.yaml`、`package-lock.json`、`yarn.lock`、`poetry.lock`、`uv.lock`、`Pipfile.lock`、`pubspec.lock`、`Cargo.lock` |

以下情况也会阻止发布：PR 已关闭、触发者没有写权限、PR 来自 fork、base SHA 在处理过程中变化、仍存在 unmerged index entry、补丁为空、存在空白错误或变更文件中残留 Git 冲突标记。

这类阻止是预期的安全行为；工作流会回到原 PR 留言。维护者应人工解决，或在基线更新后重新触发。

## 验证与审查

AI job 只做不执行项目代码的结构检查：Git index 无冲突、受保护路径白名单、`git diff --check` 和冲突标记检查。它**不会**在拥有写入权限的 job 中安装依赖或执行来自 PR 的脚本。

候选 PR 创建后，现有 [CI](ci.md) 会像普通 PR 一样重新运行：API test/build、桌面端 build、AI service pytest 以及 Flutter analyze/test。涉及外部行为、权限/租户、安全、数据库或契约的任何决策，仍必须由对应 owner 复核，并按工程约定同步相关设计/API/迁移文档。

## 安全设计

- 触发器使用 `issue_comment` 与 `pull_request_target`，但在签出任何 PR 代码前先验证触发者权限、PR 状态以及同仓库来源。
- Codex 使用 `openai/codex-action@v1`、`workspace-write` sandbox 与 `drop-sudo` safety strategy；其 job 只有仓库读取和 PR 留言权限。
- 具有 `contents: write` 的 GitHub token 只存在于发布 job；Codex job 不具备该权限。发布 job 从 artifact 接收已验证的 patch，在不运行项目代码的情况下重新应用、重新校验、提交并推送唯一候选分支。
- PR 标题、评论、源码、fixture 和日志都被视为不可信数据，不能覆盖工作流中固定的 Codex 任务与受保护路径规则。
- 使用 GitHub-hosted 的一次性 Linux runner；不要把此工作流直接迁移到长驻 self-hosted runner，除非重新完成 runner 隔离审计。

该模式是第二道辅助，不是安全边界替代品：branch protection、CODEOWNERS、CI、Secret scanning 与人工审查必须继续启用。