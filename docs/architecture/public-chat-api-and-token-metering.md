# AI 调用与 Token 计量

> 状态：已实现并持续使用。本文是 `AIInvocationLog` 与 `AiInvocationRecorderService` 的现状说明；早期版本（公开契约 0.15.0 时代的 `/chat/*` 接口）中"客户端本地保存会话历史、服务端不保存会话表"的描述已被服务端会话架构取代，会话与流式接口现状见 [AI 助手工具循环](assistant-tool-loop.md)。最后更新：2026-09-22。

## 1. 定位

`AIInvocationLog` 记录 NestJS 发起的每一次真实模型调用的执行指标：身份、关联 ID、操作类型、模型、延迟、Token 与受限元数据。它是**实际用量指标**，不是额度账户、账单或套餐。

明确不在本设施范围内：

- 企业套餐、席位/坑位、成员额度分配、额度预占、扣减与超额拦截；
- 对话正文、消息与摘要的存储及多端读取（由 Assistant 模块的服务端会话表承担，见 [AI 助手工具循环](assistant-tool-loop.md)）。

后续额度体系可以复用这些指标，但必须另行设计套餐、计费周期、席位权益、预占、结算与并发一致性。

## 2. 计量入口与组件

Token 写入统一由 `AiInvocationRecorderService`（`apps/api/src/ai-orchestration/`）完成；所有模型调用均经过 `AiServiceGateway` 这一唯一出站网关并记录：

```text
generic.invoke ─┐
chat.invoke ────┤
chat.stream ────┤
chat.compact ───┤
chat.tool_turn ─┼→ AiServiceGateway → AiInvocationRecorderService → AIInvocationLog
chat.related_questions ─┤
image.generate ─┤
document.compose ─┘
```

记录器只接受身份、关联 ID、操作类型、模型执行元数据、Token 和受限的标量指标字段，没有任意 JSON、消息正文或摘要参数，从接口结构上降低敏感内容误写数据库的风险。

## 3. 写入规则

每次实际模型调用最多写一条对应 operation 的日志：

- 非流式调用在 ai-service 成功返回后写入，再向客户端返回成功；
- 非流式调用若模型已执行但回答/摘要被业务校验拒绝，ai-service 在内部错误体的可选 `execution` 中返回模型与 Token，API 仍写入一次失败用量；
- 流式调用在 `completed` 前写入，再转发完成事件；
- 流式失败或取消在上游已经提供模型元数据后也写入一次；Provider 尚未报告 Token 时对应字段为 `null`，避免把"未知"误写成 `0`；
- 上游拒绝请求且没有执行模型时不写 Token 日志；
- 客户端重新发起请求属于新的真实模型调用，不能仅按 `turnId` 去重，否则会漏计实际消耗；
- 单次流式调用的指标写入最多尝试一次；写入失败时不在清理阶段再次写入或重跑模型，避免一次真实调用产生重复日志。

同一 `turnId` 可能有多条日志（例如一轮内先压缩再回答，或工具循环中的多次 `chat.tool_turn`）。统计"一轮共使用多少 Token"时，应对这些日志求和，不能只取其中一条。

## 4. 数据模型

表 `ai_invocation_logs`（Prisma 模型 `AIInvocationLog`）：

| 字段 | 含义 |
| --- | --- |
| `tenant_id` / `user_id` | 发起调用的租户与用户 |
| `membership_id` | 发起调用时的租户成员身份快照；不建级联外键，成员移除后历史指标不丢失 |
| `conversation_id` | 服务端会话标识（`conversations` 表）；仅 Chat/ToolTurn 类调用填写 |
| `turn_id` | 服务端轮次标识（`assistant_turns` 表）；同一轮内的多次模型调用共享 |
| `request_id` | 单次 HTTP 请求标识；配合 `tool_call_id` 为工具执行做幂等 |
| `tool_call_id` | 工具执行对应的 ToolCall ID；图片生成等工具调用填写 |
| `model` / `latency_ms` | 实际使用的模型与耗时 |
| `input_tokens` / `output_tokens` | 输入与输出 Token；Provider 未报告时为 `null`，不按 `0` 参与额度或账单计算 |
| `operation` | 调用类型：`generic.invoke` / `chat.invoke` / `chat.stream` / `chat.compact` / `chat.tool_turn` / `chat.related_questions` / `image.generate` / `document.compose` |
| `metadata` | 受限标量指标：profile/provider/model、fallback 次数、结束原因、`outcome`（completed/error/cancelled）、`errorCode` 等 |

索引支持按企业/时间、企业/成员/时间统计，以及按企业、成员、会话、轮次定位该轮全部模型调用。

## 5. 历史演进

早期（公开契约 0.15.0）的 `/chat/*` 接口是无状态代理：客户端本地保存会话历史并每轮重放，服务端不保存会话表，`AIInvocationLog.conversation_id/turn_id` 记录客户端本地标识，"对话历史上传、云端备份或多端同步"因此被列为不实现项。

自公开契约 0.17.0 起，`/chat/*` 已删除，会话与流式接口由 AI 助手工具循环的 `/conversations/*` 取代：会话权威归属服务端 PostgreSQL（`Conversation`、`ConversationMessage`、`ConversationSummary`、`AssistantTurn`、`AssistantEvent`、`ToolCall`），客户端本地仅保留渲染缓存。对话正文由服务端持久化，同一成员换端即可读取自己的私有会话，不再依赖客户端本地存储；`AIInvocationLog.conversation_id/turn_id` 随之改为记录服务端会话与轮次标识。详见 [AI 助手工具循环](assistant-tool-loop.md)。
