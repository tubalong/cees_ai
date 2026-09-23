# 企业微信连接器 API

## 1. 契约版本

公开契约 `0.39.0` 新增企业微信官方 CLI 动态工具规划，并扩展会话连接器上下文的 provider。该版本是兼容新增，但客户端必须重新生成以获得企业微信模型和规划方法。

## 2. 规划接口

### `POST /assistant/connectors/wecom/plan`

Desktop 提交用户问题和从本机官方 CLI 动态发现、过滤后的工具目录，API 返回最多三条无副作用调用计划。

请求示例：

```json
{
  "query": "列出我今天的企业微信日程",
  "tools": [
    {
      "toolId": "calendar.schedules.list",
      "name": "calendar.schedules.list",
      "description": "查询日程列表",
      "parameters": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "begin_time": { "type": "string" }
        }
      },
      "riskLevel": "READ",
      "requiresConfirmation": false
    }
  ]
}
```

响应示例：

```json
{
  "success": true,
  "data": {
    "calls": [
      {
        "toolId": "calendar.schedules.list",
        "arguments": { "begin_time": "2026-09-23T00:00:00+08:00" }
      }
    ]
  },
  "requestId": "request-id"
}
```

约束：

- `query` 为 1 至 10000 字符；
- 工具目录为 1 至 256 项，序列化后最大 512 KiB；
- 工具 ID 最大 120 字符，匹配 `^[A-Za-z][A-Za-z0-9._-]{0,119}$` 且不能重复；
- 参数 Schema 顶层必须为 `object` 并包含对象型 `properties`；
- `READ` 必须对应 `requiresConfirmation=false`，其余风险必须为 `true`；
- 目录超过 32 项时先选择最多 32 个候选；
- 返回调用只能引用请求目录中的工具，最多三条，完全重复调用会去重；
- API 把工具描述和 Schema 视为不可信输入，不接受其中的指令；
- API 不接收 CLI 配置目录、二维码、机器人凭据、Cookie、Token 或命令执行结果。

## 3. 会话上下文

`CreateTurnRequest.connectorContexts[].provider` 新增 `WECOM`：

```json
{
  "provider": "WECOM",
  "toolId": "calendar.schedules.list",
  "toolName": "calendar.schedules.list",
  "fetchedAt": "2026-09-23T08:00:00.000Z",
  "data": {}
}
```

每轮所有连接器上下文合计最多三项。该数据只用于生成本轮回答，不是 CEES 权限、身份或正式业务事实，也不能作为后续写操作授权。

## 4. 执行责任

- API：验证租户登录态、限制目录、生成无副作用计划、拒绝目录外调用；
- Desktop Main Process：安装和调用 CLI、保管授权、动态发现工具、执行确认闸口、结果脱敏与限长；
- Renderer：展示二维码和状态、发起规划、展示写操作确认，不读取凭据；
- 企业微信：验证扫码授权并决定机器人可见资源和允许操作。

详细流程见 [企业微信 CLI 连接器](../product/wecom-cli-connector.md) 和 [Desktop 连接器运行时](../architecture/connector-runtime.md)。
