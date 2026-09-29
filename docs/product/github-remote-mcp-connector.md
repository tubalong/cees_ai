# GitHub 官方远程 MCP 连接器

## 1. 当前状态

GitHub 连接器采用 GitHub 官方远程 MCP 服务、GitHub OAuth、官方 MCP SDK 和 Desktop 本地执行。当前支持 `github.com`，暂不支持 GHES。连接器用于查询和管理当前 GitHub 账号有权访问的公开、私有仓库、代码、提交、Issue、Pull Request 与 Actions，并支持基于提交记录生成总结。

- 固定远程端点：`https://api.githubcopilot.com/mcp/`；用户不能在配置或对话中替换端点；
- Desktop Main Process 使用 `@modelcontextprotocol/sdk@1.30.1` 完成 Streamable HTTP、初始化、会话、OAuth PKCE、刷新令牌和断线重连；
- OAuth 回调使用 `127.0.0.1` 动态端口，State 由本地回调服务校验；
- GitHub OAuth Client ID 和 Client Secret 由 API 部署方通过 `CEES_GITHUB_OAUTH_CLIENT_ID`、`CEES_GITHUB_OAUTH_CLIENT_SECRET` 提供，不能把真实值提交到仓库；GitHub OAuth 授权请求必须包含 `repo` scope，才能访问用户有权限的私有仓库；
- Desktop 通过已认证的 CEES API 获取公开 Client ID，并将授权码和 PKCE verifier交给 API Broker 换码；Client Secret 永远不进入 Desktop、Renderer、OpenAPI 请求体或对话上下文；
- Token 只保存在当前电脑的 Electron `safeStorage` 加密文件 `userData/connectors/github/oauth.secure`，不会上传 `apps/api`；
- Desktop 连接后调用 `tools/list` 动态发现工具，最多接收 256 个工具；API 只规划调用，Desktop 执行；
- `READ` 工具直接执行，`WRITE` 和 `DESTRUCTIVE` 工具在外部调用前必须二次确认；未知风险按 `DESTRUCTIVE` 处理；
- 结果移除 Token、Secret、Cookie、Authorization、私钥、Blob/Base64 等敏感内容，并限制为本轮上下文；
- 解绑只删除本机 CEES Token 和工具缓存，不等同于撤销 GitHub 侧 OAuth；撤销 GitHub 授权需要用户到 GitHub Settings 的 Applications 中操作。

## 2. 架构边界

```text
Renderer
  -> CEES API OAuth Broker (config / code exchange)
  -> ConnectorHost
    -> GitHubConnectorAdapter
      -> GitHub official remote MCP
        -> GitHub OAuth token (Desktop Main Process only)

Renderer -> POST /assistant/connectors/github/plan
  -> GitHubConnectorPlannerService
    -> only plans calls; never receives token or invokes GitHub
```

`apps/api` 仍是 CEES 正式业务数据的唯一事实源。GitHub 查询结果只作为本轮 `ConnectorContext(provider=GITHUB)` 参考上下文，不自动同步为 CEES 仓库、项目、任务或其他正式资源。任何 CEES 正式写入必须另走版本化业务 API、权限校验、幂等和审计链路。

## 3. 授权与权限

1. 用户在连接器市场点击 GitHub 卡片的“+”或详情页“连接”；
2. Renderer 使用当前 CEES 登录态读取 API Broker 的公开 OAuth 配置；
3. Main Process 创建本机 loopback 回调、生成 PKCE 参数并打开 GitHub 官方授权页面；
4. 回调校验 `state` 后，Main Process 将授权码、verifier 和 loopback redirect URI 发给 API Broker；
5. API 使用部署环境的 Client Secret 向 GitHub 换码，不持久化 GitHub Token，再把必要 Token 返回当前 Desktop；
6. Desktop 将 Token 写入安全存储，重新建立 MCP 会话并发现工具，状态显示 GitHub login 和工具数量；
7. 实际可访问内容由 GitHub 用户权限、组织策略、OAuth scope 以及 GitHub MCP 的 scope challenge 共同决定，连接成功不表示所有仓库或所有工具都可用。已使用旧授权且只有 `public_repo` 的用户需要解绑后重新连接。

GitHub Resource Metadata 可能声明多个支持的 scope。CEES 同时固定请求包含 `repo` 的授权范围；官方 MCP SDK 按 MCP 资源元数据和服务端 `WWW-Authenticate` challenge 选择授权 scope，因此 CEES 不把“最小 scope”伪装成固定保证；产品页面只展示连接状态，不承诺全量仓库访问。

## 4. 动态工具与对话

1. Desktop 使用固定 `X-MCP-Toolsets` 请求头选择 `context,issues,pull_requests,repos,users,actions,notifications` 工具集；其中 `repos` 覆盖仓库、代码和提交查询，返回结果可用于生成提交总结；
2. MCP `tools/list` 返回工具后，Desktop 校验名称、描述、顶层参数 Schema 和工具数量；
3. API 将工具目录当作不可信数据，最多选择 32 个候选并生成最多 3 个调用，只允许引用本次目录中的工具；目录超过候选上限时，先固定保留 `search_repositories`、`list_commits`、`get_commit`、`get_file_contents`、`list_branches`、`search_code`、`list_pull_requests`、`get_pull_request`、`list_issues`、`get_issue` 等仓库类只读工具，再由选择器补充其他候选；
4. 规划指令要求仓库、代码、提交、PR、Issue 类问题必须调用仓库类工具并显式传入 `is:private` 之类的可见性过滤条件，禁止只凭 `get_me` 返回的 `public_repos`、followers 等账号公开资料作答；
5. API 下发给模型的工具名是 `github_tool_<序号>`，真实 MCP 工具名和风险标记写在描述里，描述按 ai-service 的 2048 字符上限截断，规划结果再映射回真实工具名；
6. Desktop 在执行前重新发现并校验工具，防止旧计划调用已变化的目录；
7. 结果脱敏和限长后注入本轮对话。查询不会写入 CEES 数据库中的业务资源。

工具风险规则：工具 annotations 的 `readOnlyHint=true` 优先判为 `READ`，`destructiveHint=true` 判为 `DESTRUCTIVE`；否则按名称识别 `get/list/search/read/fetch` 等读取动作、`delete/remove/merge/run` 等破坏动作和 `create/update/edit` 等写动作；无法识别的工具按 `DESTRUCTIVE`。

## 5. 配置与部署

示例环境文件只包含：

```env
CEES_GITHUB_OAUTH_CLIENT_ID=change_me
CEES_GITHUB_OAUTH_CLIENT_SECRET=change_me
```

`apps/desktop/mcp.json` 只保存固定远程 MCP URL、超时和默认禁用标志：`disabled=true` 表示不自动连接，不阻止用户点击“连接”手动启用。API 部署环境通过 `CEES_GITHUB_OAUTH_CLIENT_ID` 和 `CEES_GITHUB_OAUTH_CLIENT_SECRET` 配置 OAuth App；部署编排必须将这两个变量显式注入 API 容器，Desktop 不读取这两个环境变量，而是通过 `GET /assistant/connectors/github/oauth/config` 获取公开配置，并通过 `POST /assistant/connectors/github/oauth/exchange` 完成授权码换码。API 不持久化 GitHub Token，Desktop 只将当前用户 Token 保存到本机安全存储。部署方需要创建 GitHub OAuth App（不是仅配置为公开仓库的授权方案），确认授权请求包含 `repo` scope，并配置与官方允许的 loopback 回调规则一致的回调地址。已授权但只有 `public_repo` 的用户必须解绑并重新授权。不得把 Client Secret、Access Token、Refresh Token 或个人 OAuth 值写入仓库、OpenAPI、Renderer 或普通日志。

## 6. 暂不支持

- GitHub Enterprise Server（GHES）自定义端点；
- 让租户管理员在 CEES 控制台替换 GitHub MCP URL；
- 通过 MCP 结果自动创建或修改 CEES 正式业务数据；
- 在 API 或数据库托管 GitHub OAuth Token；
- 绕过 Desktop 二次确认直接执行写操作。

API 契约见 [GitHub 连接器 API](../api/github-connector-api.md)，通用边界见 [Desktop 连接器运行时](../architecture/connector-runtime.md)。
