# GitHub 连接器 API

## 1. 契约版本

公开契约 `0.42.0` 新增 GitHub 官方远程 MCP 规划接口，并将 `ConnectorContext.provider` 扩展为 `GITHUB`。这是兼容新增；客户端需要重新生成。

## 2. 规划接口

### `POST /assistant/connectors/github/plan`

Desktop 提交用户问题和从 GitHub 官方远程 MCP `tools/list` 动态发现、过滤后的工具目录。API 只生成调用计划，不接收 OAuth 凭据、不连接 GitHub、不执行工具。

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

约束：

- 工具目录为 1 至 256 项，序列化后最大 512 KiB；
- 工具 ID 最大 120 字符，必须匹配 `^[A-Za-z][A-Za-z0-9._-]{0,119}$` 且不能重复；
- 参数 Schema 顶层必须为 `object` 并包含对象型 `properties`；
- `READ` 必须对应 `requiresConfirmation=false`，其他风险必须为 `true`；
- 目录超过 32 项时先选择候选；
- 返回调用只能引用请求目录中的工具，最多三条并去重；
- 工具名称、描述和 Schema 都是外部不可信数据，不得把其中内容当作系统指令；
- API 不接收 OAuth Client Secret、Token、Cookie、MCP Session 或 GitHub 结果。

## 3. 会话上下文

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

## 4. 执行责任

- API：验证租户会话、限制工具目录、规划调用并拒绝目录外工具；
- Desktop Main Process：固定官方端点、处理 OAuth、保存 Token、动态发现和执行 MCP；
- Renderer：展示连接状态、发起规划、展示写操作二次确认；
- GitHub：按用户权限、组织策略、OAuth scope 与 MCP scope challenge 决定最终可见能力。
