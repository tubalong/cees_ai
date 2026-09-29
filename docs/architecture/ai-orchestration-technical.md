# AI 任务编排：技术设计

> 状态：设计定稿（2026-09-28）
> 实施进展（2026-09-29）：**M1 已落地**——同事表与任务五表（含统一交互表、`Conversation.agentId` 扩展）迁移、任务面契约（`/assistant/tasks` 5 操作，契约 0.44.0）、权限码 `ai.task.create/read`、编排服务骨架（`task` / `plan` / `task-event` / `task-runner`）、`create_orchestration_task` 工具与「无在职 AI 同事时编排工具不出现、对话与其余工具不受影响」的降级门控、任务接口（含 SSE 重放）与开发环境默认同事 seed。**M2 已落地**——步骤执行器与执行状态服务（派发书、执行窗口重建、工具循环、产出与依据回流）、任务调度器（任务租约抢占、依赖推进与失败级联、终态判定、心跳与失效恢复扫描）、`ToolCall` 挂接任务步骤（`taskStepId` / 序号 / 模型步）与步骤级事件契约（0.45.0）、生成类工具双载体（turn / task step）改造。**M2 口径简化（授权挂起部分已被 M3-S 取代）**：M2 期间步骤执行面不开放 WRITE 工具（一律裁剪并拒绝），租约过期步骤直接判失败、无重试阶梯。**M3 已部分落地**——交互契约（挂起事项与解决操作，契约 0.46.0）、交互服务（创建 / 解决 / 终态清理与临时授权校验链）、授权挂起与恢复全链路（WRITE 工具需签字：无可用授权时创建 AUTHORIZATION 挂起、批准后临时授权消费执行、拒绝直接收束；挂起不阻塞其它步骤；恢复语义 `WAITING_USER → RUNNING` 断点续跑；交互解决接口即时恢复 + 恢复扫描兜底）、编排决策器抽象位（`decider/`：接口 + 规则 / LLM 实现 + 工厂装配；ai-service 契约 0.8.0 登记 `orchestration_decision` 模型角色）、`ask_user` 协议工具与问人 / 裁决挂起（工具面恒含 `ask_user`；决策器信息充分性判定与置信度分流；答复 / 裁决作为 USER 窗口消息注入执行窗口、断点续跑）、挂起超时策略（默认无限等待，可配按默认继续 / 跳过步骤 / 失败收束）与防滥用上限（单任务授权 / 提问创建次数）。**M3-F 失败阶梯（自动重试 / 升级用户裁决）已落地**——失败统一收拢兜底（调度循环对未处置失败先收拢）、可重试错误白名单与指数退避自动重试（上限含首次，默认 3）、超限升级用户裁决（重试 / 跳过 / 终止三选项如实落状态）、退避等待让行不占租约。**M3-R 重编排（revise → 新草案 → 再次确认）与执行中重排已落地**——`revise_orchestration_task` 工具（`revisionKey` 幂等、新版本 `createdBy=USER`）、计划卡片「调整要求」事件链路（`plan_revision_requested` 去重写入）、失败裁决第 4 选项「调整计划」（任务保持挂起等待重排、调度循环与恢复扫描让行）、再次确认物化新版本并按沿用锚点（`carriedFromStepKey`）复制已完成步骤产出（不重跑）、工具轮次把待调整任务与可沿用步骤注入 instructions 的计划调整引导。**M3 剩余**：无（自动重排——`REPLAN_TRIGGER` 决策器接线——不在当前范围，重排由用户驱动）。**M2 存量项「产出验收与归档」已落地**——`GET /assistant/tasks/{id}/outputs` 产出验收视图（跨计划版本聚合、按最近完成步骤去重、已删除文档剔除；归档结果从 `output_confirmed` 事件重建）与 `POST /assistant/tasks/{id}/outputs/confirm` 逐产出归档（复用知识库转存链路、同源重复转存追加版本、任务行锁防并发重复事件、幂等与异库 409）、归档建议（规则路径部门库确定性默认 + LLM 路径 `archive_suggestion` 模型角色、候选集硬过滤、失败降级）、契约 0.48.0。**剩余存量项**：产出草稿版本呈现（确认卡富交互与草稿落库呈现）、派发书中的学习记录与近期工作记录注入（依赖 M4 沉淀体系）。**未实施缺口（2026-09-29 对齐审查确认）**：① **通道 A（与同事直接对话）与同事管理面**——同事资产目前只有数据表与开发环境 seed：服务端无创建 / 编辑 / 归档 / 列表接口（契约无 `/assistant/agents` 端点），会话契约未开放对话对象参数（`Conversation.agentId` 为预留字段、无运行时消费），对话入口仍只有总管，同事的职能定义与工具面不参与会话组装；其完整上下文还依赖学习 / 工作记录注入（M4）。② 对话内查询任务列表 / 详情的工具未实现（任务进展与产出仍在任务卡片 / 任务页查看）。**任务完成后的对话闭环已落地（2026-09-29）**：任务终态（COMPLETED / FAILED）随终态事务在发起会话追加总管汇报消息（完成情况、产出清单与后续引导；挂会话最后一条终态轮次、同步推进 `lastTurnAt`，会话不可用时跳过），工具轮次与纯聊天轮次 instructions 注入「最近终态任务 + 产出」感知（每模型调用前重算，长会话压缩后的兜底）。**M4**（融合与沉淀）尚未实施；文中建议系统章节仍为待实施设计。
> 性质：技术方案文档。定义数据模型、状态机、接口契约、上下文组装算法、编排决策抽象、调度运行器与实现落点。
> 需求与功能设计见 [AI 任务编排（需求设计）](../product/ai-orchestration.md)；主体定义见 [AI 同事：定位与关系说明](../product/ai-colleague.md)。
> 读者：服务端、AI 服务、桌面端 / 移动端工程师与测试。

## 1. 总体架构

### 1.1 组件图

```
┌─────────────────────────── apps/api（唯一编排中心） ───────────────────────────┐
│                                                                              │
│  对话入口（现有）                        编排层（新增 orchestration/）             │
│  ├─ 轮次运行器（turn-runner）             ├─ 任务服务（生命周期、幂等、查询）         │
│  ├─ 意图与能力识别（intent-capability）    ├─ 编排运行器（task-runner：调度循环、租约、恢复）│
│  └─ 复杂度分流 ──────────────▶           ├─ 步骤运行器（step-runner：派发、挂起、回流）│
│                                          ├─ 计划管理（plan：版本化、重编排）          │
│  同事资产（新增 agents/）                  └─ 编排决策器（decider：抽象位，v1/v2）      │
│  ├─ 同事定义（职能、权限上限、数据源挂载）                                               │
│  ├─ 学习记录 / 工作记录                                                          │
│  └─ 前台对话运行时（复用轮次管线，按同事人格组装上下文）                                  │
│                                                                              │
│  既有基座（复用）：工具注册与批准（tools/）、写操作确认（drafts/）、事件与重放（conversation/）、│
│  数据范围解析、审计、幂等、额度计量                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
                    │ 内部契约（内部 Token 鉴权）
                    ▼
┌─────────────────────── apps/ai-service（模型执行，无业务流程） ──────────────────────┐
│  轮次执行管线（现有，复用）：消息组装 → 模型调用 → 工具循环 → 流式事件                  │
│  步骤执行（复用管线）：派发书与窗口消息随轮次请求下发，产出经工具结果回流             │
│  编排决策调用（已落地）：结构化输出（选项 + 置信度；模型角色 orchestration_decision）   │
│  归档建议调用（已落地）：结构化输出（归档候选 + 理由；模型角色 archive_suggestion）     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 分层原则

- **app/api 掌握一切流程事实**：任务状态、计划、挂起、授权、审计都在 NestJS；ai-service 只做"单次模型执行"与"决策建议"，不持任务状态；
- **编排层叠加在既有轮次管线之上**：步骤执行复用 turn 执行器（消息 + 工具循环 + 事件流 + 幂等批准），编排层负责"何时、以什么上下文、执行哪一步"；
- **一切长生命周期对象都落库**：任务可断线、可重启、可跨终端，任何内存态都只是缓存。

## 2. 数据模型

新增模型全部遵循既有约定：`id` uuid 主键、`tenantId` 隔离、`@map` 蛇形表名、中文 `///` 注释说明设计意图、状态用 Prisma 枚举、序号字段原子分配（沿用 `nextEventSeq` 模式，避免 max+1 并发冲突）。

### 2.1 同事资产（agents/）

**落实现状（2026-09-29 对齐审查）**：当前迁移只创建 `assistant_agents` 一张表（迁移 `20260928083803_add_assistant_agents`）；下列 `AssistantAgentDataSource` / `AssistantAgentLesson` / `AssistantAgentWorkRecord` 三张表为设计目标、尚未创建，依赖同事管理面与 M4 沉淀体系落地（见文首进展段）。

**AssistantAgent**（`assistant_agents`）——同事定义（岗位说明书）：

- `name` / `title`（职责定位）/ `icon` / `description`
- `instructions`（执行指令：工作方式、输出标准）
- `permissions Json`：三级权限清单（自决 / 需签字 / 禁止），固定模式校验
- `toolPolicy Json`：可用工具与动作清单（与权限清单联动）
- `dataSources`：数据源挂载（独立表，见下）
- `visibility Json`：可调度 / 可对话的角色范围
- `budget Json`：单次执行与单任务预算上限（调用次数、token 上限）
- `status`：DRAFT / ACTIVE / ARCHIVED；`version`（乐观锁，改配置不重写历史执行）

**AssistantAgentDataSource**（`assistant_agent_data_sources`）——数据源挂载：`agentId`、`type`（KNOWLEDGE_BASE / BUSINESS / CONNECTOR）、`refId`、`config Json`（如知识库的推荐标签）。只存引用，不复制数据。

**AssistantAgentLesson**（`assistant_agent_lessons`）——学习记录（程序性知识，append-only）：

- `agentId`、`content`（经验条目）
- `scopeType`：GLOBAL / USER / SCENARIO；`scopeMembershipId`（USER 时）、`scopeKey`（SCENARIO 时）
- `sourceType`：FEEDBACK / PATTERN / RETROSPECT / CORRECTION / EXTERNAL；`sourceRef`（来源任务或轮次）
- `status`：PENDING_CONFIRM / ACTIVE / RETIRED；`supersededById`（取代链，不原地修改）
- **所有对人的引用使用 membershipId**，不存姓名字符串；展示层实时解析

**AssistantAgentWorkRecord**（`assistant_agent_work_records`）——工作记录（情景记忆，append-only）：

- `agentId`、`kind`（TASK / DIALOG）、`taskId?`、`initiatorMembershipId`
- `summary`（摘要级）、`stepRefs Json`、`outputRefs Json`（产出资产引用）、`result`（结果与复盘要点）

### 2.2 任务编排（orchestration/）

**AssistantTask**（`assistant_tasks`）——任务主体：

- `conversationId`（发起会话）、`userId` / `membershipId`（发起人）
- `title` / `goal`（目标原文）、`originType`：CONVERSATION / AGENT_CHAT / AUTO
- `status`：CREATED / PENDING_CONFIRM / RUNNING / WAITING_USER / COMPLETED / FAILED / CANCELLED
- `planVersion`（当前生效计划版本）、`nextEventSeq`（任务事件序号原子分配）
- 执行租约：`executionOwner` / `leaseExpiresAt` / `heartbeatAt`（沿用轮次租约模式）
- 幂等：`@@unique([conversationId, idempotencyKey])`；`requestHash` 校验键内容一致
- `completedAt` / `failedReason` / `createdAt` / `updatedAt`

**AssistantTaskPlan**（`assistant_task_plans`）——计划版本（append-only）：

- `taskId`、`version`、`steps Json`（计划快照：每步的标题、职责、执行同事、输入引用、预期产出；重排沿用的步骤额外携带 `carriedFromStepKey` 锚点）、`createdBy`（`USER` = 用户调整要求后重新采纳 / `SYSTEM` = 总管生成）、`confirmedAt`
- `revisionKey`（重排幂等键：同一次 `revise_orchestration_task` 调用重放不重复生成版本；非重排版本为空）
- `clarifications Json?`（PENDING_CONFIRM 阶段的关键待定项：问题 + 选项；确认请求携带答复，答复并入生效版本）
- **版本化而非原地修改**：重编排与"调整要求"产生新版本，历史版本保留，审计可回溯"第 3 版计划为什么被替换"

**AssistantTaskStep**（`assistant_task_steps`）——运行时步骤（当前计划版本的展开）：

- `taskId`、`planVersion`、`stepNo`、`stepKey`（计划内稳定标识）
- `assigneeAgentId`（执行同事）、`brief Json`（派发书快照：本步要求、依赖产出引用、工具面）
- `dependsOn Json`（前置 stepKey 列表）
- `status`：PENDING / READY / RUNNING / WAITING_USER / SUCCEEDED / FAILED / SKIPPED
- `attemptNo`（尝试计数：最大尝试次数含首次，默认 3，用户显式重试不受限）、`retryAfterAt`（退避重试的最早可派发时间，空 = 无退避）、`summary`（结果摘要）、`outputRefs Json`（产出引用）
- **沿用物化**：执行中重排再次确认时，新版本中 `carriedFromStepKey` 命中旧版本 SUCCEEDED 步骤的行直接落 SUCCEEDED 并复制摘要 / 产出引用（不重跑）；锚点缺失或来源版本无对应成功步骤时拒绝物化
- 执行租约：`executionOwner` / `leaseExpiresAt` / `heartbeatAt`
- `startedAt` / `completedAt` / `error`

**AssistantTaskStepMessage**（`assistant_task_step_messages`）——执行窗口消息（随步骤生灭）：

- `stepId`、`seq`、`role`、`content`、`toolCallRef`（关联 ToolCall）
- **独立于 Conversation 存储**：不进入用户会话、不进对话列表、不参与主会话压缩；保留清理尚未实现（设计目标：步骤终态后按保留策略清理，如保留 30 天供排障、可配置；v1 无清理任务、写入后长期保留）

**AssistantTaskEvent**（`assistant_task_events`）——任务事件（展示与重放）：

- `taskId`、`seq`（原子分配）、`type`、`payload Json`
- `@@unique([taskId, seq])`：断线重连按 `(taskId, seq)` 重放，与轮次事件同构
- 事件类型：`task_created` / `plan_ready` / `plan_revision_requested` / `plan_confirmed` / `step_started` / `step_progress` / `step_completed` / `step_failed` / `step_skipped` / `interaction_requested` / `interaction_resolved` / `output_confirmed` / `task_completed` / `task_failed` / `task_cancelled`
- **任务事件不写入对话消息流**：对话流中的任务卡片只是一条轻量引用消息，卡片内容由任务事件流实时驱动——避免任务过程进入主会话 LLM 上下文（三不变量之"隔离"）

**AssistantTaskInteraction**（`assistant_task_interactions`）——用户介入事项（挂起/恢复的统一载体）：

- `taskId`、`stepId`、`type`：AUTHORIZATION / QUESTION / DECISION
- `payload Json`（按 type 固定模式：授权=权限项与理由；提问=问题与候选；裁决=分岔方案）
- `status`：PENDING / RESOLVED / REJECTED / EXPIRED / CANCELLED
- `resolution Json?` / `resolvedByMembershipId` / `resolvedAt` / `expiresAt`
- 授权专用字段：`scope`（ONCE / TASK）、`usedAt`（使用时间；"全量使用记录"写审计事件）
- **为什么三类交互合一张表**：挂起、推送、恢复、审计的骨架完全相同，差异仅在 payload 模式与恢复动作；分三张表会复制三套管道，合并后 type 层校验、骨架层复用

### 2.3 会话扩展、建议与既有模型的衔接

- **`Conversation` 最小扩展**：新增可空 `agentId`（null = 总管），承载"一条会话固定一个对话对象"；列表查询沿用既有 `[tenantId, ownerMembershipId, updatedAt]` 索引，按对象筛选在其上追加条件（筛选变高频再评估组合索引）。这是对既有表的唯一结构变更；
- **建议（Suggestion）不新增持久化表**（一期）：轮后建议沿用 `AssistantTurn.relatedQuestions`（随轮次存储、随事件重放）；开场建议走短 TTL 缓存（Redis，按用户维度），不落库；
- 统一抽象以服务契约对象表达（见第 9 节），后续若需要建议使用率统计再评估独立表；
- **不修改** `AssistantTurn` / `AssistantEvent` / `AssistantActionDraft` 结构；步骤执行的模型调用通过 `AIInvocationLog.metadata` 记录 `taskId` / `stepId`（不新增列）。

### 2.4 产出归档（与知识库体系的衔接）

**不新增表、不新建存储机制**：任务产出的归档复用 knowledge 模块既有转存链路——`KnowledgeDocument` 按 `sourceType=DOCUMENT`（AI 生成文档）锚定来源，同源重复转存追加 `DocumentVersion`，审计沿用 `KNOWLEDGE_DOCUMENT_CREATED`（已含 `visibilityScope` / `sourceType` / `sourceId`）；知识库四档归属（`visibilityScope`：PRIVATE / DEPARTMENT / PROJECT / TENANT）与成员权限（`KnowledgeBaseMember`：READER / EDITOR / MANAGER）全部复用。

**归档目标解析（v1）**：

- 规则路径（确定性）：发起人有部门 → 默认其部门锚定的 DEPARTMENT 库；任务关联项目 → 建议 PROJECT 库（v1 不可达：任务与计划尚无项目关联通道，归入待补）；
- 无明确归属（无部门 / 跨部门 / 高层角色）：不猜测，由 LLM 基于产出主题生成候选项与推荐理由（结构化约束），候选集 = 发起人对目标库具 **EDITOR 及以上** 权限的库，服务端硬过滤（与建议系统同一原则：不出现无权选项）；
- 目标库不存在（部门尚无库）：提示创建（需建库权限）或由用户在候选内另选。

**确认承载**：产出的内容验收与归档确认合并为一个动作——`POST /assistant/tasks/{id}/outputs/confirm` 逐产出携带 `knowledgeBaseId`；服务端校验（目标库 EDITOR+ → 转存 → 写事件 `output_confirmed`（payload：`documentId` / `knowledgeBaseId` / `knowledgeDocumentId` / `visibilityScope`））；无明确归属时，确认提交前先完成"选择存储位置"的问答（属于确认表单的一部分，**不产生挂起事项**：任务已在终态验收阶段，未选择则提交不成立，无需建立交互记录）。

**可见范围提示**：确认卡片展示目标库 `visibilityScope` 的可见面（公司库=全员可检索 / 部门库=本部门 / 项目库=项目成员 / 个人库=仅本人），随候选由服务端下发，前端仅展示。

**v1 落地（2026-09-29，契约 0.48.0）**：

- 读取端点：`GET /assistant/tasks/{id}/outputs` 下发产出清单（跨计划版本聚合 SUCCEEDED 步骤的 DOCUMENT 产出、按最近完成步骤去重、已删除文档剔除）与可归档库候选（manage_all 全库，否则成员 EDITOR 及以上；锚点人群虚拟 READER 库不出现）；已验收产出携带归档结果（从 `output_confirmed` 事件重建），未验收产出携带建议（仅任务终态时生成；非终态视图可读但无建议）；
- 建议结构：逐产出 `suggestions[{knowledgeBaseId, reason}]`；规则路径（发起人部门锚定的 DEPARTMENT 库在候选内）为单元素确定性默认、不调模型；无明确归属时一次 LLM 调用处理全部未确认产出（`archive_suggestion` 角色、JSON Schema 结构化输出、失败重试一次），服务端校验候选合法性并硬过滤，失败降级为空建议；
- 归档实现：复用 `KnowledgeDocumentService.saveFromSource`（`sourceType=DOCUMENT`、`sourceId`=AI 文档 ID；文档可见范围跟随归档库 scope 与部门 / 项目锚点）；同源已存同库追加版本、异库冲突（`KNOWLEDGE_SOURCE_ALREADY_SAVED`）；
- 幂等与并发：仅终态任务可提交（`TASK_NOT_TERMINAL` 409）；同库重复提交幂等跳过、异库 409（`TASK_OUTPUT_ALREADY_ARCHIVED`）；产出不属于任务 400（`TASK_OUTPUT_NOT_FOUND`）；事件写入在任务行锁（`SELECT ... FOR UPDATE`）内复查，消除并发重复事件窗口。

## 3. 状态机

### 3.1 任务状态

```
CREATED（计划生成中）
   │ 计划草案就绪（含完整步骤清单与关键待定项）
   ▼
PENDING_CONFIRM（派发前确认：展示步骤清单；答复澄清项；"调整要求"生成新草案）
   │ 用户确认携带澄清答复（或自动采纳策略）；确认前不派发
   ▼
RUNNING ◀─────────────────────────┐
   │ 步骤触发挂起                    │ 交互解决（授权批准 / 答复 / 裁决）
   ▼                              │
WAITING_USER ─────────────────────┘
   │ 失败裁决"调整计划"：对话中调整 → 新版本草案 → 再次确认后继续（沿用已完成步骤，见规则）
   │ 全部步骤终态
   ▼
COMPLETED / FAILED / CANCELLED（终态：关闭未决挂起、联动失效临时授权）
```

规则：

- 状态不倒退：终态不可回到运行态；需要继续工作 → 新任务（保持历史不可变）；
- 执行中重排：WAITING_USER 下失败裁决选择"调整计划"后任务保持挂起（调度循环与恢复扫描让行），用户在对话中经 `revise_orchestration_task` 生成新版本草案，任务回到 PENDING_CONFIRM 再次确认；确认后物化新版本并按沿用锚点复用已完成步骤的产出；
- WAITING_USER 是"存在挂起事项"的展示态，实际调度以**步骤级状态**为准（有步骤 RUNNING 则任务实际仍在跑）；
- 所有转换用**条件更新抢占**（`UPDATE ... WHERE status = 期望前态`），重复事件不产生二次转换；
- 终态验收：终态任务可对产出做验收归档（`GET/POST /assistant/tasks/{id}/outputs`），只写 `output_confirmed` 事件、不改变任务状态。

### 3.2 步骤状态

```
PENDING（依赖未满足）──依赖完成──▶ READY ──调度派发──▶ RUNNING
  │ 依赖失败级联                                      │
  ▼                                                  ├──▶ SUCCEEDED
SKIPPED（终态）                                       │
                                                     ├──▶ FAILED
                                                     │      └─ 失败处置
                                                     │         ├─ retry：退避后回 READY（attemptNo+1）
                                                     │         ├─ escalate：转 WAITING_USER（裁决：重试 / 跳过 / 终止）
                                                     │         └─ 重排："调整计划"不落步骤状态，任务保持挂起（见 §3.1 / §7.1）
                                                     │
                                                     ├──▶ WAITING_USER（授权 / 提问 / 失败裁决挂起）
                                                     │      ├─ 普通挂起：交互解决 ─▶ RUNNING（断点续跑，attemptNo 不变）
                                                     │      └─ 失败裁决：retry ─▶ READY（清退避）／ skip ─▶ SKIPPED（终态）／ abort ─▶ FAILED（终局，不再处置）
                                                     │
                                                     └──▶ （超时/中断）租约回收续跑

                          ▼（终态：SUCCEEDED / FAILED / SKIPPED）
                         （任务进入下一步判定）
```

规则：

- 单步骤串行：同一步骤同一时刻只有一个执行尝试（租约保证）；
- 挂起不阻塞：WAITING_USER 的步骤不影响无依赖步骤的调度；
- 失败统一收拢：任何入口失败（执行异常 / 失联 / 超时）只落 FAILED 与事件，处置由失败处理服务幂等收拢，调度循环先兜底未处置的失败；
- 自动重试：可重试白名单错误（执行失败 / 失联、AI 服务不可用类、轮次请求失败）且未达上限 → 退避重试，退避 = 基础值 × 2^(尝试次数-1)（基础默认 30 秒；≤ 0 立即）；退避期间步骤停留 READY，调度器让行不占租约；
- 重试上限可配置（默认 3，含首次尝试），超限或不可重试错误升级用户裁决；用户显式重试不受上限限制；
- 升级与裁决：失败步骤转 WAITING_USER 并创建裁决交互（重试 / 跳过 / 终止 / 调整计划），裁决落状态为 READY（重试，清退避）/ SKIPPED（跳过，终态）/ FAILED（终止，终局且不再自动处置）；"调整计划"不落步骤状态——任务保持挂起等待重排（见 §3.1）；
- 重编排（revise）：`revise_orchestration_task` 仅在任务"待确认（PENDING_CONFIRM）"或"挂起且已选调整计划"时接受，生成 v+1 草案（`revisionKey` 幂等）；执行中场景同事务把任务翻回 PENDING_CONFIRM；再次确认经同一 `confirm` 入口物化（目标版本必须晚于已物化版本，否则 `TASK_PLAN_REVISION_CONFLICT`）。

### 3.3 交互状态

`PENDING → RESOLVED`（用户批准 / 答复）/ `REJECTED`（拒绝）/ `EXPIRED`（超时策略触发）/ `CANCELLED`（任务终态清理）。

- 解决动作幂等：`PENDING → RESOLVED` 条件更新，重复提交返回当前状态而非报错；
- 授权"仅本次"在用于当次执行后置 `usedAt`；"本任务内"允许多次使用，每次使用写审计事件；
- 任务终态时批量校验并失效所有 PENDING 授权（联动"临时授权任务期失效"硬约束）。

## 4. 接口与契约

### 4.1 对外 HTTP（OpenAPI，packages/contracts）

| 操作 | 说明 |
| --- | --- |
| `GET /assistant/tasks` | 任务列表（按状态 / 发起人 / 时间过滤；分页沿用既有列表约定） |
| `GET /assistant/tasks/{id}` | 任务详情：当前计划版本、步骤、挂起事项、产出引用、事件摘要 |
| `GET /assistant/tasks/{id}/events` | 事件重放（`since` 序号游标）+ SSE 增量订阅（断线重连） |
| `POST /assistant/tasks/{id}/confirm` | 确认计划：请求体 `decision`（`start` 开始执行 / `revise` 生成新草案）与澄清项答复 `answers`；幂等；**确认前不派发任何步骤** |
| `POST /assistant/tasks/{id}/cancel` | 取消任务（终态清理） |
| `GET /assistant/tasks/{id}/outputs` | 产出验收视图：产出清单（含归档结果与建议）与可归档知识库候选（服务端权限硬过滤） |
| `POST /assistant/tasks/{id}/outputs/confirm` | 产出验收与归档：逐产出携带 `knowledgeBaseId`，校验目标库 EDITOR+ 权限后触发既有转存链路；幂等；仅任务终态可提交 |
| `POST /assistant/task-interactions/{id}/resolve` | 解决挂起事项（授权批准/拒绝、提问答复、裁决选项）；幂等 |
| `GET /assistant/agents`、`GET /assistant/agents/{id}` | 同事列表与档案（含学习记录、工作记录分页） |
| `POST /assistant/suggestions` | 拉取建议（`scene`：conversation_starter 等）；轮后建议仍随轮次流下发 |
| `GET /assistant/conversations` | 会话列表：沿用既有列表操作，新增对话对象筛选参数（`agentId`，缺省 = 全部） |
| `POST /assistant/conversations` | 创建会话：`agentId` 指定对话对象（缺省 = 总管）；与某同事已有会话时可定位复用 |

说明：表中同事面操作（`GET /assistant/agents`、`GET /assistant/agents/{id}`）与会话对话对象扩展（列表 `agentId` 筛选、创建时指定对象）为设计目标、尚未实施（见文首进展段）。

- 契约以**新增为主**：不改动既有操作的请求/响应结构；需要复用会话的事件结构时引用既有 schema；会话接口是**扩展参数**而非重构（`agentId` 可空、缺省语义与现状一致）；
- 契约变更后重新生成 `packages/api-client`，并同步 Dart / Python 客户端使用面；
- 新增权限码（沿用既有命名风格）在权限清单登记：**v1 已落地 `ai.task.create` / `ai.task.read`**（任务面接口门禁）；任务管理、授权审批、同事管理、同事对话等权限码随对应功能实现再登记，并纳入角色模板默认集评审。

### 4.2 任务事件推送

- 任务事件流与轮次事件流**并行存在**：客户端在会话页同时订阅两个流，渲染层合并（任务卡片实时更新）；
- 重放语义与轮次一致：`(taskId, seq)` 游标，客户端记录 `lastSeq`，重连补拉；
- 事件 payload 只含展示字段（步骤名、同事名、状态、摘要、产出引用），不含内部权限与敏感参数；`plan_ready` 携带完整步骤清单与待澄清项（供确认卡片渲染）；`plan_revision_requested` 标记"调整中"（卡片进入调整态，重排生成新版本后由新的 `plan_ready` 复位）。

### 4.3 ai-service 内部契约

| 能力 | 说明 |
| --- | --- |
| 步骤执行 | 复用轮次执行管线：输入（同事人格指令、派发书、窗口消息、工具清单、预算）→ 输出（流式事件 + 终态产出：摘要 + 产出引用 + 依据引用）；无任务状态 |
| 编排决策 | 输入（决策类型 + 任务状态快照 + 步骤结果）→ 输出（选项 + 置信度 + 理由，结构化约束）；模型角色 `orchestration_decision` |
| 建议生成 | 开场建议：输入（权限筛选后的可用场景 + 企业动作摘要）→ 输出（建议列表，结构化约束） |
| 上下文压缩 | 复用现有：仅用于前台对话（主会话流）；步骤窗口不压缩、无截断（天然短；达调用上限时步骤直接失败，见 §5.2） |

- 鉴权沿用手册内 Token（`AI_INTERNAL_TOKEN`）与既有内部调用链路；
- 步骤执行与轮次执行共享"工具循环 + 事件协议"，差异仅在人格注入、预算护栏与回流格式。

## 5. 上下文组装与回流（派发书）

### 5.1 派发书结构

步骤派发时由 NestJS 组装（`brief Json` 快照）：

```
{
  taskGoal:         任务目标（总管理解后的完整表述）
  stepRequirement:  本步要求（做什么、完成标准、输出格式）
  assignee:         同事身份摘要（名称、职责定位）
  dependencies:     依赖产出的引用列表（摘要 + 资产引用，按需深读）
  lessons:          相关学习记录（相关性 + 适用范围过滤后）
  recentWork:       同事近期工作记录摘要（连续性）
  toolPolicy:       本步可用工具面（权限 = 发起人 ∩ 上限，服务端硬过滤）
  budget:           本步预算（调用次数 / token）
  outputContract:   产出格式约定（摘要必填、引用格式）
}
```

**组装原则**：只注入"执行本步必需"的内容；依赖产出以"摘要 + 引用"注入，原始内容由工具按需读取（保持读时最新）。

**落实现状（2026-09-28）**：`lessons` 与 `recentWork` 依赖 M4 的学习记录 / 工作记录体系，当前版本派发书尚未注入这两项；`toolPolicy` 快照只记数据源开关与预算，工具面在派发瞬间按「发起人实时权限 ∩ 步骤策略」裁剪，不把权限快照当作执行依据。

### 5.2 执行窗口

- 窗口 = 系统指令（同事人格 + 派发书）+ 窗口消息流（本步的模型轮次与工具调用）+ 工具面；
- 窗口消息写入 `assistant_task_step_messages`，与用户会话完全隔离；
- 工具调用沿用既有批准链：注册表校验 → 权限与数据范围 → 幂等 → 执行 → 审计；"需签字"级动作在步骤内触发挂起（第 3.3 节）；
- 超预算行为（对齐实现）：设计目标为「先截断窗口早期轮次、仍超再失败」；v1 实现为**调用次数上限直判**——步骤内模型调用 / 工具调用达上限（常量 `MAX_STEP_MODEL_CALLS = 5` / `MAX_STEP_TOOL_CALLS = 10`）即标记 FAILED（失败码 `STEP_MODEL_CALL_LIMIT_EXCEEDED` / `STEP_TOOL_LIMIT_EXCEEDED`），走失败处置阶梯；窗口截断未实现。

### 5.3 回流（摘要 + 引用）

步骤终态时回写三样（不变量之"回流永远是摘要 + 引用"）：

1. **summary**（摘要，必填，限长）：给状态总线、下游步骤与汇总使用；
2. **outputRefs**（产出引用）：生成文档 / 图片 / 业务资源的稳定引用（不存签名 URL，遵循既有 ToolCall 结果约定）；
3. **依据引用**：本步读过的关键数据源与工具调用记录（供"依据"视图与审计）。

长文本一律留在产出资产中；下游步骤需要全文时按引用读取（工具），不复制进派发书。

### 5.4 与既有压缩机制的关系

| 空间 | 机制 |
| --- | --- |
| 主会话流 | 现有压缩（阈值触发：LLM 摘要 + 保留近期消息）——总管生成计划、汇总答复依赖它 |
| 步骤窗口 | 不压缩、无截断；依赖"天然短"（无历史对话）+ 调用次数上限（达上限步骤失败，见 §5.2） |
| 任务状态总线 | 不是消息流，不压缩；每次调度从数据库现读 |

### 5.5 终态汇报与对话感知（v1，2026-09-29）

**终态汇报（任务 → 对话回流）**：`task-runner.finalizeTask` 在终态事务内追加一条 `ConversationMessage`（`role=ASSISTANT`，content 为模板拼装：完成 / 失败两套文案 + 产出文档清单（≤5 条、标题截断，取自当前计划版本 SUCCEEDED 步骤的 `outputRefs`，已删除文档剔除）+ 后续引导；整体截断 1000 字符），并同步推进 `Conversation.lastTurnAt`。挂载点选**会话最后一条终态轮次**：空轮次消息会被 `compareMessagesByTurn`（无轮次视为 0）排到会话最前，进行中轮次会把汇报插到该轮用户消息与回答之间——两者都不可用；会话缺失 / 无终态轮次 / 构建查询异常时跳过汇报（任务卡片与事件流始终是事实源）。CANCELLED 不发汇报（用户主动取消无需系统播报）。

**对话感知注入**：`turn-runner` 在工具轮次（每模型调用前重算）与纯聊天轮次把「最近 3 个终态任务（COMPLETED / FAILED / CANCELLED）+ 各至多 3 份产出文档标题」注入 instructions，让模型在后续对话中准确回答任务进展与产出去向；汇报消息本身也经 `loadMessagesAfterBoundary` 进入后续上下文，本注入是长会话压缩后的兜底。任何查询异常都降级为不注入，对话本身不受影响。

**边界**：对话内查询任务列表 / 详情的工具未实现（任务进展与产出仍在任务卡片 / 任务页查看）；汇报消息不产生会话轮次、不写任务事件。

## 6. 编排决策器（OrchestrationDecider）

### 6.1 接口

```ts
// apps/api/src/assistant/orchestration/decider/decider.types.ts（已落地）
interface OrchestrationDecider {
  decide(input: DecisionInput): Promise<Decision>;
}

type DecisionInput = {
  decisionType: 'SUFFICIENCY_CHECK' | 'ROUTING' | 'COMPLETION_CHECK'
              | 'RISK_SCORE' | 'REPLAN_TRIGGER' | 'FAILURE_HANDLING';
  context: { tenantId: string; userId: string; requestId: string }; // 调用载体（模型调用与审计）
  taskSnapshot: TaskSnapshot;   // 结构化状态：目标、计划版本、步骤状态、步骤摘要
  stepResult?: StepResult;      // 判定场景下的当前步骤产出摘要（信息充分性附拟提问内容与防滥用统计；失败处置附失败分类与尝试余量）
};

type Decision = {
  choice: string;               // 选项（SUFFICIENCY_CHECK：ask_user / proceed；FAILURE_HANDLING：retry / escalate）
  confidence: number;           // 0~1（规则路径为 1；LLM 路径为模型自评）
  rationale?: string;           // 理由（进审计与排障）
};
```

### 6.2 首版实现（v1：规则 + LLM 组合）

- **规则路径**（确定性场景，不调模型）：v1 已落地——`SUFFICIENCY_CHECK` 的防滥用判定（提问超限 / 同类未决去重）直接判 `proceed`；`FAILURE_HANDLING` 的失败阶梯判定（可重试且未超限 → `retry`，否则 → `escalate`；上下文缺失时工厂兜底同样升级用户——安全方向）；其余决策类型（ROUTING / COMPLETION_CHECK 等）在 v1 由代码路径确定性处理，未接入决策器；**重排触发（REPLAN_TRIGGER）当前由用户驱动**（计划卡片「调整要求」或失败裁决「调整计划」），自动重排不在当前范围，接入时沿用同一决策器接口；
- **LLM 路径**（模糊场景）：结构化输出约束（JSON Schema 校验 + 失败重试一次），走 `orchestration_decision` 模型角色；调用失败不阻塞流程——按"放行提问"兜底并留审计；
- **置信度分流**：`ask_user` 无论置信度放行（安全方向）；`proceed` 仅 `>= highThreshold`（默认 0.9）采纳，低于阈值转为放行提问（不替用户冒险裁决）；阈值按租户可配置是目标形态，v1 以环境变量提供全局默认；
- **实现形态**：`rule_llm`（规则先判、不可判交 LLM）与 `rule`（纯规则：无抑制条件时放行提问）两种模式，按 `ORCHESTRATION_DECIDER` 切换；v2 接入 JEV 只替换工厂装配（§6.3）。

### 6.3 演进（v2：JEV）

- JEV 以 Choice / Score / Noul 原子原语实现同一接口，返回带置信度的选项；
- 替换点只有工厂装配（配置项切换实现），流程代码零改动；
- 验证方式：同一批任务快照回放两套实现，对比决策差异与置信度校准。

## 7. 调度运行器

### 7.1 task-runner（任务级循环）

- **驱动方式**：事件驱动 + 租约续跑——步骤终态事件触发"任务步进"，每轮从数据库现读快照：收拢未处置失败 → 依赖推进 → RUNNING 防护 → 派发最早就绪步骤（退避中的跳过）→ 挂起步骤的裁决应用与找回 → 无进展让行 → 终态判定；
- **执行租约**：复用轮次执行器的 `executionOwner` / `leaseExpiresAt` / `heartbeatAt` 模式，抢占式条件更新，杜绝双执行；
- **失败处置先行**：快照存在 FAILED 步骤时先经失败处理服务按阶梯处置（自动重试写退避时间 / 升级建裁决并转挂起），处置后循环重入；每次判定写决策评估审计；
- **让行与恢复**：退避等待（READY 且 `retryAfterAt` 未到）、等待重排（失败裁决已选"调整计划"）或残留 PENDING 时运行器释放任务租约让行，由恢复扫描到点后重新抢占续跑（恢复扫描跳过等待重排的任务）；服务启动扫描"RUNNING 且租约过期"的任务与步骤，续跑或按阶梯处置（对齐 `turn-recovery` 的既有思路）；
- **并发边界**：一个任务同一时刻只被一个运行器实例推进；步骤内并行受依赖图约束（无依赖步骤可并行派发）。

### 7.2 step-runner（步骤级执行）

1. 校验步骤状态（READY → RUNNING 条件更新）与预算；
2. 组装派发书（第 5.1 节）→ 调 ai-service 步骤执行 → 流式写窗口消息 + 任务事件；
3. 工具互动：批准链内联；协议工具 `ask_user`（不注册工具注册表、恒在执行面内）先经决策器信息充分性判定，需用户介入 → 创建 Interaction（提问 / 裁决）、步骤转 WAITING_USER、任务事件推送、**释放执行权**（不占用租约）；
4. 终态回流：摘要 + 引用写回 → 步骤 SUCCEEDED/FAILED → 触发 task-runner 步进（FAILED 由失败处理服务按阶梯统一处置，见 §7.1）；
5. 交互解决后：步骤 `WAITING_USER → RUNNING`（attemptNo 不变，从断点继续），重入执行窗口。

### 7.3 幂等清单

| 对象 | 幂等键 |
| --- | --- |
| 任务创建 | `(conversationId, idempotencyKey)` + requestHash |
| 计划确认 / 任务取消 | 状态条件更新（重复提交返回当前态） |
| 步骤执行 | `(stepId, attemptNo)` 租约独占；工具调用沿用 `ToolCall` 幂等键 |
| 交互解决 | `PENDING → RESOLVED` 条件更新 |
| 失败处置 | FAILED → 处置 条件更新：重试（入 READY + 退避时间）/ 升级（入 WAITING_USER + 建交互），各只生效一次；终局标记后不再处置 |
| 失败裁决应用 | WAITING_USER + 已解决裁决 → 落状态 条件更新（解决接口与调度循环双入口，重复应用无副作用）；"调整计划"不落状态（保持挂起等待重排） |
| 重排版本生成 | `revisionKey` 唯一约束（同一次工具调用重放回读已生成版本）；`(taskId, version)` 冲突报错 |
| 再次确认物化 | 目标版本 ≤ 已物化版本拒绝（`TASK_PLAN_REVISION_CONFLICT`）；条件更新抢占确认 |
| 事件消费（客户端） | `(taskId, seq)` 去重 |

## 8. 权限与安全落地

- **权限推导链**（每步执行时实时求值，不缓存快照）：发起人实时权限 ∩ 同事 `permissions` 上限 → 生成工具面；工具注册表与 `tool-policy` 在工具调用点二次校验（纵深防御）；
- **三级映射**：自决 = 直接执行；需签字 = 生成 AUTHORIZATION 交互挂起（批准后临时授权生效，仅任务期）；禁止 = 拒绝并让模型转向替代方案；
- **临时授权校验链**：批准记录（Interaction）→ 使用时刻校验（任务未终态、scope 未耗尽、权限项匹配）→ 使用写审计；
- **数据范围**：全部读写不绕过数据范围解析；步骤产出对用户的可见性按产出资产自身的权限规则执行；
- **审计事件**（沿用既有审计体系）：任务创建 / 计划确认 / 每次派发与工具调用 / 挂起与恢复 / 授权申请·决定·使用 / 产出确认 / 终态清理；记录租户、操作者（membershipId）、请求、资源与元数据；
- **敏感边界**：任务事件与卡片 payload 只含展示字段；派发书与步骤消息属内部数据，不通过公开接口整体暴露（详情接口按角色折叠）。

## 9. 建议系统技术方案

### 9.1 Provider 抽象（服务端）

```ts
interface SuggestionProvider {
  scene: SuggestionScene;           // conversation_starter / turn_follow_up / task_follow_up
  canGenerate(ctx: SuggestionContext): Promise<boolean>;
  generate(ctx: SuggestionContext): Promise<Suggestion[]>;
}
```

- `Suggestion = { scene, text, rank, source, expiresAt }`；注册表按场景装配，可插拔；
- **权限硬过滤在 Provider 外层统一执行**：生成的建议逐条做权限预检（涉及的动作 / 数据当前用户可达），不可达即丢弃——绝不出现无权建议。

### 9.2 场景实现

| 场景 | 实现 |
| --- | --- |
| 轮后建议（follow_up） | 现状接入：ai-service 随答复生成 → 契约事件 `related_questions` → 持久化 `AssistantTurn.relatedQuestions` → 桌面端渲染（前端接入是本项的直接工作） |
| 任务建议（task_follow_up） | 任务完成事件触发：基于产出摘要生成下一步建议（如"转为 PPT"），随任务事件下发 |
| 开场建议（starter） | 服务端聚合：用户权限筛选可用场景 × 企业动作摘要（进行中任务、近期产出、动态）→ ai-service 生成 → Redis 短 TTL 缓存（按用户维度，避免高频调用）；拉取接口见 4.1 |

### 9.3 前端接入点

- 桌面端：会话页建议条（点击即以该文本发起轮次）；开场建议位于输入框上方（保护现有输入框组件形态）；
- 移动端：复用同一契约事件与拉取接口，形态按端设计。

## 10. 实现落点

### 10.1 app/api（NestJS）

| 目录 | 内容 |
| --- | --- |
| `src/assistant/orchestration/` | `task.service.ts` / `task-runner.service.ts` / `step-runner.service.ts` / `plan.service.ts` / `step-state.service.ts` / `interaction.service.ts` / `failure-handling.service.ts` + `step-failure.ts`（失败收拢与裁决应用、可重试分类）/ `decider/`（接口 + 规则实现 + LLM 实现 + 工厂装配） |
| `src/assistant/tools/executors/` | 编排工具：`create-orchestration-task.tool.ts` / `revise-orchestration-task.tool.ts`（共享参数校验与名册兜底在 `orchestration-plan-arguments.ts`）；`runtime/turn-runner.service.ts` 注入计划调整引导 |
| `src/assistant/agents/` | `agent.service.ts` / `lesson.service.ts` / `work-record.service.ts` |
| `src/assistant/suggestions/` | Provider 注册表 + 各场景 Provider + 权限预检 |
| `src/assistant/api/` | 任务 / 交互 / 同事 / 建议控制器（沿用既有控制器与 DTO 风格） |
| `prisma/migrations/` | 新增模型迁移（全为新增表，无破坏性变更） |

### 10.2 apps/ai-service（Python）

- 步骤执行（落实现状）：复用既有轮次执行管线，未新增独立「步骤执行模式」——派发书与步骤指令以 instructions 注入、窗口消息按轮次请求下发（服务端组装见 §7.2），产出与依据经工具结果回流；
- 编排决策调用（已落地，契约 0.8.0）：`orchestration_decision` 模型角色 + 结构化输出校验（失败重试一次）；
- 归档建议调用（已落地，契约 0.8.1）：`archive_suggestion` 模型角色，产出归档候选与理由，失败降级为空建议；
- 开场建议生成（未实施）：复用现有建议生成的提示组织方式，待建议系统实施。

### 10.3 apps/desktop / apps/mobile

- 任务视图：任务列表（进行中 / 等你拍板 / 已完成 / 未完成）+ 详情（步骤流、产出、依据、挂起事项）；
- 会话页：任务卡片（订阅任务事件流实时更新）、建议条、确认卡片与授权卡片（复用写操作确认的卡片组件形态）；
- api-client 由契约生成后接入（不手写接口层）。

### 10.4 契约与生成物

- `packages/contracts/openapi.yaml` 新增任务 / 交互 / 同事 / 建议相关操作与 schema；
- 重新生成 `packages/api-client`；Dart / Python 客户端按需同步；`docs/api` 更新。

## 11. 配置与迁移

| 配置项 | 说明 | 默认 |
| --- | --- | --- |
| `ORCHESTRATION_DECIDER` | 决策器实现选择（`rule_llm` / `rule`；v2 接入 JEV 时的语义位） | `rule_llm` |
| `ORCHESTRATION_CONFIDENCE_HIGH` | 高置信阈值 | 0.9 |
| `ORCHESTRATION_CONFIDENCE_LOW` | 低置信阈值 | 0.6 |
| `ORCHESTRATION_STEP_RETRY_MAX` | 步骤最大尝试次数（含首次；用户显式重试不受限） | 3 |
| `ORCHESTRATION_STEP_RETRY_BACKOFF_SECONDS` | 重试退避基础秒数（退避 = 基础 × 2^(尝试次数-1)；0 = 立即重试） | 30 |
| `ORCHESTRATION_STEP_MSG_RETENTION_DAYS` | 步骤消息保留天数 | 30（**未实现**：v1 无清理任务，写入后长期保留） |
| `ORCHESTRATION_MAX_STEPS` | 单任务步骤上限（护栏） | 设计目标配置化默认 20；v1 未实现为环境变量，实际为工具层常量 `MAX_STEPS = 8`（创建 / 重排计划时校验） |
| `ORCHESTRATION_MAX_AUTHORIZATIONS_PER_TASK` | 单任务授权申请创建次数上限（防滥用；0 表示不限） | 10 |
| `ORCHESTRATION_MAX_QUESTIONS_PER_TASK` | 单任务提问 / 裁决创建次数上限（防滥用；0 表示不限） | 10 |
| `ORCHESTRATION_SUSPEND_TIMEOUT_MINUTES` | 挂起（授权 / 提问 / 裁决）超时分钟数；0 = 无限等待 | 0 |
| `ORCHESTRATION_SUSPEND_TIMEOUT_ACTION` | 挂起超时动作（`continue_default` / `skip_step` / `fail_task`） | `continue_default` |
| 模型角色 | `orchestration_decision`（已落地）/ `archive_suggestion`（已落地）在模型配置中登记；`step_execution` 为设计预留（步骤执行复用轮次角色） | 沿用 `config/models.*.toml` |

- **迁移顺序（对齐实现）**：同事表 `assistant_agents`（`20260928083803`）→ 任务六表（任务 / 计划 / 步骤 / 步骤消息 / 事件 / 交互，`20260928083926`）→ `ToolCall` 挂接任务步骤（`turn_id` 放宽可空 + `task_step_id`，`20260928100000`）→ 计划重排幂等列 `assistant_task_plans.revision_key`（M3-R 增量，`20260929113000`）→（M4）同事数据源 / 学习记录 / 工作记录与建议缓存 —— 除重排幂等列与 `ToolCall` 可空放宽外全为新增，无破坏性既有数据变更；
- **兼容性**：既有对话链路零破坏；`related_questions` 字段与流程保持；新增事件类型不影响旧客户端（未知类型忽略）。

## 12. 验证矩阵（对齐工程约定第 6 节）

| 范围 | 验证 |
| --- | --- |
| NestJS 编排层 | jest 受影响模块：状态机转换、幂等、租约抢占、挂起恢复、失败阶梯与裁决、计划重排与沿用物化、会话引导注入、权限推导、决策分流 |
| ai-service | pytest：步骤执行模式、结构化输出校验、决策调用 |
| 契约 | 校验 + 重新生成 api-client + 受影响端集成验证 |
| 桌面端 | TypeScript 检查 + 生产构建；任务视图与卡片交互走查 |
| 端到端 | M1-M4 验收场景（需求设计第 10 节）逐条走查：双通道、计划确认、挂起恢复、临时授权约束、断线续做、沉淀正确 |

## 13. 风险与开放问题

| 风险 / 开放项 | 应对 |
| --- | --- |
| 模型生成计划的结构稳定性 | JSON Schema 校验 + 校验失败重试一次 + 兜底"澄清提问"；计划必须经用户确认才生效 |
| 长任务成本失控 | 预算护栏（单步 / 单任务上限）、超预算截断（未实现，v1 为调用上限直判，见 §5.2）与失败升级、用量按现有口径记录 |
| 步骤消息的存储增长 | 保留策略（默认 30 天，可配置）尚未实现（v1 长期保留，见 §11）+ 摘要回流后原文价值低 |
| JEV v2 接口对齐（外部决策引擎形态） | 先用同一批任务快照回放对比；接口只依赖 Choice / Score / Noul 三原语与置信度 |
| 开场建议的质量与延迟 | 权限前置筛选 + 短 TTL 缓存 + 可配置开关（效果未达预期可下线该场景，不影响其他场景） |
| 自动任务（定时触发）扩展 | 复用任务模型与流水线；触发调度不在本期范围，先保留 `originType=AUTO` 语义位 |
