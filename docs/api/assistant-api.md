# Assistant / Conversation API

> 公开契约版本：`0.35.0`
> 契约事实源：[`packages/contracts/openapi/openapi.yaml`](../../packages/contracts/openapi/openapi.yaml)  
> 最后更新：2026-09-15

本文是前端接入 Assistant 的业务说明。字段、状态码和响应模型以 OpenAPI 为准；本文不替代生成的 API Client。

## 1. 定位与边界

Assistant 是 NestJS 提供的服务端会话与 AI 编排入口。NestJS 负责会话事实、租户/成员边界、权限、Tool Loop、幂等、状态、审计和正式资源写入；`ai-service` 只负责模型调用、工具调用建议、图片生成和文档结构化生成，不直接写 PostgreSQL 或 COS。

当前已接入的工具：

- `generate_image`：调用图片模型，上传生成结果到 COS，并登记 `FileObject`、`Resource(IMAGE)`、`ManagedImage`、`AIActionDraft` 和审计记录。
- `generate_docx` / `generate_pdf` / `generate_pptx`：调用文档模型生成结构化 `DocumentSpec`，渲染为对应格式并落 COS，登记 `Resource(DOCUMENT)`、`ManagedDocument`、`FileObject`、`AIActionDraft` 和审计记录；需 `ai.document.generate` 权限。
- `insert_document_image`：把本轮对话中已有的一张图片（用户上传附件或本轮船次生成的图片）插入到本会话内某份 AI 生成文档的指定章节末尾；只读 `DocumentSpec` 并在章节 `blocks` 尾部追加 `ImageBlock`，按原格式原位重渲染同一文档，正文不被改写。需 `ai.document.generate` 权限。
- `web_search`：调用 Tavily 搜索公开互联网资料，通过 `tool_result.sources` 返回可引用的网页来源，不产生正式业务资源。需要 `ai.web.search` 权限，当前仅默认授予租户管理员角色，其他角色由管理员在 RBAC 中显式授予。

额度预占/结算和人工审批流本次暂不实现。工具调用目前是 NestJS 的程序化批准（工具存在、权限和参数校验），不是等待人工点击的审批单。

## 2. 通用约定

- Base URL：`/api/v1`。
- 所有接口（健康检查除外）需要当前租户成员的 Bearer JWT。
- 会话只属于创建它的 `ownerMembershipId`；跨租户、跨成员访问统一按不存在处理。
- 成功的普通 JSON 响应使用项目统一包络：`{ success: true, data, requestId }`。
- 错误使用统一错误包络；稳定业务错误码位于 `error.code`（具体 envelope 以 OpenAPI 为准）。
- ID 使用 UUID；不要根据 User ID 推断 Membership ID。
- 会话删除是软删除，消息、工具调用、事件和审计事实保留；有运行中轮次时删除返回 `409 CONVERSATION_ACTIVE_TURN`。
- 删除使用 `version` 乐观锁；版本不匹配返回 `409`。标题更新不校验版本：每次发起轮次都会递增会话版本，客户端持有的版本必然过期，因此服务端忽略请求中的 `version`（字段保留仅为兼容老客户端）。

## 3. 会话生命周期

### 3.1 创建会话

```http
POST /api/v1/conversations
Authorization: Bearer <access-token>
Content-Type: application/json
```

请求体（标题和模式均可省略）：

```json
{ "title": "项目周报助手", "mode": "ultra" }
```

`mode` 是会话默认对话执行模式：`standard`（快速）或 `ultra`（深度）；省略时默认 `standard`。返回 `200`：`Conversation`，包含 `id`、`title`、`mode`、`visibility`、`createdAt`、`updatedAt`、`lastTurnAt` 和 `version`。省略标题时，首轮成功完成后由服务端根据首条用户消息自动生成。

### 3.2 查询“我的会话”列表

```http
GET /api/v1/conversations?limit=20&cursor=<nextCursor>
Authorization: Bearer <access-token>
```

只返回当前租户、当前成员拥有且未软删除的会话，按 `updatedAt DESC, id DESC` 排序。`limit` 范围为 `1..100`，默认 `20`。响应数据：

```json
{
  "items": [
    {
      "id": "…",
      "title": "项目周报助手",
      "mode": "standard",
      "visibility": "PRIVATE",
      "createdAt": "…",
      "updatedAt": "…",
      "lastTurnAt": "…",
      "version": 3
    }
  ],
  "nextCursor": "…"
}
```

没有下一页时 `nextCursor` 为 `null`。游标是服务端生成的不透明 Base64URL 字符串，客户端不要自行拼接或修改；非法游标返回 `400 PAGINATION_CURSOR_INVALID`。

### 3.3 查询会话详情

```http
GET /api/v1/conversations/{conversationId}
Authorization: Bearer <access-token>
```

返回会话元数据和最近 100 条消息。消息按轮次顺序升序排列（同一轮次内按写入时间排序），跨轮次迟到的工具消息归位到所属轮次，不会插入后续轮次。消息字段语义：

- `content` 是持久化文本，不携带任何签名 URL；
- 用户消息的图片引用（用户输入的附件）在 `imageFileIds` 中，展示/下载地址由前端通过文件接口按需获取；
- 工具消息（`role: TOOL`）携带 `toolCallId` 和 `resources`：`resources` 是工具产生的稳定正式资源引用（`IMAGE` 为 AI 生成图片、`DOCUMENT` 为 AI 生成文档），非 TOOL 消息为空数组；
- 工具消息还按轮次回传该轮的 `sources`（联网来源）与 `citations`（知识库引用）；前端按消息的 `turnId` 把它们挂回同一轮的助手回答，**不跨轮累积、不做会话级缓存**，避免上一轮的来源/引用串到当前回答下方；
- 图片访问 URL 通过 `GET /api/v1/images/{imageId}` 按需生成（短期有效，过期后重新请求即可），文档资源同理走对应资源接口。前端拿到 `resources` 后按需换取 URL，不要缓存或持久化签名 URL，历史消息中的图片/文档由此永久可恢复。图片只以服务端 `resources` 的稳定引用为准，**不从消息正文文本中猜测图片地址**。

### 3.4 修改会话标题

```http
PATCH /api/v1/conversations/{conversationId}
Authorization: Bearer <access-token>
Content-Type: application/json

{ "title": "新的标题" }
```

标题长度为 1～128 个字符。成功返回更新后的会话（版本号递增 `1`）；请求中的 `version` 是历史兼容字段，服务端忽略其值，老客户端照常携带也不会报错。

### 3.5 删除会话

```http
DELETE /api/v1/conversations/{conversationId}?version=4
Authorization: Bearer <access-token>
```

成功返回 `204 No Content`。删除只隐藏会话，不物理删除历史事实；存在 `RUNNING`/`RECEIVED` 轮次时返回 `409 CONVERSATION_ACTIVE_TURN`，应先取消轮次或等待其结束。

## 4. 发起对话轮次（SSE）

### 4.1 请求

```http
POST /api/v1/conversations/{conversationId}/turns
Authorization: Bearer <access-token>
Idempotency-Key: turn-<client-generated-key>
Content-Type: application/json
Accept: text/event-stream
```

请求体只描述本轮用户输入，不提交历史消息或摘要：

```json
{
  "content": "请看看这张图里的问题",
  "imageFileIds": ["<uploaded-file-object-id>"],
  "mode": "standard",
  "knowledgeBaseEnabled": false,
  "webSearchEnabled": false,
  "connectorContexts": [{
    "provider": "DINGTALK",
    "toolId": "dws_read_0123456789abcdef",
    "toolName": "attendance.record.get",
    "fetchedAt": "2026-09-20T08:00:00.000Z",
    "riskLevel": "READ",
    "confirmed": false,
    "data": { "date": "2026-09-20", "result": { "records": [] } }
  }]
}
```

`content` 与 `imageFileIds` 至少提供一个；文本最多 262144 个字符；最多引用 8 张图片。`mode` 为本轮对话执行模式：`standard`（快速）或 `ultra`（深度）；省略时使用创建会话时设置的会话默认模式。服务端会再次校验图片 UUID、租户/成员归属、已完成上传状态、MIME（PNG/JPEG/WebP）和大小上限，然后在每次调用模型前动态生成短期 COS URL，转换为 ai-service 的多模态 `parts`：

```json
{ "type": "text", "text": "…" }
{ "type": "image_url", "image_url": { "url": "https://短期地址" } }
```

签名 URL 不写入会话、事件、ToolCall 或调用日志；`tool_result` 事件与历史消息只携带稳定资源引用（`resource` / `resources`），访问 URL 一律由前端通过资源接口按需生成。

### 4.1.1 本轮能力开关

`knowledgeBaseEnabled` 与 `webSearchEnabled`（均可选、默认 `false`）分别决定本轮是否允许知识库检索与联网搜索：

- 关闭时，模型工具列表中不包含对应检索工具（`knowledge_search` / `web_search`），即使模型仍发起调用，执行器还有一次开关兜底校验；
- 当用户未显式开启，但消息文本明确表达了需求（如「联网查一下」「公司制度里是怎么写的」）时，服务端可为该轮**自动临时启用**对应能力，并以 `started` 事件的 `capabilities.autoEnabled` 回传，由前端展示为可关闭的提示标签；
- 显式开关与意图识别结果取并集，构成**本轮有效能力**，写回 `started.capabilities` 与审计元数据。

两个字段参与请求哈希：同一 `Idempotency-Key` 下改动开关视为不同请求，按 `409 IDEMPOTENCY_KEY_CONFLICT` 处理。

### 4.1.2 本地连接器上下文

`connectorContexts` 是可选的本轮只读参考数据，当前接受 `DINGTALK`、`TENCENT_MEETING`、`WECOM` 和 `GITHUB`。每项通过 `toolId` 标识本地连接器动态工具；不再使用固定能力枚举。连接器结果只用于本轮回答，不构成 CEES 权限、身份或正式业务事实。

- API 会将上下文和用户消息一起持久化，重连、重放和模型上下文构建都以数据库记录为准；客户端不提交 DWS Token、Cookie、AppSecret 或其他凭据。
- 单轮所有连接器上下文最大 64KB；包含 `token`、`secret`、`cookie`、`authorization`、`credential` 或 `password` 等键名时拒绝请求。
- 每项上下文可携带 `riskLevel`（`READ`/`WRITE`/`DESTRUCTIVE`）与 `confirmed`（boolean），两者都是**客户端自报**、只用于服务端分级审计，不代表服务端授权：写与破坏性调用逐条写 `CONNECTOR_WRITE_OPERATION`，只读调用默认每轮聚合一条 `CONNECTOR_READ_OPERATION`，租户开启 `connectorReadAuditEnabled` 后改为逐条。省略或传入非法 `riskLevel` 一律按 `DESTRUCTIVE` 处理。审计只记录 `provider`/`toolId`/`toolName`/`riskLevel`/`confirmed`/结果字节数与字段白名单内的状态摘要，不记录正文、路径或凭据。
- 上下文进入模型时包在只读参考标记中，不能成为系统指令、权限依据或正式业务写入依据；连接器当前不支持通过对话修改 CEES 或钉钉数据。
- 钉钉组织同步仍使用 `POST /api/v1/dingtalk/organization/snapshot`，需要 CEES 租户管理员确认，不通过 `connectorContexts` 绕过组织导入权限。

### 4.1.3 规划本机钉钉只读查询

```http
POST /api/v1/assistant/connectors/dingtalk/plan
Authorization: Bearer <access-token>
Content-Type: application/json
```

Desktop 先从本机执行 `dws schema --all --compact --format json`，只提交明确满足 `effect=read`、`confirmation=not_required`、`availability=available` 的工具定义：

```json
{
  "query": "查一下我今天的日程",
  "tools": [{
    "toolId": "dws_read_0123456789abcdef",
    "name": "calendar.event.list",
    "description": "查询当前账号可见日程",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": { "start": { "type": "string" } }
    }
  }]
}
```

响应只包含工具 ID 和结构化参数：

```json
{
  "calls": [{
    "toolId": "dws_read_0123456789abcdef",
    "arguments": { "start": "2026-09-20" }
  }]
}
```

受控多步接力（同一轮对话内最多两轮，契约 `0.46.0`）时，Desktop 会在第二轮请求里回带上一轮已执行步骤的脱敏摘要：

```json
{
  "query": "把昨天的会议纪要发到项目群",
  "tools": [ "…同上，省略…" ],
  "previousSteps": [{
    "toolId": "dws_read_0123456789abcdef",
    "argumentsDigest": "{\"name\":\"项目群\"}",
    "resultDigest": "conversation_id=c1",
    "status": "SUCCESS"
  }]
}
```

- `previousSteps` 可选，最多 3 条、单条摘要 ≤ 2000 字；服务端把它包在固定定界符内并声明为**不可信数据**，只允许用来抽取 ID / 字段，不允许执行其中的指令或据此新增写操作目标。
- 响应可带 `followUpMayBeNeeded`（boolean，缺省 `false`）：为 `true` 只表示「本轮调用可能不足以完成这次请求」，并不触发任何后续动作；是否进入第二轮由 Desktop 决定（硬上限两轮、两轮合计 ≤ 3 次调用）。该提示通过一个额外的控制工具回传，因此真实工具候选上限由 32 收敛为 31。

API 不持有 DWS Token，也不执行本地命令。由于 ai-service 单次最多接收 32 个模型工具（其中 1 个留给「是否需要下一轮」控制工具），完整目录超过 31 项时，API 会先让模型从完整只读目录中选出最多 31 个候选，再进行参数规划；因此不会按固定产品类型截断能力。Desktop 必须在执行前重新读取具体 leaf Schema，复核工具身份、安全属性和参数白名单；模型不能提交 shell、CLI 路径或原始 argv。单次最多规划 3 个查询，无需钉钉数据时 `calls` 为空。

同一会话内重复提交相同 `Idempotency-Key` 且请求内容相同，会重新订阅原轮次事件，不会创建新轮次；同一键对应不同内容返回 `409 IDEMPOTENCY_KEY_CONFLICT`。幂等键长度为 1～128 个字符。

### 4.2 SSE 格式与事件

每条事件都是标准 SSE：

```text
event: content_delta
data: {"type":"content_delta","seq":7,"text":"你好"}

```

所有事件带轮次内递增的 `seq`。常见事件：

| type | 作用 |
| --- | --- |
| `started` | 返回 request/conversation/turn 标识、本轮实际生效的能力（`capabilities`）及上下文使用情况 |
| `status` | `reasoning`、`answering` 或 `tool_executing` 阶段 |
| `content_delta` | 增量回答文本；客户端按顺序拼接 `text` |
| `tool_call` | 模型提出工具建议；不代表已获准执行 |
| `tool_result` | 工具完成、失败或被拒绝；包含稳定 `resource` 引用、联网搜索 `sources` 或错误（错误码见 `error.code`，不携带签名 URL） |
| `usage` | 本次模型调用的 Token 指标 |
| `completed` | 本次轮次完成（无未处理工具调用） |
| `related_questions` | 基于本轮答复生成的追问建议（至多 3 条、每条不超过 30 字），随回答一次产出并持久化到轮次，在 `completed` 之后到达 |
| `error` | 轮次失败或工具循环达到安全上限 |

ai-service 的 `completed` 表示一次模型调用完成；当该调用同时产生 `tool_call` 时，NestJS 先执行/拒绝工具并继续下一次模型调用，不能把该事件误认为整个 AssistantTurn 已完成。公开 SSE 只在最终回答完成后发送整个轮次的 `completed`。

`related_questions` 是可选事件：模型在一次回答中同时产出正文与追问（ai-service 剥离后随 `completed` 事件返回），NestJS 在公开 `completed` 事件之后立即追加（seq 递增），无追问则不出现。追问已持久化到轮次记录，重放事件流时按序恢复；客户端不应把 `related_questions` 视为轮次终止信号。SSE 连接在轮次终态后进入短暂宽限期等待该事件，之后自然关闭。

`started` 事件携带本轮实际生效的 `capabilities`：

```json
{
  "type": "started",
  "seq": 1,
  "turnId": "…",
  "mode": "standard",
  "capabilities": {
    "webSearch": true,
    "knowledgeBase": false,
    "autoEnabled": ["web_search"]
  }
}
```

`webSearch` / `knowledgeBase` 是合并显式开关与意图识别后的有效能力；`autoEnabled` 只包含由服务端因意图识别**自动启用**的能力（用户显式开启的不计入），供前端展示透明提示。旧客户端可忽略该字段。

工具结果示例：

```json
{
  "type": "tool_result",
  "seq": 9,
  "toolCallId": "…",
  "status": "completed",
  "resource": { "type": "IMAGE", "id": "…" },
  "error": null
}
```

`resource` 只含稳定资源类型和 ID，不含签名 URL；事件与历史消息一律不携带签名 URL，图片访问 URL 由前端经 `GET /api/v1/images/{imageId}` 按需生成。

工具失败/拒绝的语义：`status` 为 `failed`（执行失败）或 `rejected`（审批未通过，如缺少权限）时 `error` 携带稳定错误码（如 `PERMISSION_DENIED`）；回喂模型的工具摘要只使用服务端友好文案，不包含权限码、错误详情等内部信息，模型输出中也不会出现这些信息。

联网搜索的 `tool_result` 不携带 `resource`，改用 `sources` 数组返回公开网页来源：

```json
{
  "type": "tool_result",
  "seq": 9,
  "toolCallId": "…",
  "status": "completed",
  "resource": null,
  "sources": [
    {
      "id": "…:1",
      "title": "…",
      "url": "https://…",
      "domain": "…",
      "snippet": "…",
      "publishedAt": "…"
    }
  ],
  "error": null
}
```

`source.id` 是本次工具调用内稳定的来源 ID；模型回答只会引用 `sources` 中存在的 ID。来源不是 CEES 正式资源，不创建图片/文档等业务记录；旧客户端可忽略 `sources` 字段。

`web_search` 失败语义：角色缺少 `ai.web.search` 权限时 `status` 为 `rejected`、`error.code` 为 `PERMISSION_DENIED`；搜索服务未配置、超时、不可用或响应异常时 `status` 为 `failed`，`error.code` 为 `WEB_SEARCH_NOT_CONFIGURED` / `WEB_SEARCH_TIMEOUT` / `WEB_SEARCH_UNAVAILABLE` / `WEB_SEARCH_INVALID_RESPONSE`。搜索无结果不是失败，`sources` 为空数组，模型会向用户解释。

### 4.3 写操作待确认（`awaiting_confirmation`）

写工具（`riskLevel=WRITE` 且声明了确认钩子）**不会在轮次内执行**。服务端先把参数快照与预览落为待确认草稿，
再以 `tool_result` 事件返回，`status` 为 `awaiting_confirmation`：

```json
{
  "type": "tool_result",
  "seq": 9,
  "toolCallId": "…",
  "status": "awaiting_confirmation",
  "resource": null,
  "sources": [],
  "citations": [],
  "confirmation": {
    "draftId": "…",
    "toolName": "create_department",
    "title": "新建部门",
    "fields": [
      { "label": "部门名称", "value": "华东销售部" },
      { "label": "上级部门", "value": "销售中心" }
    ],
    "expiresAt": "2026-09-22T09:15:00.000Z"
  },
  "error": null
}
```

该状态下**副作用尚未发生**，业务数据没有任何变化。客户端应渲染确认卡片，由用户决定：

```text
POST /api/v1/assistant/action-drafts/{draftId}/confirm
POST /api/v1/assistant/action-drafts/{draftId}/cancel
```

两个接口**只接受 `draftId`**：参数快照保存在服务端，客户端无法在确认时替换业务参数。
响应为 `{ draftId, status, summary, resource }`，`status` ∈ `EXECUTED` / `FAILED` / `REJECTED`，
`summary` 是可直接展示的中文说明。

服务端保证（确认路径）：

- 草稿不属于当前成员 → `404`（不泄露草稿存在性）；
- 已过期 / 已处理 → `409`；过期后必须重新发起对话生成新草稿；
- **确认瞬间重新解析实时权限**并重新校验参数：创建草稿后被回收权限 → `403`，且草稿置 `REJECTED`；
- **确认瞬间重新核对成员状态**（停用 / 删除 / 租户停用）→ `403`；
- `PENDING_CONFIRMATION → CONFIRMED` 为条件更新抢占：重复确认 / 双击只执行一次，第二次返回 `409`；
- 执行收口会把草稿终态、`ToolCall` 终态、TOOL 消息、审计与 `tool_result` 事件在同一事务提交，
  并把事件**追加回原轮次**——因此重放 `events?afterSeq=N` 能看到
  `awaiting_confirmation → completed` 的完整演化，刷新页面不会停在待确认状态。

完整设计见 [AI 助手业务写操作](../product/assistant-business-tools.md)。

## 5. 断线重连和取消

### 5.1 事件重放

```http
GET /api/v1/conversations/{conversationId}/turns/{turnId}/events?afterSeq=7
Authorization: Bearer <access-token>
Accept: text/event-stream
```

服务端先重放 `seq > afterSeq` 的已提交事件，再继续推送实时事件，直到轮次进入终态；终态后连接进入短暂宽限期等待 `completed` 之后追加的 `related_questions` 事件，宽限期结束自然关闭。`afterSeq` 必须是 `0` 或安全整数；非法值返回 `400 EVENT_SEQUENCE_INVALID`。客户端应保存最后一个成功处理的 `seq`，重连时原样提交。

SSE 客户端断开只停止订阅，不取消后台轮次。若客户端库不能直接消费生成的普通 API Client 的 POST SSE 方法，应使用 Fetch/ReadableStream 适配器解析 SSE；生成 Client 仍可用于普通 JSON 接口。

### 5.2 取消轮次

```http
POST /api/v1/conversations/{conversationId}/turns/{turnId}/cancel
Authorization: Bearer <access-token>
```

仅 `RUNNING` 轮次可取消。服务端以数据库条件更新抢占终态，并收束未完成 ToolCall；已发生的外部 Provider/COS 副作用无法通过数据库事务回滚，可能被标记为 `RECOVERY_REQUIRED` 或 `ORPHANED`，由恢复/清理任务处理。轮次已终态时返回 `409 TURN_NOT_CANCELLABLE`。

## 6. 图片上传与引用

Assistant 不接受把任意公网 URL 直接写入消息。前端先走现有 File API：

1. `POST /api/v1/upload-sessions` 创建上传会话（`purpose=attachment`、`uploadMode=single`）。
2. 使用响应中的短期 PUT URL 上传原始图片。
3. `POST /api/v1/upload-sessions/{uploadSessionId}/complete`，由服务端 COS HEAD 校验实际 MIME 和大小并创建 `FileObject`。
4. 将返回的 `fileId` 放入 `CreateTurnRequest.imageFileIds`。

生成图片的正式资源使用 `GET /api/v1/images/{imageId}` 读取。该接口在读取时校验当前租户和资源所有成员，并动态生成短期下载 URL；URL 过期后重新请求即可。对话历史中的生成图片通过 TOOL 消息的 `resources` 字段（或 SSE `tool_result.resource`）拿到稳定资源 ID 后按同样方式恢复，不会因临时 URL 过期而变成裂图。

## 7. 当前稳定错误码（节选）

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` / `IDEMPOTENCY_KEY_INVALID` | 缺少或格式不合法的幂等键 |
| 400 | `MESSAGE_CONTENT_EMPTY` | 没有文本且没有图片 |
| 400 | `IMAGE_REFERENCE_INVALID` / `IMAGE_REFERENCE_NOT_FOUND` | 图片引用非法或不存在 |
| 400 | `PAGINATION_CURSOR_INVALID` / `EVENT_SEQUENCE_INVALID` | 游标或事件序号非法 |
| 403 | `IMAGE_REFERENCE_ACCESS_DENIED` | 无权使用被引用图片 |
| 404 | `CONVERSATION_NOT_FOUND` / `TURN_NOT_FOUND` | 不存在或不属于当前成员 |
| 409 | `CONVERSATION_VERSION_CONFLICT` | 会话删除时版本冲突 |
| 409 | `CONVERSATION_ACTIVE_TURN` | 会话仍有执行中的轮次 |
| 409 | `TURN_NOT_CANCELLABLE` | 轮次已经结束 |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | 幂等键对应不同请求内容 |
| 404 | `USER_MEMORY_NOT_FOUND` | 记忆不存在或不属于当前成员 |
| 409 | `USER_MEMORY_VERSION_CONFLICT` | 记忆修改/删除时版本冲突 |
| 400 | `USER_MEMORY_CONTENT_INVALID` / `USER_MEMORY_UPDATE_EMPTY` | 记忆内容为空或未提供修改字段 |

完整错误模型和响应状态码以 OpenAPI 为准。

## 8. 前端接入检查清单

- 保存 `conversation.id` 和每个轮次的 `turnId`，不要用客户端本地会话 ID 替代服务端 ID。
- 创建轮次时始终发送新的 `Idempotency-Key`，重试同一提交必须复用原键。
- 按 `seq` 去重并持久化游标；重连使用 `events?afterSeq=N`。
- 收到 `tool_result.resource` 后按资源类型调用对应资源接口，不持久化签名 URL。
- 将 `completed`/`error` 作为轮次终止信号；`related_questions` 在 `completed` 之后到达，不是终止信号；普通网络断开不是取消。
- 不把 `ai-service` 内部地址、内部 Token 或模型名发送到客户端。

## 9. 用户级记忆（User Memory）

跨会话的用户级长期记忆，只归属当前成员本人：AI 在对话中仅**提议**记忆内容，写入、修改与删除一律以本人操作为准并记录审计。记忆只做用户级不做租户级（租户级由知识库承载）；每人至多 30 条，按创建时间升序返回（即注入对话上下文的顺序）。设计详见 [用户级记忆设计文档](../architecture/user-memory.md)。

```http
GET /api/v1/user-memories
PATCH /api/v1/user-memories/{memoryId}
DELETE /api/v1/user-memories/{memoryId}?version={version}
Authorization: Bearer <access-token>
```

`PATCH` 请求体 `{ content?, type?, version }`：`content`（1–1000 字符）与 `type`（`PREFERENCE` / `FACT` / `DECISION` / `HABIT`）至少提供一个，`version` 用于乐观并发控制；不存在的记忆返回 `404 USER_MEMORY_NOT_FOUND`，版本不匹配返回 `409 USER_MEMORY_VERSION_CONFLICT`。`DELETE` 软删除记忆并保留审计事实，`version` 必填。列表接口返回全部未删除记忆（至多 30 条），不分页。

本接口只覆盖「查看、修改、删除」；记忆的自动提炼与注入由服务端在对话链路内完成，不提供客户端写入接口。
