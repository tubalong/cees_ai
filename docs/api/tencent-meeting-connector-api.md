# 腾讯会议连接器 API 与迁移说明

## 1. 契约版本

公开契约 `0.40.0` 将腾讯会议连接器语义从“Desktop 个人 Token + 官方远程 MCP”修正为“Desktop 托管官方 `@tencentcloud/tmeet` CLI + 浏览器 OAuth”。公开请求和响应 Schema 保持兼容，生成客户端需要重新生成以同步说明。

CEES API 不保存腾讯会议凭据、不下载或启动 CLI，也不执行腾讯会议操作，只生成无副作用调用计划。

## 2. 当前接口

### `POST /assistant/connectors/tencent-meeting/plan`

用途：根据用户问题和 Desktop 从固定版官方 CLI 帮助生成的工具目录，返回最多三条调用计划。

请求示例：

```json
{
  "query": "取消我明天下午的周会",
  "tools": [
    {
      "toolId": "meeting.cancel",
      "name": "取消会议",
      "description": "取消普通会议、周期会议或指定子会议",
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

响应示例：

```json
{
  "success": true,
  "data": {
    "calls": [
      {
        "toolId": "meeting.cancel",
        "arguments": { "meeting_id": "meeting-id" }
      }
    ]
  }
}
```

受控多步接力（契约 `0.47.0`）：请求可带可选 `previousSteps`（最多 3 条、单条摘要 ≤ 2000 字，服务端按不可信数据注入规划指令），响应可带可选 `followUpMayBeNeeded`（缺省 `false`，只是「本轮调用可能不足以完成这次请求」的提示）。是否进入第二轮由 Desktop 决定：硬上限两轮、两轮合计 ≤ 3 次调用，且每一轮执行前仍各自确认。详见 [连接器语义路由、受控多步接力与调用审计](../architecture/connector-routing-and-iteration.md) §4。

约束：

- `query` 最大 10000 字符；
- 工具目录最多 128 项，序列化后最大 512 KiB；
- 工具 ID 必须匹配 `^[A-Za-z][A-Za-z0-9._-]{0,119}$` 且不能重复；
- 参数 Schema 顶层必须为 `object` 并包含对象型 `properties`；
- `READ` 必须对应 `requiresConfirmation=false`；`WRITE` 和 `DESTRUCTIVE` 必须对应 `true`；
- 目录超过 31 项时先选择最多 31 个候选，再规划正式调用（ai-service 单次工具上限 32，其中 1 个留给「是否需要下一轮」控制工具）；
- 返回调用只能引用请求目录中的工具，最多三条，完全重复调用会去重；
- 上游模型流未完成时返回网关错误，不返回不完整计划。

接口不接收 OAuth Token、RefreshToken、CLI 路径、环境变量、下载地址、HTTP Header 或任意腾讯会议凭据。Desktop 必须在执行前再次校验本地工具目录，并对写操作获取明确确认。

## 3. Desktop 本地协议

Desktop 使用通用 Connector IPC：

- `cees:connector-list`
- `cees:connector-status`
- `cees:connector-connect`
- `cees:connector-disconnect`
- `cees:connector-tools`
- `cees:connector-execute`

已删除腾讯会议专用 `cees:tencent-meeting-connect-token` IPC。Renderer 不再提交或保存个人 Token。

连接流程由 Main Process 执行：

```text
install pinned CLI
-> tmeet auth login
-> browser OAuth
-> tmeet auth status
-> derive schemas from <group> <command> --help
```

## 4. 会话上下文

`CreateTurnRequest.connectorContexts` 示例：

```json
{
  "provider": "TENCENT_MEETING",
  "toolId": "meeting.list",
  "toolName": "查询待开始会议",
  "fetchedAt": "2026-09-23T08:00:00.000Z",
  "data": {}
}
```

该上下文只用于本轮回答，不是 CEES 权限、身份或正式业务事实。Desktop 在提交前负责脱敏和大小限制。

## 5. 迁移说明

`0.39.0` 已删除旧服务端腾讯会议 OAuth 数据表和执行接口；`0.40.0` 不新增数据库迁移。

升级 Desktop 后：

- 旧个人 Token 和 `credential.secure` 不迁移；
- 用户需要重新点击连接并完成官方浏览器 OAuth；
- CLI 凭据保存于 Electron `userData/connectors/tencent-meeting/config` 和 `data`；
- 解绑执行官方 logout，并删除上述 CEES 专属目录；
- API 继续只保留 `/assistant/connectors/tencent-meeting/plan`。

以下旧服务端配置继续保持废弃：

- `TENCENT_MEETING_SDK_ID`
- `TENCENT_MEETING_CORP_ID`
- `TENCENT_MEETING_SECRET`
- `TENCENT_MEETING_REDIRECT_URI`
- `TENCENT_MEETING_CREDENTIAL_ENCRYPTION_KEY`

## 6. 安全责任

- API：校验租户登录态、限制工具目录、生成无副作用计划、拒绝目录外调用；
- Desktop Main Process：固定版本安装、OAuth、Schema 生成、参数校验、确认、执行和结果脱敏；
- Renderer：只展示状态、连接进度和确认，不接触本地凭据；
- 腾讯会议官方 CLI：OAuth、Token 刷新、加密存储和 Open API 调用；
- 腾讯会议：决定账号可见资源、产品能力和允许操作。

详细流程见 [Desktop 连接器运行时](../architecture/connector-runtime.md) 和 [腾讯会议连接器](../product/tencent-meeting-connector.md)。
