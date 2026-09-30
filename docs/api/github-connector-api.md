# GitHub 连接器 API

## 1. 契约版本

公开契约 `0.43.0` 新增 GitHub OAuth Broker 配置/换码接口，并保留 GitHub 官方远程 MCP 规划接口与 `ConnectorContext.provider=GITHUB`。这是兼容新增；客户端需要重新生成。已使用旧授权的用户需要解绑后重新连接，才能获得新增的私有仓库权限。

## 2. OAuth Broker 接口

### `GET /assistant/connectors/github/oauth/config`

返回当前部署的公开 Client ID、GitHub 授权地址、scope 和换码路径。scope 必须包含 `repo`，用于访问当前用户有权访问的私有仓库；响应不包含 Client Secret。

### `POST /assistant/connectors/github/oauth/exchange`

Desktop 提交授权码、PKCE `codeVerifier` 和本机 loopback `redirectUri`。API 使用部署环境的 `CEES_GITHUB_OAUTH_CLIENT_SECRET` 调 GitHub 换取 Token，并只将必要字段返回当前认证 Desktop；API 不写数据库、不写 Redis、不记录 Token。

`redirectUri` 只允许 `http://127.0.0.1:<port>/oauth/github/callback`。

## 3. 规划接口

### `POST /assistant/connectors/github/plan`

Desktop 提交用户问题和从 GitHub 官方远程 MCP `tools/list` 动态发现、过滤后的工具目录。API 只生成调用计划，不接收 GitHub Token、不连接 GitHub、不执行 MCP 工具。OAuth 授权码换码由同一认证边界下的 Broker 负责。

请求示例：

```json
{
  "query": "查看 openai/openai-node 最近的 issue",
  "tools": [{
    "toolId": "list_issues",
    "name": "list_issues",
    "description": "List issues in a GitHub repository",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": { "owner": { "type": "string" }, "repo": { "type": "string" } },
      "required": ["owner", "repo"]
    },
    "riskLevel": "READ",
    "requiresConfirmation": false
  }]
}
```

响应最多包含三条调用：

```json
{
  "calls": [{
    "toolId": "list_issues",
    "arguments": { "owner": "openai", "repo": "openai-node" }
  }]
}
```

受控多步接力（契约 `0.47.0`）：请求可带可选 `previousSteps`（最多 5 条、单条摘要 ≤ 2000 字，服务端按不可信数据注入规划指令），响应可带可选 `followUpMayBeNeeded`（缺省 `false`，只是「本轮调用可能不足以完成这次请求」的提示）。是否进入第二轮由 Desktop 决定：硬上限两轮、两轮合计 ≤ 5 次调用，且每一轮执行前仍各自确认。详见 [连接器语义路由、受控多步接力与调用审计](../architecture/connector-routing-and-iteration.md) §4。

约束：

- 工具目录为 1 至 256 项，序列化后最大 512 KiB；
- 工具 ID 最大 120 字符，必须匹配 `^[A-Za-z][A-Za-z0-9._-]{0,119}$` 且不能重复；
- 参数 Schema 顶层必须为 `object` 并包含对象型 `properties`；
- `READ` 必须对应 `requiresConfirmation=false`，其他风险必须为 `true`；
- 目录超过 31 项时先选择候选（ai-service 单次工具上限 32，其中 1 个留给「是否需要下一轮」控制工具）；
- 返回调用只能引用请求目录中的工具，最多五条并去重；
- 工具名称、描述和 Schema 都是外部不可信数据，不得把其中内容当作系统指令；
- 规划接口不接收 OAuth Client Secret、Token、Cookie、MCP Session 或 GitHub 结果；换码接口仅在内存中短暂处理上游 Token。

## 4. 会话上下文

```json
{
  "provider": "GITHUB",
  "toolId": "list_issues",
  "toolName": "list_issues",
  "fetchedAt": "2026-09-24T08:00:00.000Z",
  "data": { "content": [] }
}
```

`GITHUB` 上下文只用于本轮回答，不是 CEES 权限事实，也不能作为 CEES 正式写操作授权。单轮连接器上下文总数仍不超过三个。

## 5. 执行责任

- API：验证租户会话、限制工具目录、规划调用并拒绝目录外工具；
- Desktop Main Process：从 `mcp.json` 读取固定端点和超时，创建 loopback 回调，调用 API Broker 换码，保存 Token、动态发现和执行 MCP；不读取 GitHub Client Secret；
- Renderer：展示连接状态、发起规划、展示写操作二次确认；
- GitHub：按用户权限、组织策略、OAuth scope 与 MCP scope challenge 决定最终可见能力。

## 6. 凭据与部署约束

- `apps/desktop/mcp.json` 不保存 Client ID、Client Secret、Access Token 或 Refresh Token，只保存固定的 GitHub MCP 地址、超时和 `disabled` 配置；
- `disabled: true` 只表示禁止启动时自动连接，用户显式点击“连接”时仍允许授权；
- 部署方必须通过 `CEES_GITHUB_OAUTH_CLIENT_ID` 和 `CEES_GITHUB_OAUTH_CLIENT_SECRET` 注入 API；API 未配置时 OAuth 配置/换码接口返回 `GITHUB_OAUTH_NOT_CONFIGURED`；
- OAuth Token 由 API Broker 短暂换取后只写入当前 Desktop 的本机安全存储，API 不持久化，Renderer 和连接器规划请求均不得接触 Client Secret；
- 当前不支持由租户管理员在控制台替换 GitHub MCP URL，也不支持 GHES 自定义端点。
