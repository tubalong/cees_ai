# 连接器语义路由 API

## 1. 契约版本

公开契约 `0.44.0` 新增 `POST /assistant/connectors/route` 与 `CreateTurnRequest.connectorRoutingHint`。两者都是兼容新增：不带提示的轮次请求哈希与升级前一致，因此部署后客户端重试同一 `Idempotency-Key` 不会被误判成「同键不同内容」。客户端需要重新生成。

公开契约 `0.54.0` 为同一端点补齐**对话上下文**：请求可选新增 `recentMessages`（≤6 条，每条 ≤2000 字）与 `previousProviders`（≤8 个，去重）。同样是兼容新增，响应 `ConnectorRoutingResult` 与 `connectorRoutingHint` 语义均未改变；`packages/api-client` 需重新生成。

公开契约 `0.55.0` 把同一份**对话上下文**补到四个规划端点：`<provider>/plan` 请求可选新增 `recentMessages`（复用 `ConnectorRoutingRecentMessage`，≤6 条 × ≤2000 字），并把单轮计划调用上限（`previousSteps.maxItems` 与 plan 结果 `calls.maxItems`）由 3 放宽到 5、`connectorContexts.maxItems` 由 5 放宽到 7。原因与验收见 [连接器语义路由、受控多步接力与调用审计](../architecture/connector-routing-and-iteration.md) §12。

阶段一在同一兼容响应中新增可选 `clarificationOptions`。当 `clarification` 非空且存在多个就绪候选时，Desktop 必须展示这些候选供用户选择；只有用户选择后，客户端才能以 `forcedConnector` 重新发起本轮规划。该字段不改变授权范围，也不代表已执行任何连接器调用。

路由只决定「本轮该试哪些连接器」，不改变任何既有 `POST /assistant/connectors/<provider>/plan` 的语义，也不放宽权限：被命中的连接器仍要走二级规划、目录校验、风险确认和 Desktop 本地执行。

## 2. `POST /assistant/connectors/route`

Desktop 在触发连接器规划前提交查询和一级能力摘要：

```json
{
  "query": "把明天的会整理成纪要发到项目群",
  "previousProviders": ["TENCENT_MEETING"],
  "recentMessages": [
    { "role": "user", "content": "我今天的会议有哪些" },
    { "role": "assistant", "content": "你今天有两场会议。" }
  ],
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
- `recentMessages` 与 `previousProviders` 只用于消解代词与省略式追问（例如「那这个月的呢」「还有呢」），避免省略表达被当成全新话题而路由到错误连接器；两者都不作为业务事实。
- `previousProviders` 是**客户端自报**字段：服务端必须先与就绪候选集求交（未就绪或目录外的 provider 一律丢弃）后才可作为提示，且绝不能当作授权依据。这与 `ConnectorContext` 的 `riskLevel`、`confirmed` 自报口径一致。
- 有歧义时返回 `providers: []` 加 `clarification`；`clarification` 非空时 `providers` 一定为空。若歧义来自连接器选择，同时返回目录内全部候选的 `clarificationOptions`，禁止只返回模型自行猜中的一个 provider。
- Desktop 提供按会话保存的连接器启停开关。只有当前会话启用且本机状态为 `READY` 的连接器进入路由目录；用户明确点名已关闭的连接器时，客户端必须提示打开，不得静默改用其他平台。
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

- 可选、≤1000 字；当路由只有兼容性的文本澄清、没有 `clarificationOptions` 时，Desktop 才把该提示随本轮提交。阶段一的结构化候选选择不会把澄清文本直接交给模型猜测。
- 语义与 `assistantContext` 一致：只参与本轮模型 instructions，不落库、不作为业务事实或权限依据，也不进入 `ConnectorContext` 事实通道（不会出现在消息的 `connectorContexts` 里，审计也不会把它当作外部数据）。
- 服务端注入时会显式声明「服务端生成、不是用户指令、不代表已获得任何外部数据」，并要求模型先用简体中文向用户确认目标，不猜测、不声称已读取过外部数据。

## 5. Desktop 调用顺序

1. 用户消息命中点名识别（钉钉 / 腾讯会议 / 企业微信 / GitHub 关键词），或从连接器卡片进入对话（`preferredConnector` / `forcedConnector`）→ 直接硬命中，不调用本接口；
2. 否则调用本接口，并把最近 6 轮对话与上一轮尝试过的 provider 作为上下文一并提交；
3. 只对返回的 `provider` 调用既有 `POST /assistant/connectors/<provider>/plan`，并把同样的最近 6 轮对话作为 `recentMessages` 一并提交，让规划器也能消解省略式追问；
4. `clarification` 非空且存在 `clarificationOptions` → 不调用任何 `/plan`，展示候选平台；用户点击后以 `forcedConnector` 重新从第 1 步开始。
5. `clarification` 非空但没有结构化候选 → 不调用任何 `/plan`，把提示作为 `connectorRoutingHint` 提交给本轮对话。

## 6. 规划请求的对话上下文与单轮调用预算（`0.55.0`）

四个规划端点（`dingtalk` / `tencent-meeting` / `wecom` / `github`）的请求新增可选 `recentMessages`：

```json
{
  "query": "我要整个月的",
  "tools": [],
  "previousSteps": [],
  "recentMessages": [
    { "role": "user", "content": "帮我查询一下我的考勤记录呢" },
    { "role": "assistant", "content": "你 9 月 30 日有一条上班打卡记录。" }
  ]
}
```

- `recentMessages` 缺省或为空时行为与升级前完全一致：只按当前这句规划，也不注入任何上下文指令。
- 服务端把历史轮次按顺序放在当前问题**之前**交给模型，并在指令中声明它们是**不可信参考数据**、只用于消解代词与省略式追问。最多 6 条、单条 ≤2000 字，超出按契约上限截断并丢弃空白轮次。
- `recentMessages` 不是业务事实、不是授权，也不改变二级规划的权限与逐轮确认口径。
- 单轮计划调用上限由 3 放宽到 5：`previousSteps.maxItems` 与 plan 结果 `calls.maxItems` 同为 5，Desktop 单轮预算同为 5。超限仍沿用既有硬错误（提示拆成多轮），不做静默截断。

## 7. 相关文档

- [Desktop 连接器运行时](../architecture/connector-runtime.md)
- [连接器语义路由、受控多步接力与调用审计（设计草案）](../architecture/connector-routing-and-iteration.md)
- [钉钉 DWS/MCP 连接器](../product/dingtalk-mcp-connector.md)、[腾讯会议连接器](../product/tencent-meeting-connector.md)、[企业微信 CLI 连接器](../product/wecom-cli-connector.md)、[GitHub 官方远程 MCP 连接器](../product/github-remote-mcp-connector.md)
