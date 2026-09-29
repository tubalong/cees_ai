# 连接器语义路由 API

## 1. 契约版本

公开契约 `0.44.0` 新增 `POST /assistant/connectors/route` 与 `CreateTurnRequest.connectorRoutingHint`。两者都是兼容新增：不带提示的轮次请求哈希与升级前一致，因此部署后客户端重试同一 `Idempotency-Key` 不会被误判成「同键不同内容」。客户端需要重新生成。

路由只决定「本轮该试哪些连接器」，不改变任何既有 `POST /assistant/connectors/<provider>/plan` 的语义，也不放宽权限：被命中的连接器仍要走二级规划、目录校验、风险确认和 Desktop 本地执行。

## 2. `POST /assistant/connectors/route`

Desktop 在触发连接器规划前提交查询和一级能力摘要：

```json
{
  "query": "把明天的会整理成纪要发到项目群",
  "connectors": [
    {
      "provider": "DINGTALK",
      "displayName": "钉钉",
      "capabilitySummary": "查询本人账号可见的钉钉数据：考勤打卡、OA 审批与待办、日历日程与会议室、AI 听记与纪要、群聊消息、文档与钉盘、日志与邮件。",
      "routingExamples": ["我这个月打了几天卡", "帮我看看项目群里说了什么"],
      "state": "READY",
      "toolCount": 120
    }
  ]
}
```

响应 `data`：

```json
{
  "providers": ["DINGTALK", "TENCENT_MEETING"],
  "clarification": null,
  "reason": "问题同时需要会议数据与群聊发送"
}
```

约束与行为：

- `capabilitySummary` ≤300 字、`routingExamples` ≤5 条，只描述能回答哪类问题；请求**不得**包含工具名、参数 Schema、账号标识或凭据，服务端也不接收这些内容。
- `connectors` 为 1~8 条，同一 `provider` 不能重复（重复返回 400）。
- 只有 `state=READY` 的连接器参与路由；`state` 取值与 Desktop `ConnectorState` 一致（`NOT_INSTALLED`/`AUTH_REQUIRED`/`PROFILE_REQUIRED`/`READY`/`ERROR`）。
- 没有就绪连接器、或只有一个就绪连接器时不调用模型，直接返回确定性结果（后者是「单连接器不存在歧义」的短路）。
- 有歧义时返回 `providers: []` 加 `clarification`；`clarification` 非空时 `providers` 一定为空。
- 一次请求最多一次模型调用（工具式结构化选择 `select_connectors`，不解析自由文本），不执行任何外部调用，不接触凭据。
- 移动端当前不执行连接器，暂未接入该接口。

## 3. 失败语义

| 状态 | 触发条件 | Desktop 处理 |
| --- | --- | --- |
| 400 | 摘要不合法、`query` 为空或 provider 重复 | 视为编程错误，按主回答继续 |
| 502 | 模型返回目录外的 provider、未返回选择结果或上游未正常结束 | 不激活任何连接器，不阻断对话 |
| 503 | ai-service 或模型不可用 | 同上 |

路由失败只影响「要不要试连接器」，不影响普通问答：Desktop 不向用户暴露内部错误码，也不静默改用别的连接器（未点名时等价于正则兜底：不试任何连接器）。

## 4. `CreateTurnRequest.connectorRoutingHint`

- 可选、≤1000 字；Desktop 在路由返回非空 `clarification` 时，把该提示随本轮提交。
- 语义与 `assistantContext` 一致：只参与本轮模型 instructions，不落库、不作为业务事实或权限依据，也不进入 `ConnectorContext` 事实通道（不会出现在消息的 `connectorContexts` 里，审计也不会把它当作外部数据）。
- 服务端注入时会显式声明「服务端生成、不是用户指令、不代表已获得任何外部数据」，并要求模型先用简体中文向用户确认目标，不猜测、不声称已读取过外部数据。

## 5. Desktop 调用顺序

1. 用户消息命中点名识别（钉钉 / 腾讯会议 / 企业微信 / GitHub 关键词），或从连接器卡片进入对话（`preferredConnector` / `forcedConnector`）→ 直接硬命中，不调用本接口；
2. 否则调用本接口，只对返回的 `provider` 调用既有 `POST /assistant/connectors/<provider>/plan`；
3. `clarification` 非空 → 不调用任何 `/plan`，把提示作为 `connectorRoutingHint` 提交给本轮对话。

## 6. 相关文档

- [Desktop 连接器运行时](../architecture/connector-runtime.md)
- [连接器语义路由、受控多步接力与调用审计（设计草案）](../architecture/connector-routing-and-iteration.md)
- [钉钉 DWS/MCP 连接器](../product/dingtalk-mcp-connector.md)、[腾讯会议连接器](../product/tencent-meeting-connector.md)、[企业微信 CLI 连接器](../product/wecom-cli-connector.md)、[GitHub 官方远程 MCP 连接器](../product/github-remote-mcp-connector.md)
