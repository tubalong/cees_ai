# Assistant / Conversation API

> 公开契约版本：`0.22.0`  
> 契约事实源：[`packages/contracts/openapi/openapi.yaml`](../../packages/contracts/openapi/openapi.yaml)  
> 最后更新：2026-09-14

本文是前端接入 Assistant 的业务说明。字段、状态码和响应模型以 OpenAPI 为准；本文不替代生成的 API Client。

## 1. 定位与边界

Assistant 是 NestJS 提供的服务端会话与 AI 编排入口。NestJS 负责会话事实、租户/成员边界、权限、Tool Loop、幂等、状态、审计和正式资源写入；`ai-service` 只负责模型调用、工具调用建议、图片生成和文档结构化生成，不直接写 PostgreSQL 或 COS。

当前已接入的工具：

- `generate_image`：调用图片模型，上传生成结果到 COS，并登记 `FileObject`、`Resource(IMAGE)`、`ManagedImage`、`AIActionDraft` 和审计记录。
- `generate_document`：调用文档模型，把结构化 `DocumentSpec` 序列化为 Markdown，登记 `Resource(DOCUMENT)`、`ManagedDocument`、`AIActionDraft` 和审计记录。

额度预占/结算和人工审批流本次暂不实现。工具调用目前是 NestJS 的程序化批准（工具存在、权限和参数校验），不是等待人工点击的审批单。

## 2. 通用约定

- Base URL：`/api/v1`。
- 所有接口（健康检查除外）需要当前租户成员的 Bearer JWT。
- 会话只属于创建它的 `ownerMembershipId`；跨租户、跨成员访问统一按不存在处理。
- 成功的普通 JSON 响应使用项目统一包络：`{ success: true, data, requestId }`。
- 错误使用统一错误包络；稳定业务错误码位于 `error.code`（具体 envelope 以 OpenAPI 为准）。
- ID 使用 UUID；不要根据 User ID 推断 Membership ID。
- 会话删除是软删除，消息、工具调用、事件和审计事实保留；有运行中轮次时删除返回 `409 CONVERSATION_ACTIVE_TURN`。
- 标题更新和删除使用 `version` 乐观锁；版本不匹配返回 `409`。

## 3. 会话生命周期

### 3.1 创建会话

```http
POST /api/v1/conversations
Authorization: Bearer <access-token>
Content-Type: application/json
```

请求体（标题可省略）：

```json
{ "title": "项目周报助手" }
```

返回 `200`：`Conversation`，包含 `id`、`title`、`visibility`、`createdAt`、`updatedAt`、`lastTurnAt` 和 `version`。省略标题时，首轮成功完成后由服务端根据首条用户消息自动生成。

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

返回会话元数据和按时间升序排列的最近 100 条消息。消息的 `content` 是持久化文本；用户消息的图片引用在 `imageFileIds` 中。工具消息包含 `toolCallId`，工具产生的稳定资源引用通过 SSE `tool_result.resource` 获取，图片访问 URL 通过 `GET /api/v1/images/{imageId}` 按需生成。

### 3.4 修改会话标题

```http
PATCH /api/v1/conversations/{conversationId}
Authorization: Bearer <access-token>
Content-Type: application/json

{ "title": "新的标题", "version": 3 }
```

标题长度为 1～128 个字符。成功返回更新后的会话（版本变为 `4`）；版本冲突返回 `409 CONVERSATION_VERSION_CONFLICT`。

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
  "mode": "standard"
}
```

`content` 与 `imageFileIds` 至少提供一个；文本最多 262144 个字符；最多引用 8 张图片。服务端会再次校验图片 UUID、租户/成员归属、已完成上传状态、MIME（PNG/JPEG/WebP）和大小上限，然后在每次调用模型前动态生成短期 COS URL，转换为 ai-service 的多模态 `parts`：

```json
{ "type": "text", "text": "…" }
{ "type": "image_url", "image_url": { "url": "https://短期地址" } }
```

签名 URL 不写入会话、事件、ToolCall 或调用日志。

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
| `started` | 返回 request/conversation/turn 标识及上下文使用情况 |
| `status` | `reasoning`、`answering` 或 `tool_executing` 阶段 |
| `content_delta` | 增量回答文本；客户端按顺序拼接 `text` |
| `tool_call` | 模型提出工具建议；不代表已获准执行 |
| `tool_result` | 工具完成、失败或被拒绝；包含稳定 `resource` 引用或错误 |
| `usage` | 本次模型调用的 Token 指标 |
| `completed` | 本次轮次完成（无未处理工具调用） |
| `error` | 轮次失败或工具循环达到安全上限 |

ai-service 的 `completed` 表示一次模型调用完成；当该调用同时产生 `tool_call` 时，NestJS 先执行/拒绝工具并继续下一次模型调用，不能把该事件误认为整个 AssistantTurn 已完成。公开 SSE 只在最终回答完成后发送整个轮次的 `completed`。

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

`resource` 只含稳定资源类型和 ID，不含签名 URL。

## 5. 断线重连和取消

### 5.1 事件重放

```http
GET /api/v1/conversations/{conversationId}/turns/{turnId}/events?afterSeq=7
Authorization: Bearer <access-token>
Accept: text/event-stream
```

服务端先重放 `seq > afterSeq` 的已提交事件，再继续推送实时事件，直到轮次进入终态。`afterSeq` 必须是 `0` 或安全整数；非法值返回 `400 EVENT_SEQUENCE_INVALID`。客户端应保存最后一个成功处理的 `seq`，重连时原样提交。

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

生成图片的正式资源使用 `GET /api/v1/images/{imageId}` 读取。该接口在读取时校验当前租户和资源所有成员，并动态生成短期下载 URL；URL 过期后重新请求即可。

## 7. 当前稳定错误码（节选）

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` / `IDEMPOTENCY_KEY_INVALID` | 缺少或格式不合法的幂等键 |
| 400 | `MESSAGE_CONTENT_EMPTY` | 没有文本且没有图片 |
| 400 | `IMAGE_REFERENCE_INVALID` / `IMAGE_REFERENCE_NOT_FOUND` | 图片引用非法或不存在 |
| 400 | `PAGINATION_CURSOR_INVALID` / `EVENT_SEQUENCE_INVALID` | 游标或事件序号非法 |
| 403 | `IMAGE_REFERENCE_ACCESS_DENIED` | 无权使用被引用图片 |
| 404 | `CONVERSATION_NOT_FOUND` / `TURN_NOT_FOUND` | 不存在或不属于当前成员 |
| 409 | `CONVERSATION_VERSION_CONFLICT` | 会话版本冲突 |
| 409 | `CONVERSATION_ACTIVE_TURN` | 会话仍有执行中的轮次 |
| 409 | `TURN_NOT_CANCELLABLE` | 轮次已经结束 |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | 幂等键对应不同请求内容 |

完整错误模型和响应状态码以 OpenAPI 为准。

## 8. 前端接入检查清单

- 保存 `conversation.id` 和每个轮次的 `turnId`，不要用客户端本地会话 ID 替代服务端 ID。
- 创建轮次时始终发送新的 `Idempotency-Key`，重试同一提交必须复用原键。
- 按 `seq` 去重并持久化游标；重连使用 `events?afterSeq=N`。
- 收到 `tool_result.resource` 后按资源类型调用对应资源接口，不持久化签名 URL。
- 将 `completed`/`error` 作为轮次终止信号；普通网络断开不是取消。
- 不把 `ai-service` 内部地址、内部 Token 或模型名发送到客户端。
