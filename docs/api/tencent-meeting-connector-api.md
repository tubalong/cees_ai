# 腾讯会议连接器 API 与迁移说明

## 1. 契约版本

腾讯会议连接器在公开契约 `0.38.0` 中切换为 Desktop 直连官方远程 MCP。CEES API 不再托管腾讯会议凭据，也不再代理或执行腾讯会议工具，只提供无副作用的 AI 调用规划。

这是破坏性变更。旧客户端必须升级，旧服务端 OAuth 连接不会自动迁移。

## 2. 当前接口

### `POST /assistant/connectors/tencent-meeting/plan`

用途：根据用户问题和 Desktop 从腾讯会议官方 MCP 动态发现的工具目录，生成最多三条工具调用计划。

请求：

```json
{
  "query": "取消我明天下午的周会",
  "tools": [
    {
      "toolId": "cancel_meeting",
      "name": "取消会议",
      "description": "取消指定会议",
      "parameters": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "meeting_id": { "type": "string" }
        },
        "required": ["meeting_id"]
      },
      "riskLevel": "DESTRUCTIVE",
      "requiresConfirmation": true
    }
  ]
}
```

响应：

```json
{
  "data": {
    "calls": [
      {
        "toolId": "cancel_meeting",
        "arguments": { "meeting_id": "meeting-id" }
      }
    ]
  }
}
```

约束：

- `query` 最大 10000 字符；
- 工具目录最多 128 项、序列化后最大 512 KiB；
- 工具 ID 必须匹配 `^[A-Za-z][A-Za-z0-9._-]{0,119}$` 且不能重复；
- 参数 Schema 顶层必须为 `object` 并包含对象型 `properties`；
- `READ` 必须对应 `requiresConfirmation=false`；`WRITE` 和 `DESTRUCTIVE` 必须对应 `true`；
- 目录超过 32 项时，服务端先让模型从不可信目录中选择最多 32 个候选，再规划正式调用；
- 返回调用只能引用请求目录中的工具，最多三条，完全重复调用会去重；
- 上游模型流未正常完成时返回网关错误，不返回不完整计划。

此接口不接收 Token、MCP URL、HTTP Header、腾讯会议账号、工具执行结果或任意外部凭据。返回计划没有副作用，Desktop 必须自行完成风险确认和 `tools/call`。

## 3. 已删除接口

`0.38.0` 删除：

| 方法 | 旧路径 | 替代方式 |
| --- | --- | --- |
| `POST` | `/connectors/tencent-meeting/authorization` | Desktop 打开 AI Skill 页面并在本地保存个人 Token |
| `GET` | `/connectors/tencent-meeting/oauth/callback` | 不再使用 CEES OAuth 回调 |
| `GET` | `/connectors/tencent-meeting/status` | Desktop 本地状态和 `tools/list` 验证 |
| `DELETE` | `/connectors/tencent-meeting/authorization` | Desktop 删除本地 `safeStorage` 密文 |
| `GET` | `/connectors/tencent-meeting/tools` | Desktop 调用官方 MCP `tools/list` |
| `POST` | `/connectors/tencent-meeting/executions` | Desktop 确认后调用官方 MCP `tools/call` |

删除的 OpenAPI Schema、生成客户端 Service 和 Model 不应继续被业务代码引用。

## 4. 会话上下文

`CreateTurnRequest.connectorContexts` 支持：

```json
{
  "provider": "TENCENT_MEETING",
  "toolId": "list_meetings",
  "toolName": "查询会议列表",
  "fetchedAt": "2026-09-23T08:00:00.000Z",
  "data": {}
}
```

该上下文只用于本轮回答，不是 CEES 权限、身份或正式业务事实。Desktop 在提交前负责结果脱敏和大小限制；每轮连接器上下文总数仍受会话契约限制。

## 5. 数据库与配置迁移

迁移文件：`apps/api/prisma/migrations/20260923040000_remove_tencent_meeting_oauth_backend/migration.sql`。

迁移删除：

- `tencent_meeting_connections`；
- `tencent_meeting_oauth_states`；
- `TencentMeetingTokenStatus`；
- `TencentMeetingConnectionState`。

部署前应确认不再需要旧服务端授权记录。迁移后不能从旧 Token 自动恢复连接，用户必须在 Desktop 当前设备重新粘贴个人 Token。

以下环境变量已废弃并从示例及部署编排中删除：

- `TENCENT_MEETING_SDK_ID`；
- `TENCENT_MEETING_CORP_ID`；
- `TENCENT_MEETING_SECRET`；
- `TENCENT_MEETING_REDIRECT_URI`；
- `TENCENT_MEETING_CREDENTIAL_ENCRYPTION_KEY`；
- 旧 Open API 地址、响应限制及 OAuth 相关腾讯会议配置。

## 6. 安全责任

- API：校验租户登录态、限制工具目录、生成无副作用计划、拒绝目录外调用；
- Desktop Main Process：保存 Token、发现工具、执行工具、限制网络地址和响应、清理敏感字段；
- Renderer：不持久化 Token，只发起连接、展示状态和写操作确认；
- 腾讯会议：验证个人 Token，并决定账号可见资源和允许操作。

详细运行时与产品流程见 [Desktop 连接器运行时](../architecture/connector-runtime.md) 和 [腾讯会议连接器](../product/tencent-meeting-connector.md)。
