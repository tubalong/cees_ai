# AI 助手工具循环

> 状态：阶段 0-4 已落地（纯文本会话迁移 + 服务端会话 + 断线重连 + 取消 + 幂等，2026-09-10）；阶段 5-6、9 已落地（Tool Loop / 统一注册与批准 / generate_image 图片生成，2026-09-11）；阶段 10 部分落地（generate_document 文档生成，2026-09-11）；上下文压缩已升级为条数与 Token 预算双约束触发（2026-09-14，见 13.1）；额度（QuotaService）与任务、会议等其余工具执行器暂缓。本文件定义 NestJS 统一驱动的 Assistant Tool Loop 架构、数据模型、工具协议与实施顺序。最后更新：2026-09-14。

## 1. 目标与定位

把产品从"会聊天的 AI"推进到"能在企业系统里安全办事的 AI"：用户提出需求后，由 NestJS 统一负责身份确认、权限判断、额度控制、程序化批准、会话状态、模型调用、工具执行、正式数据写入和审计记录；模型只负责理解用户意图并提出下一步建议。

必须保证四条硬约束：

- **不重复执行**：断线重试、重复提交不能重复扣费、重复建任务、重复修改数据；
- **断线可恢复**：断线只解除事件订阅，任务继续执行，重连后能拿到漏掉的事件；
- **批准不可绕过**：模型返回的工具调用只是建议，必须通过统一 ToolPolicy 程序化批准后才可执行；
- **AI 不越权**：模型不直接写业务数据库，一切正式写入走既有业务 Service。

现有 Chat 模块（`apps/api/src/chat`）是无状态代理，会话历史由客户端保存，`contextual-chat.md` 明确本阶段不实现工具调用、审批与 Agent 状态机。本设计把 Chat 降级为 Assistant 的交互入口，统一编排核心只有一个。

## 2. 为什么删除 `/chat/*`、以 `/conversations/*` 新资源重建

当前处于开发阶段，没有真实客户端依赖旧 `/chat/*` 契约，因此不保留兼容层，直接重建。理由：

1. **请求语义反转，不是字段加减**。旧 `/chat/stream` 要求客户端每次提交完整历史和摘要（`ChatRequest.messages` / `conversationSummary`），服务端不保存会话。新架构要求客户端只提交本轮消息和幂等键，历史与摘要由服务端加载——"谁是会话事实源"发生了反转，继续沿用旧请求模型会同时存在两个事实源，客户端伪造历史的隐患无法根除。
2. **旧 SSE 事件没有序号**。断线重连要求每个事件携带递增序号并可重放，旧 `ChatStreamEvent` 结构需要整体改造，逐字段修补不如重新定义。
3. **会话是持久化资源，不是一次性动作**。新架构中会话可创建、列表、查询、恢复，是标准 CRUD 资源；`/conversations/*` 比 RPC 风格的 `/chat/stream` 更符合 REST 语义。PR25 新增的 `GET /images/{imageId}` 已是资源风格先例。
4. **旧 Chat 模块将整体吸收进 Assistant 模块**。保留旧接口等于保留第二套上下文组装、流式事件、Token 记录和错误处理，必然与新核心逐渐漂移。
5. **现在迁移成本为零**。开发阶段删除旧契约只需同步桌面/移动端客户端生成物；等正式客户端出现后删除就变成兼容债务。

PR25 已定义的事件结构不浪费：`tool_call` / `tool_result` / `tool_executing` 等事件定义照搬到新流式接口，只改变挂载路径与请求模型。

## 3. 职责边界

| 组件 | 负责 | 绝不负责 |
| --- | --- | --- |
| NestJS（Assistant 模块） | 会话、权限、额度、程序化批准、Tool Loop、幂等、审计、正式写入 | 不决定模型输出内容 |
| 模型 / LangChain | 理解用户意图，返回 `final_answer` 或 `tool_call` 建议 | 不决定自己有没有权限，不写数据库 |
| ai-service | 模型调用、上下文处理、bind_tools 与结构化 ToolCall 解析、图片生成路由 | 不保存正式会话，不执行工具，不修改业务数据 |
| ImageRouter（位于 ai-service 内） | 在允许范围内选择图片 Provider 和模型 | 不决定用户额度和权限 |
| Task/Document/File 等业务模块 | 执行自己的业务规则、事务、状态机和审计 | 不重复实现 AI 编排、批准或额度 |

## 4. 已确认决策

| 决策项 | 结论 |
| --- | --- |
| 会话权威归属 | 服务端 PostgreSQL；客户端（Electron）本地仅保留渲染缓存，不再是事实源 |
| 会话可见性 | Conversation 绑定 `ownerMembershipId` 默认私有，预留 `visibility` 字段（先只有 `PRIVATE`），沿用 Resource/ManagedDocument 现有模式 |
| 审批含义 | 指 NestJS 对模型请求的**程序化批准**：权限 / 额度 / 幂等 / 参数校验。没有人为审批流，不需要 `/approvals` 接口 |
| 额度模型 | 按工具分账：模型调用记 Token，图片按张，文档按份；结算规则由工具声明 |
| 图片生成结果 | **生成后直接写入正式文件**（FileObject + Resource/ManagedImage + AIActionDraft + 审计 + ToolMessage 一步到位），不做待确认交互、不做临时区转正 |
| ImageRouter 位置 | ai-service 内部，选择 image_generation Provider/模型 |
| AiServiceClientService | 改名为 `AiServiceGateway`，定位是全系统通往 ai-service 的唯一薄适配器，零编排逻辑 |
| 公开接口路线 | 删除 `/chat/*`，以 `/conversations/*` 重建；PR25 的事件结构照搬 |
| 契约推进节奏 | 第 0 阶段契约只定义服务端会话 + 流式 + 断线重连（纯文本 Chat 迁移所需）；工具与图片接口在对应阶段再升契约 |

### 4.1 PR25-29 已定事实（引用）

- ai-service 内部契约已有 `POST /internal/v1/chat/tool-turn/stream`：单次带工具能力的模型回合，`ToolTurnRequest` 携带 `messages`（user/assistant/tool，tool 消息带 `tool_call_id`）与 `tools`（`ChatToolDefinition`：name/description/parameters JSON Schema，最多 32 个）；事件为 `started / tool_calls / content_delta / usage / completed / error`。契约原文明确 "ai-service never executes tools; the caller must perform the tool and call this endpoint again with the resulting ToolMessage"——即本设计的"两轮独立调用"协议。PR26/27 已实现（LangChain `bind_tools`，流式聚合 tool_call_chunks），**要求 `tools` 非空（至少一个工具）**，tool-turn 专服务工具轮次；事件流本无 `status`，本设计在 ai-service 补发 `status` 事件（含 profile/provider/model 执行元数据，与 `/chat/stream` 一致）供 NestJS 写调用日志。
- ai-service 内部契约已有 `POST /internal/v1/images/generate`：返回 Base64 图片字节 + `content_type` + 执行元数据（profile/provider/model/token_usage），不创建正式资源；`ImageProvider` 枚举为 `mock / openai_compatible`。PR28 已实现 ImageRouter（在 ai-service 内选择 Provider/模型）。
- 公开契约 0.16.0 已定义 `tool_call`（toolCallId/name/arguments，描述明确"具体是否执行由 API 根据权限、能力和额度决定"）与 `tool_result`（toolCallId/status: completed|failed|rejected/resourceId/resourceUrl/error）事件结构、`ChatStreamPhase.tool_executing` 阶段、`GET /images/{imageId}`（`ImageResult` 含统一 `resourceId`）与 `image.read` 权限提示。这些结构照搬到新接口，语义不变。
- ai-service 已有专题文档 [AI Tool Calling](ai-tool-calling.md) 与 [Image Generation](image-generation.md)，其边界（ai-service 不保存工具清单、不执行业务工具、不接 COS/Prisma）与本设计一致。

## 5. 模块结构

统一编排核心只有一个 `AssistantModule`，图片、任务、文档只是注册到统一 ToolRegistry 中的执行器，不得各自实现 Loop、批准或额度。

```text
apps/api/src/assistant/
├── assistant.module.ts
├── api/
│   ├── assistant.controller.ts        # HTTP/SSE 传输，无编排逻辑（已落地）
│   ├── dto.ts / assistant.errors.ts / assistant.types.ts
├── conversation/
│   ├── conversation.service.ts        # 服务端会话事实源 + 消息读写（message.service 并入）
│   └── event.service.ts               # 事件写入（seq 分配）与订阅轮询/重放
├── runtime/
│   ├── turn-runner.service.ts         # 唯一 Tool Loop 运行器
│   └── context-builder.service.ts
├── tools/                             # 阶段 5+ 落地
│   ├── tool-registry.ts
│   ├── tool.types.ts
│   ├── tool-policy.service.ts         # 权限/额度/幂等程序化批准
│   └── executors/                     # 薄执行器，只调业务 Service
├── quota/                             # 阶段 6 落地
│   └── quota.service.ts
└── persistence/                       # 阶段 5+ 落地
    └── repositories/
```

核心依赖方向（只有一个 TurnRunner，禁止旁路）：

```text
AssistantController
        ↓
AssistantTurnRunner
        ├── ConversationService
        ├── ToolPolicyService（权限 / 额度 / 幂等）
        ├── AiServiceGateway（→ ai-service，唯一入口）
        ├── ToolRegistry（→ 业务 Service）
        └── EventService / 审计 / 用量记录
```

## 6. 数据模型

### 6.1 服务端会话

| 模型 | 作用 |
| --- | --- |
| `Conversation` | 服务端正式会话；`tenantId` + `ownerMembershipId` + `visibility`（默认 `PRIVATE`）+ 标题 |
| `ConversationMessage` | 三种角色：`USER` / `ASSISTANT` / `TOOL`；正文由服务端持久化 |
| `ConversationSummary` | 服务端保存的历史摘要及 `summarizedThroughMessageId` |
| `AssistantTurn` | 一轮完整运行：关联会话、用户消息、状态、序号、幂等键 |
| `AssistantEvent` | 带递增序号的事件，支持断线后重放 |
| `ToolCall` | 模型提出的工具调用：工具名、参数快照、批准结论、结果引用 |

### 6.2 状态机

```text
RUNNING → COMPLETED
       ├→ FAILED
       └→ CANCELLED
```

落地说明：Turn 创建时直接置 `RUNNING`，不持久化 `RECEIVED`——初始状态没有异步动作，持久化一个空转状态只会让进程崩溃后 Turn 卡死在非终态。没有 `WAITING_APPROVAL`：本设计无人为审批流；模型提出工具调用时 Turn 保持在 `RUNNING`，NestJS 完成程序化批准后立即执行或拒绝。

### 6.3 工具定义

```ts
interface ToolDefinition<Input, Output> {
  name: string;
  version: string;
  requiredPermissions: string[];
  riskLevel: 'READ' | 'WRITE' | 'EXTERNAL';
  quotaType: string;                    // 如 'chat_token' | 'image' | 'document'
  validate(input: unknown): Input;
  estimateQuota(input: Input): Promise<QuotaEstimate>;
  execute(context: ToolExecutionContext, input: Input): Promise<Output>;
}
```

### 6.4 额度账户

按工具分账：

```text
AiQuotaAccount    租户按 quotaType 分账户：余额 / 已预占 / 已结算
AiQuotaUsage      每次工具执行的结算流水，关联 Turn、ToolCall
```

额度操作必须在 PostgreSQL 中原子执行：批准时预占，执行成功后结算，失败/取消时释放。`AIInvocationLog` 继续记录模型 Token 消耗，但它不是额度账户。

### 6.5 图片正式资源

新增 `ManagedImage` 挂到现有 `Resource` 上（与 `ManagedDocument` 同模式）：

```text
Resource(IMAGE, ownerMembershipId)
  └── ManagedImage
        ├── fileObjectId（生成结果正式文件）
        ├── provider / model / prompt 快照
        └── 额度结算引用
```

`ResourceType` 增加 `IMAGE`。生成即写入，不需要草稿状态流转。

## 7. Tool Loop 协议

### 7.1 模型决策

模型每次只返回两种决定之一：

```ts
type ModelDecision =
  | { type: 'final_answer'; content: string }
  | { type: 'tool_call'; name: string; arguments: unknown };
```

模型提出工具只是建议，不代表工具已获准执行。

### 7.2 轮次协议（两层）

一轮 Turn 由 NestJS 编排一次或多次独立的 ai-service 调用，按是否启用工具分两层：

- **纯文本轮次**（工具注册表为空，当前阶段）：调用 `/internal/v1/chat/stream`，模型直接回答；
- **工具轮次**（注册了工具，阶段 4+）：调用 `/internal/v1/chat/tool-turn/stream`（ai-service 要求 `tools` 非空），流程如下：

1. NestJS 计算当前用户允许的工具定义列表（按权限过滤），连同上下文交给 ai-service `/internal/v1/chat/tool-turn/stream`；
2. ai-service 返回 `final_answer`：Turn 完成，直接流式回传；
3. ai-service 返回 `tool_calls`：NestJS 执行**程序化批准**（工具是否存在、参数是否合法、权限、额度、幂等），批准通过则执行工具、保存工具结果与 ToolCall、追加 TOOL 消息，再次调用 `/internal/v1/chat/tool-turn/stream`；
4. 循环直到 `final_answer` 或达到上限。

两种上游流都由 `AiServiceGateway` 统一适配：事件映射为公开 `TurnStreamEvent`（带递增 `seq`），执行元数据与 Token 用量统一写 `AIInvocationLog`，TurnRunner 对两种协议只有一处选择点，不复制编排逻辑。

### 7.3 程序化批准（两点检查）

工具检查发生在两个时点，第二次不可省略：

1. **给模型工具列表之前**：过滤用户无权使用的工具；
2. **真正执行之前**：权限、额度、幂等、参数再次校验（状态可能已变化）。

### 7.4 单轮硬上限

当前上限（TurnRunner 常量）：最大模型调用次数 `MAX_TOOL_TURNS=5`、最大工具步数 `MAX_TOOL_STEPS=10`。Token 总量与总执行时长上限待额度体系接入后补齐。超出任一上限终止 Turn 并返回明确错误（`TOOL_LOOP_LIMIT_EXCEEDED`），禁止无限循环。

### 7.5 失败语义

- 未知工具、缺少权限、非法参数：程序化批准拒绝（ToolCall 状态 `REJECTED`，事件 `tool_result: rejected`），拒绝结果以 TOOL 消息回喂模型，由模型生成解释，Turn 本身不终止；
- 工具执行异常：记录失败（ToolCall 状态 `FAILED`，事件 `tool_result: failed`），失败结果同样回喂模型一次以生成解释；模型自身返回错误或流异常时 Turn 转 `FAILED`；
- 额度不足：额度体系（QuotaService）接入前无此分支，批准目前做存在性/权限/参数三点检查。

## 8. 图片生成端到端流程

```text
用户：生成一只猫的图片
        ↓
NestJS：校验会话、权限、图片能力、额度
        ↓
ai-service /internal/v1/chat/tool-turn/stream（LangChain bind_tools）
        ↓
模型返回 generate_image ToolCall
        ↓
ai-service 解析为统一 ToolCall 返回 NestJS
        ↓
NestJS Tool 程序化批准：权限 / 额度 / 幂等，预占额度
        ↓
ai-service /internal/v1/images/generate（内部 ImageRouter 选择 Provider/模型）
        ↓
NestJS：
  ├─ 上传 COS
  ├─ 写 FileObject
  ├─ 写 Resource / ManagedImage
  ├─ 写 AIActionDraft（status=EXECUTED，记录 executedResourceType/executedResourceId 作为动作流水）
  ├─ 写审计
  ├─ 结算额度
  └─ 追加 TOOL 消息
        ↓
ai-service /internal/v1/chat/tool-turn/stream 第二轮
        ↓
模型：图片已经生成（final_answer）
        ↓
NestJS 通过 SSE 流式返回给用户
```

注意：ai-service 返回的 Base64 字节不能直接成为正式业务文件；正式文件必须由 NestJS 上传 COS 并登记 `FileObject`。生成完成时签发短期签名 URL，随公开 `tool_result` 事件的新增兼容可选字段 `resourceUrl` 返回，客户端可直接下载/展示图片（2026-09-14 起）；回喂模型的工具结果摘要同样携带 URL，`resource {type,id}` 稳定引用保留，URL 过期后通过 `GET /images/{imageId}` 重新获取。

## 9. 断线重连

- 每个 `AssistantEvent` 具有递增序号；
- 客户端断开 SSE 只解除订阅，**不取消 Turn**；
- 重连时客户端携带最后事件序号重新订阅，NestJS 重放漏掉的事件；
- 取消是显式接口，而不是断线副作用；
- 重连时 Turn 已完成：直接返回最终状态与消息；
- 事件与状态均持久化在 PostgreSQL，Redis 只做通知、锁和短期协调。

## 10. 幂等

- 客户端每轮提交携带幂等键（Idempotency-Key）；
- NestJS 以幂等键去重：重复提交返回原 Turn，而不是重新生成；
- 工具执行以 `Turn + ToolCall` 序号做幂等边界，防止重试导致重复扣费或重复写入；
- 业务 Service 内部的版本校验（如 Task 的乐观锁）继续生效。

## 11. 权限与审计

- 工具权限沿用现有 `task.create` / `document.create` 等命名，新增 `ai.image.generate` 等 AI 能力权限；`image.read` 已随 PR25 进入公开契约 403 语义；
- 工具直接调用业务 Service 不经过 Controller，权限必须由统一 ToolPolicyService 检查；业务 Service 继续负责项目成员范围、状态机与版本冲突；
- 每次工具执行写 `AuditLog`（租户、操作者、动作、资源、请求、扩展元数据），有 `audit.read` 权限的成员可查询 AI 动作流水。

## 12. 第 0 阶段公开契约草案

本阶段只做纯文本会话迁移，工具事件结构沿用 PR25 定义但暂不启用。

删除：

```text
POST /chat/invoke
POST /chat/stream
POST /chat/compact
```

新增：

```text
POST   /conversations                             创建会话
GET    /conversations                             当前成员的会话列表
GET    /conversations/{conversationId}            会话详情与消息
POST   /conversations/{conversationId}/turns      发起一轮（Idempotency-Key；SSE 或同步）
GET    /conversations/{conversationId}/turns/{turnId}/events?afterSeq=N   事件重放
POST   /conversations/{conversationId}/turns/{turnId}/cancel              取消执行
```

要点：

- 每轮请求只携带本轮 user 消息、幂等键与可选 mode，历史/摘要由服务端加载；
- 所有 SSE 事件携带递增 `seq` 字段；
- 历史压缩由服务端在 Turn 编排内自动触发（消息数或 Token 超阈值时调用 ai-service `/internal/v1/chat/compact`），不暴露独立公开接口；
- 事件结构沿用 PR25 的 `started/status/content_delta/usage/completed/error`，`tool_call/tool_result/tool_executing` 留待工具阶段启用。

## 13. 分阶段实施路线

| 阶段 | 内容 | 依赖 |
| --- | --- | --- |
| 0 | 本设计文档 + 公开契约重建（纯文本会话）+ 生成客户端 | 无 |
| 1 | 结构收拢：建 `AssistantModule`，`AiServiceClientService` 改名 `AiServiceGateway`，Chat 逻辑迁入统一 TurnRunner（行为不变） | 阶段 0 |
| 2 | Prisma migration：Conversation/Message/Summary/Turn/Event/ToolCall/额度账户/ManagedImage；服务端会话与状态机 | 阶段 1 |
| 3 | 纯文本 Chat 迁移到新核心：客户端只提交本轮消息，服务端加载历史与摘要 | 阶段 2 |
| 4 | 断线重连：事件序号、重放订阅、显式取消 | 阶段 3 |
| 5 | Tool Loop 核心：实现 ai-service `tool-turn/stream`（bind_tools、ToolCall 解析）+ NestJS TurnRunner 循环与上限 | 阶段 4 |
| 6 | 统一策略层：ToolRegistry / ToolPolicyService / QuotaService | 阶段 5 |
| 7 | 接入只读工具（get_task / list_project_tasks）验证租户隔离与结果回喂 | 阶段 6 |
| 8 | 接入 create_task（第一个写工具） | 阶段 7 |
| 9 | 图片生成：实现 ai-service `images/generate`（ImageRouter）、NestJS COS 落盘、FileObject/ManagedImage/AIActionDraft、额度结算 | 阶段 8 |
| 10 | 其余工具：文档生成、任务修改/状态流转、会议纪要等 | 阶段 9 |

### 13.1 落地状态（2026-09-10）

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 0 | ✅ 落地 | 契约 0.19.0 重建（`/conversations/*` 6 端点 + `GET /images/{imageId}`）+ 客户端生成 |
| 1 | ✅ 落地 | `AssistantModule` 建立；`AiServiceClientService` 改名 `AiServiceGateway`；旧 Chat 模块整体删除 |
| 2 | ✅ 落地（部分） | Prisma migration：Conversation / ConversationMessage / ConversationSummary / AssistantTurn / AssistantEvent；额度账户留待额度体系阶段 |
| 3 | ✅ 落地 | 纯文本轮次走 `/internal/v1/chat/stream`；历史与摘要服务端加载；压缩按消息数与 Token 预算双约束触发（见下方压缩说明） |
| 4 | ✅ 落地 | 事件递增 seq、`events?afterSeq=N` 重放、显式 cancel、Idempotency-Key 幂等（同键同内容回放原 Turn，同键不同内容 409） |
| 5 | ✅ 落地（2026-09-11） | Tool Loop 核心：TurnRunner 工具轮次分支（循环 + 硬上限 + assistant(tool_calls)/TOOL 回喂）；migration `0012_ai_tool_loop_image`（ToolCall / ManagedImage / ResourceType.IMAGE / FilePurpose.GENERATED_IMAGE / ToolCallStatus） |
| 6 | ✅ 落地（部分） | `assistant/tools/`：ToolRegistry（listAllowed 权限过滤）+ ToolPolicyService（存在性/权限/参数两点批准）；QuotaService 暂缓 |
| 9 | ✅ 落地（2026-09-11） | `image` 模块：generate_image 执行器 → `ImageService`（ai-service 出图 → COS 落盘 → FileObject/Resource(IMAGE)/ManagedImage → AIActionDraft(EXECUTED) → 审计），以 tool_call_id 幂等 |
| 10 | ✅ 落地（部分，2026-09-11） | `document` 模块：generate_document 执行器 → `DocumentService.createGeneratedDocument`（ai-service compose 出 DocumentSpec → NestJS 序列化为 Markdown → Resource(DOCUMENT)/ManagedDocument → AIActionDraft(EXECUTED) → 审计），以 tool_call_id 幂等；任务、会议等其余工具暂缓 |

实现与设计的偏差（有意为之）：

- 状态机跳过 `RECEIVED` 持久化（见 6.2）；
- 压缩触发双约束：条数阈值（80 条）与各模式输入 Token 预算（ai-service `/ready` 暴露的 `chat_context_budgets`，NestJS 60s 短 TTL 缓存、失败回退默认 64K/128K）同时生效；估算输入超过预算 80% 即触发，压缩量取两约束中更激进（保留更少）的一方，压缩边界按 Turn 对齐；图片按固定 1024 Token 计入估算（与 ai-service 口径一致）；
- 订阅端通过 DB 轮询（250ms）获取新事件，不依赖进程内消息通道，多实例部署安全；
- 断线只中止订阅 signal，执行 signal 独立，后台 Turn 继续执行；
- cancel 先抢状态（`RUNNING→CANCELLED` 的 updateMany），抢到者写终止事件并 abort 上游，抢不到返回 400；错过窗口由重放接口兜底；
- 事件先行、状态随后：先落事件再更新终态，订阅端不会错过终止事件；
- 模块结构微调：`message.service.ts` 并入 `conversation.service.ts`（appendUserMessage / appendAssistantMessage）；
- 工具轮次历史回放：ai-service 校验 tool 消息必须引用此前 assistant 消息 tool_calls 中的上游调用 ID，而持久化的 ConversationMessage.toolCallId 是 NestJS uuid，回放时通过 ToolCall 表做公开 ID → 上游 ID 映射，并按轮次合成 assistant(tool_calls) 消息插在 TOOL 消息之前（context-builder.buildToolTurnMessages）；
- 两点程序化批准落地为 `ToolRegistry.listAllowed`（给模型工具列表前）+ `ToolPolicyService.approve`（执行前）；额度检查点预留，接入计费后补在 approve 内；
- 工具批准拒绝与执行失败不回退 Turn 状态：记录 ToolCall 状态（REJECTED/FAILED）并以 TOOL 消息回喂模型，由模型生成解释；回喂模型的失败摘要与落库/事件的错误详情分离：上游技术错误（`AiServiceInvocationError`，含地址、主机名等细节）只进 `errorMessage`（落库与事件），回喂模型的是用户友好通用文案，避免技术细节被模型转述（2026-09-15）；
- 工具结果摘要不回喂系统内部标识（资源 ID、模型名），内部标识仅保留在 `resource {type,id}` 结构化字段与事件中（2026-09-15）；
- 生成即落正式资源：图片不经过待确认交互，AIActionDraft 以 EXECUTED 状态作为动作流水保留写入；
- 模块结构：工具全部收进 `assistant/tools/`（执行器目录 `executors/`）；图片正式资源仿 document 模式独立为 `image/` 模块：执行器路径不复制编排，公开访问经 ImageController 走 Resource 归属校验（见 14 节图片授权边界）；
- 文档生成零迁移：DocumentSpec 在 NestJS 侧序列化为 Markdown 文本落既有 `ManagedDocument`（无文件/COS 链路），DOCX 导出（render-docx/generate-docx）暂不接入；文档创建复用 `Resource(DOCUMENT)` 归属与 ACL 语义，AI 生成文档与手工创建文档同构。

## 14. 已确认设计决策（2026-09-11 讨论结论）

- 结构化业务数据（任务、文档、成员等）一律通过工具（Function Calling）接入，不做 RAG：RAG 面向非结构化、只读、语义模糊的知识问答，而任务/文档需要精确过滤、实时状态、权限收口与写操作，检索快照无法满足；RAG 留给未来的知识库问答功能，与工具循环互补；
- 工具接入采用 discovery + action 两层（检索工具返回带 ID 的小批量摘要，操作工具按 ID 精确执行），模型负责自然语言→ID 的消歧，匹配不上时反问用户；不采用 text-to-SQL（绕过业务服务层与权限收口），不采用服务端名称模糊解析（歧义责任不清）；
- 写入确认边界：生成新资产（图片、文档）在用户要求下直接落正式数据，无需确认环节（幂等、无破坏性）；修改/推进既有业务状态（任务创建、状态流转）预留 DRAFT→用户确认机制，接入时再定；
- 工具面保持最小：只暴露当前功能必需的工具动作，检索类工具随任务工具接入一起规划，避免工具列表膨胀导致模型误选；
- 取消语义按状态机生效：cancelTurn 通过 `updateMany` 抢占 RUNNING 状态（与 completeTurn 对称），事件与状态立刻终态化；当前通过 AbortController 中断上游流，多实例部署下非本实例的活跃执行无法即时中断（上游流不会无限运行，会因无消费者而结束），跨实例即时中断留待 Redis pub/sub 时再收口；
- 图片授权边界：`GET /images/{imageId}` 当前为 owner-only（按 Resource.ownerMembershipId 校验），不消费 ResourceAcl；ACL 分享随图片分享功能扩展时再接入 resource-access 服务。

## 15. 待确认事项

- 桌面端/移动端客户端随契约重建的改造排期；
- `ai.image.generate` / `ai.document.generate` 权限的授予对象与默认角色；
- 各工具额度单位的初始定价与套餐上限；
- Token 总量与总执行时长上限的具体数值（模型调用次数与工具步数已定为 5 / 10）；
- 任务工具（get_task / create_task 等）的 ID 解析与写操作确认机制：拟采用 discovery（list_projects/list_tasks）+ action 两层工具，写操作是否走 DRAFT→用户确认待定；
- AssistantEvent 事件表的清理策略：重放以事件为唯一事实源，暂不设置 TTL；长期运营的归档/分级清理策略待定；
- AIActionDraft 的语义张力：当前兼具“AI 动作流水”（EXECUTED）与“待用户确认草稿”（PENDING）两种语义，任务工具接入写确认时需统一模型与命名。
