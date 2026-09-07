# 持续集成（CI）

主 CI 工作流位于 `.github/workflows/ci.yml`，覆盖 pnpm、Python/uv、契约生成和 Flutter 工具链。

## 必需检查

| GitHub 检查名称 | 验证内容 |
| --- | --- |
| `CI / Node (API + desktop)` | 锁定安装、生成 AI 客户端、Prisma Client、在临时 pgvector PostgreSQL 执行全部 migration、NestJS Jest/build、桌面端 build |
| `CI / Python (AI service)` | Python 3.14、uv 锁定安装、Ruff、应用导入、pytest |
| `CI / Contracts` | OpenAPI lint、TypeScript/Pydantic 生成物漂移检查 |
| `CI / Flutter (mobile)` | Flutter 依赖、静态分析和存在测试时的 flutter test |

仓库 Ruleset 应使用上述稳定名称。修改 workflow/job 名称时必须同步更新 required status checks。

## 本地等价验证

```bash
pnpm install --frozen-lockfile
pnpm contracts:lint
pnpm contracts:check
pnpm --filter @cees/ai-service-client build
pnpm --filter @cees/api prisma:generate
pnpm --filter @cees/api test
pnpm --filter @cees/api build
pnpm --filter @cees/desktop build
```

AI 服务：

```bash
cd apps/ai-service
uv sync --locked
uv run ruff check app tests
uv run pytest -q
```

移动端：

```bash
cd apps/mobile
flutter pub get
flutter analyze
flutter test
```

Prisma 基线可在空测试数据库上通过 `pnpm --filter @cees/api prisma:migrate reset --force` 验证。数据库 URL 和所有 Secret 只从测试环境变量或平台 Secrets 注入。

## 权限与安全

主 CI 只授予 `contents: read`，checkout 不保留 Git 凭据。契约检查只重新生成并检查 diff，不会提交或推送代码。
