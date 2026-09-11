# 公开 AI 对话链路与 Token 计量

> 状态：已实现，但本文描述的 `/chat/*` 公开接口自契约 0.17.0 起已删除，会话与流式接口由 [AI 助手工具循环](assistant-tool-loop.md) 的 `/conversations/*` 取代；Token 计量组件（`AiInvocationRecorderService`）与 ai-service 内部 Chat 契约仍然有效。本文保留为历史记录。最后更新：2026-09-11。公开契约版本：`0.15.0`。

## 1. 目标与本期边界

本功能打通以下链路：

```text
桌面端/移动端本地会话数据
  → NestJS 公开 Chat API
  → ai-orchestration 内部适配层
  → ai-service 专用 Chat 接口
  → NestJS 记录模型与 Token 指标
  → 客户端保存回答或摘要到本地
```

本期明确实现：

- 当前租户成员通过公开 API 发起非流式对话、SSE 流式对话和历史压缩；
- API 从 JWT 与 `TenantContext` 注入 `tenantId/userId/membershipId`；
- API 按企业、成员、客户端本地会话和本地轮次记录模型调用与 Token；
- 客户端负责在本机保存 Conversation、Message 和摘要；
- 同一轮的压缩与回答通过同一 `turnId` 关联。

本期明确不实现：

- 服务端 Conversation/Message/摘要表；
- 对话历史上传、云端备份或多端同步；
- 企业套餐、坑位费、席位级额度、成员额度分配、额度预占、扣减或超额拦截；
- Provider、模型、Profile、temperature、reasoning effort 或系统指令的前端覆盖；
- 自动重试会产生 Token 成本的 Chat POST 请求。

因此，当前 `AIInvocationLog` 是“实际用量指标”，不是“额度账户”或“账单”。后续额度体系可以复用这些指标，但必须另行设计套餐、计费周期、席位权益、预占、结算和并发一致性。

## 2. 公开接口

所有路径相对于 `/api/v1`，均要求租户 Access Token 和有效 `TenantMembership`：

| 接口 | 用途 | 成功响应 |
| --- | --- | --- |
| `POST /chat/invoke` | 生成完整 Assistant 回答 | 项目统一 JSON 成功包络 |
| `POST /chat/stream` | 流式生成 Assistant 回答 | `text/event-stream`，不套 JSON 成功包络 |
| `POST /chat/compact` | 将本地历史压缩为摘要 | 项目统一 JSON 成功包络 |

公开请求只接受：

- `conversationId`：客户端本地会话标识；
- `turnId`：客户端本地轮次标识；
- `mode`：`standard` 或 `ultra`，默认 `standard`；
- `conversationSummary` 或 `previousSummary`；
- 按时间排序的 `user/assistant` 消息。

公开请求不接受租户、用户、成员、内部 Token、系统指令、Provider 或模型字段。即使客户端篡改 JSON，DTO 白名单与 `forbidNonWhitelisted` 也会拒绝额外字段，避免越过 API 的可信边界。

正式字段、长度限制、默认值、事件联合和错误响应以 `packages/contracts/openapi/openapi.yaml` 为准。

## 3. 内部接口映射

公开 API 只调用 ai-service 的专用 Chat 接口，不用通用 `invokeLlm` 伪装对话：

| 公开 API | ai-service 内部 SDK | 记录的 operation |
| --- | --- | --- |
| `/chat/invoke` | `invokeChat` | `chat.invoke` |
| `/chat/stream` | `streamChat` | `chat.stream` |
| `/chat/compact` | `compactChat` | `chat.compact` |

原有通用调用继续使用 `invokeLlm` 和 `generic.invoke`，外部行为不变。

## 4. 可复用计量组件

Token 写入从原 `AiServiceClientService` 的内联 Prisma 代码中抽出为 `AiInvocationRecorderService`：

```text
generic.invoke ─┐
chat.invoke ────┤
chat.stream ────┼→ AiInvocationRecorderService → AIInvocationLog
chat.compact ───┘
```

记录器只接受身份、关联 ID、操作类型、模型执行元数据、Token 和受限的标量指标字段，没有任意 JSON、消息正文或摘要参数，从接口结构上降低敏感内容误写数据库的风险。

每次实际模型调用最多写一条对应 operation 的日志：

- 非流式调用在 ai-service 成功返回后写入，再向客户端返回成功；
- 非流式调用若模型已执行但回答/摘要被业务校验拒绝，ai-service 在内部错误体的可选 `execution` 中返回模型与 Token，API 仍写入一次失败用量；
- 流式调用在 `completed` 前写入，再转发完成事件；
- 流式失败或取消在上游已经提供模型元数据后也写入一次；Provider 尚未报告 Token 时对应字段为 `null`，避免把“未知”误写成 `0`；
- 上游拒绝请求且没有执行模型时不写 Token 日志；
- 客户端重新发起请求属于新的真实模型调用，不能仅按 `turnId` 去重，否则会漏计实际消耗。
- 单次流式调用的指标写入最多尝试一次；写入失败时不在清理阶段再次写入或重跑模型，避免一次真实调用产生重复日志。

同一 `turnId` 可能有一条 `chat.compact` 和一条 `chat.invoke` 或 `chat.stream`。统计“一轮共使用多少 Token”时，应对这些日志求和，不能只取其中一条。

## 5. 数据模型与迁移

本功能不新建会话表，只通过迁移 `0009_ai_chat_token_tracking` 给现有 `ai_invocation_logs` 增加三个可空字段：

| 字段 | 含义 |
| --- | --- |
| `membership_id` | 发起调用时的租户成员身份快照 |
| `conversation_id` | 客户端本地会话标识 |
| `turn_id` | 客户端本地轮次标识 |

这些字段保持可空，已有 `generic.invoke` 和历史数据无需回填。`membership_id` 不建立级联外键：调用日志是不可随成员移除而丢失的历史指标，字段保存调用发生时的身份快照。

新增索引支持：

- 按企业和时间统计；
- 按企业成员和时间统计；
- 按企业、成员、会话和轮次定位该轮全部模型调用。

`input_tokens` 与 `output_tokens` 继续使用原列；Provider 返回的 `totalTokens`、Profile、Provider、fallback 次数和结束原因继续保存在 `metadata`，保持原 `generic.invoke` 元数据语义。Chat 日志另用 `metadata.outcome` 区分 `completed/error/cancelled`，失败时可记录稳定 `errorCode`。迁移同时为表和新增字段添加 PostgreSQL 中文注释。

`chat.stream` 还在 `metadata.outcome` 记录 `completed/error/cancelled`；异常终止时可附带 `metadata.errorCode`。失败或取消时 Provider 未返回 Token 的字段保持 `null`，不能按 `0` 参与额度或账单计算。

## 6. 客户端本地历史责任

NestJS 部署在服务器上，无法直接写入用户电脑或手机的本地数据库。正确顺序是：

1. 客户端读取本地摘要和近期消息；
2. 客户端调用公开 Chat API；
3. API 调用 ai-service 并记录 Token；
4. 客户端收到完整回答或拼接完 `content_delta`；
5. 客户端把用户消息、Assistant 回答、摘要和截止消息 ID 写入本地。

非流式接口可使用生成的 `ChatService.chatInvoke` 与 `ChatService.chatCompact`。当前公开代码生成器不能正确增量消费 POST SSE，因此 `packages/api-client` 额外提供非生成入口：

```ts
import { streamChatEvents } from '@cees/api-client/chat-stream';

for await (const event of streamChatEvents({ requestBody, signal })) {
  // 处理 started/status/content_delta/usage/completed/error
}
```

该辅助层不会自动重连。网络中断后是否重试必须由用户或产品逻辑决定，防止自动重复生成和重复消耗 Token。

## 7. SSE、取消与失败语义

公开流事件顺序与 ai-service 保持一致：

```text
started
status(reasoning)?
status(answering)
content_delta*
usage?
completed
```

- `status` 不向前端暴露 Profile、Provider、模型或原始推理正文；
- 客户端断开时，API 通过 `AbortSignal` 关闭 ai-service 上游流；
- 建流前错误仍返回项目统一 JSON 错误包络；
- 建流后错误发送终止 `error` SSE 事件；
- 上游没有发送 `completed/error` 就关闭时按无效响应处理，不把不完整流误判为成功；
- `finishReason=length` 表示回答可能被输出上限截断；
- API 内部认证失败映射为服务不可用，不伪装成终端用户登录失败。

## 8. 兼容与验收

- `AIInvocationLog` 原字段没有删除、重命名或改变非空约束；
- 新字段全部可空，历史迁移和旧日志不需要数据修复；
- 原 `generic.invoke` 的 operation、Token、模型与 metadata 含义保持不变；
- Chat 请求不保存消息、回答或摘要正文；
- 公开契约已提升到 `0.15.0` 并重新生成 TypeScript 客户端；
- ai-service 内部契约兼容提升到 `0.2.0`：`ErrorResponse.execution` 为默认 `null` 的可选字段，未执行模型的旧错误结构仍可省略该字段；
- 内部 TypeScript/Python 客户端和 ai-service OpenAPI 产物已重新生成；
- API 单测覆盖身份注入、专用 Chat 路径、一次写入、SSE 映射、取消和旧通用调用兼容；
- ai-service 内部 Chat 行为未做破坏性修改，新增字段只用于防止模型已执行后的失败调用漏计。
