# 持续集成（CI）

主 CI 工作流位于 `.github/workflows/ci.yml`，覆盖仓库中的三套独立工具链。

## 触发方式

CI 在以下场景运行：

- 向 `main` 发起或更新 Pull Request；
- GitHub Merge Queue 创建待验证合并组时；
- 在 GitHub Actions 页面手动运行。

同一 PR 有新提交时，旧的未完成运行会自动取消，减少 Actions 时间消耗。

## 必需检查

工作流包含三个稳定命名的检查：

| GitHub 检查名称 | 验证内容 |
| --- | --- |
| `CI / Node (API + desktop)` | 安装 pnpm 依赖、生成 Prisma Client、API Jest、API 构建、桌面端生产构建 |
| `CI / Python (AI service)` | 安装 Python 依赖并运行 pytest |
| `CI / Flutter (mobile)` | 获取 Flutter 依赖、静态分析并运行 Flutter tests |

如果组织套餐支持私有仓库 Ruleset，应将以上三个检查配置为 `main` 的 required status checks。修改 workflow 或 job 的 `name` 后，也必须同步更新 GitHub Ruleset 中的检查名称。

## 手动运行

进入仓库的 `Actions` 页面，选择 `CI`，点击 `Run workflow`，选择要验证的分支后运行。

## 本地等价验证

Node.js 与 pnpm：

```bash
pnpm install --frozen-lockfile
pnpm --filter @workbench/api prisma:generate
pnpm --filter @workbench/api test
pnpm --filter @workbench/api build
pnpm --filter @workbench/desktop build
```

AI 服务：

```bash
cd apps/ai-service
python -m pip install -r requirements.txt pytest
python -m pytest -q
```

移动端：

```bash
cd apps/mobile
flutter pub get
flutter analyze
flutter test
```

## 契约验证现状

当前 `packages/contracts` 和 `packages/api-client` 尚未提供可执行的契约校验及客户端生成命令，因此 CI 暂未添加虚假的契约检查。接入根命令 `contracts:lint`、`contracts:gen` 和 `contracts:check` 后，应新增独立的 `CI / Contracts` job，并通过 `git diff --exit-code` 确认生成物已提交。

## 权限与安全

工作流只授予 `contents: read` 权限，checkout 也不保留 Git 凭据，因此 CI 无法直接向仓库或 `main` 推送代码。第三方 Flutter Action 后续可进一步固定到完整 commit SHA，并通过 Dependabot 定期更新。
