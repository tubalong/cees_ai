# AI 助手业务写操作（聊天式部门/知识库操作与写操作确认）

> 主设计文档。关联：
> - [Assistant Tool Loop](../architecture/assistant-tool-loop.md)（工具循环、程序化批准、失败语义）
> - [组织与部门管理](organization-department-management.md)（部门业务规则）
> - [知识库管理](knowledge-base-management.md)
> - [桌面安全加固](../engineering/desktop-security-hardening.md)（IPC / 令牌存储）
>
> 契约版本：**0.37.0**（新增 `assistant/action-drafts` 两个端点 + `tool_result.awaiting_confirmation`）。

## 1. 要解决的问题

用户在对话里说「帮我新增一个部门，叫华东销售部，放在销售中心下面」，期望：

1. 参数不全时，AI 先**追问**（部门叫什么？是否挂在某个上级下？）；
2. 同名的上级部门有多个时，AI 列出候选让**用户消歧**，不自行挑选；
3. 参数齐全后，AI 展示**即将执行的效果**让用户确认；
4. 用户确认后，AI 才真正调用业务接口写入，并如实回报结果；
5. **查询**类操作不需要确认：有权限就直接查，无权限就直接告知。

## 2. 分层：发现工具 + 动作工具

沿用 [assistant-tool-loop.md 第 14 节](../architecture/assistant-tool-loop.md) 已确认的两层工具模型：

| 层 | 工具 | 风险级别 | 行为 |
| --- | --- | --- | --- |
| 发现（discovery） | `list_departments` | `READ` | 直接执行，返回带 `department_id` 的候选清单 |
| 动作（action） | `create_department` | `WRITE` | **不直接执行**，先落待确认草稿，用户确认后才写入 |

模型负责「自然语言 → ID」的映射；**ID 的最终裁决权在用户**：

- 服务端不做名称模糊匹配（歧义责任不清，且会让模型误判）；
- 工具返回的候选里带 `department_id`，但指令明确要求**不得把 ID 展示给用户**；
- 匹配到多个候选时必须列出让用户选。

> 已按同一模式改造的既有工具：`create_knowledge_base`（原本直接落库，现在同样走确认）。

### 2.1 `list_departments`

- 权限：`department.read`；参数：无（多余参数一律拒绝，防止模型臆造筛选条件）。
- 返回扁平候选（含 `parent_department_name` 与 `member_count`），而不是部门树：
  模型需要的是「可消歧的扁平候选 + 上级关系」，不是展示结构。

### 2.2 `create_department`

- 权限：`department.create`；参数：`name`（必填）、`parent_department_id`、`description`、`sort_order`。
- `parent_department_id` 必须是 UUID（取自发现工具），否则拒参数。
- **执行复用 `OrganizationService` 的同一实现**（父部门校验、同级重名冲突、事务、审计），
  只是上下文来源不同：新增 `createDepartmentForContext(context, input)`，
  不读 `AsyncLocalStorage`，让无请求级上下文的确认路径也能复用同一套业务规则。
  因此对话路径**不可能绕过**业务约束，也不需要为 AI 单独维护一套写入逻辑。

### 2.3 项目与任务工具

| 工具 | 风险 | 权限 | 说明 |
| --- | --- | --- | --- |
| `list_projects` | READ | `project.read` | 发现层：返回 `project_id`、状态、成员/任务数 |
| `create_project` | WRITE+确认 | `project.create` | 新建项目，负责人默认为发起人 |
| `list_tasks` | READ | `task.read` | 发现层：按项目列出任务（含子任务），返回 `task_id` |
| `list_tenant_members` | READ | `member.read` | 按姓名或账号查找当前租户有效成员，返回候选供用户消歧 |
| `add_project_member` | WRITE+确认 | `project.member.manage` | 将已确认的租户成员加入项目，可设为项目成员或项目经理 |
| `create_task` | WRITE+确认 | `task.create` | 新建任务，执行人默认发起人并在卡片写明 |
| `assign_task` | WRITE+确认 | `task.assignee.manage` | 将项目内任务分配给项目成员，同时保留已有协作人 |
| `update_task_status` | WRITE+确认 | `task.status.update` | 推进任务状态（进行中/受阻/完成/取消） |

项目协同聊天固定先走发现再走动作：先用 `list_projects`、`list_tasks`、`list_tenant_members` 定位候选；同名或多候选由用户消歧；写操作再生成确认草稿。`add_project_member` 和 `assign_task` 的确认阶段会再次检查项目、成员和任务可见性，执行阶段重新读取任务版本并复用业务 Service 的权限、租户、项目成员和审计校验。

两个刻意的设计决定：

- **执行人默认发起人**：任务必须有执行人（业务 DTO 要求），而对话场景里「提醒我做某事」占绝大多数。
  省略执行人时默认取发起人，并在确认卡片上写明「执行人：你（当前账号）」；
  同时在回喂模型的摘要里提示「若用户其实想派给他人，请提示用户改为明确指定执行人」，避免误派。
- **状态变更不使用草稿里的版本快照**：`update_task_status` 在**执行瞬间**重新读取任务取最新 `version`，
  因为用户确认的语义是「把任务标记为完成」，而不是「在我看到的那一版上完成」；
  沿用陈旧版本会因他人刚改过标题而莫名失败。状态机的合法性仍由业务层 `ALLOWED_TRANSITIONS` 校验。

### 2.4 复用既有业务 Service：`runAsTenant`

业务 Service 普遍通过 `TenantContext.require()`（AsyncLocalStorage）读上下文，而工具既可能在
后台轮次里执行（无请求上下文，甚至由 `TurnRecoveryService` 在定时任务中恢复），也可能在确认接口里执行。
`tool.types.ts` 的 `runAsTenant()` 把工具上下文注回 ALS：

```ts
const result = await runAsTenant(this.tenantContext, context, () =>
    this.projectService.listProjects({ keyword, status, includeArchived: false, limit: 50 }));
```

价值：

- 业务 Service **一行不改**即可被工具复用，新增工具不再需要业务侧配合；
- 上下文里的 `roles` 与 `permissions` 取**执行瞬间**的实时解析结果，不沿用生成工具清单时的快照；
- 需要额外能力时仍推荐提供显式入口（如 `createDepartmentForContext`），二者可共存。

### 2.5 已接入工具全清单

| 风险 | 工具 |
| --- | --- |
| READ（有权限直接执行） | `knowledge_search`、`list_departments`、`list_documents`、`list_knowledge_bases`、`list_knowledge_documents`、`list_projects`、`list_tasks`、`list_tenant_members`、`web_search` |
| WRITE + 待确认草稿 | `create_department`、`create_knowledge_base`、`create_project`、`add_project_member`、`create_task`、`assign_task`、`update_task_status`、`import_finance_ledger` |
| WRITE + 专属 UI 确认 | `save_to_knowledge`（目标知识库由用户在专门弹窗里选，不走草稿）、`insert_document_image`（在用户指定的文档章节末尾追加，不重写正文） |
| EXTERNAL（生成新资产，直接执行） | `generate_docx`、`generate_pdf`、`generate_pptx`、`generate_xlsx`、`generate_image` |

> 两个「WRITE 但不走草稿」的工具是**有意的例外**：它们的副作用是「把已有内容挂到用户指定的容器上」，
> 既不创建新的组织级对象也不覆写既有数据，且确认动作由专属 UI 承担。新增工具若想走这条例外，
> 必须在评审中说清“为何不需要草稿”。

> `list_knowledge_bases` 与 `list_knowledge_documents` 的分工：前者回答「我有哪些知识库」，
> 后者回答「某个库里有哪些文档」。两者都只覆盖**真实成员库**（或 `manage_all`/`read_all`
> 短路下的租户库），刻意不含锚点人群虚拟 READER 库——锚点只给页面可见性，若允许列清单
> 就会出现「列得出来、检索不到」的不一致（内容触达必须真实成员或全读权限码）。
> `list_knowledge_documents` 的存在也是为了让模型能区分「库里真的没有」与「检索没命中」：
> `knowledge_search` 只按问题召回片段，无命中时无法自证库内状况。

> `import_finance_ledger` 不接收模型生成的行数据：调用参数必须为空对象，行数据由服务端
> 从本轮唯一 XLSX/CSV 附件确定性重建，避免模型转抄上百行台账时出现金额或列错位。

### 2.6 文档与演示模板

PDF 与 PPTX 导出共用六套确定性渲染主题：

| 模板 | 定位 |
| --- | --- |
| `business-standard` | 稳重商务 |
| `editorial-modern` | 现代图文 |
| `executive-dark` | 深色高管 |
| `product-story` | 产品发布、路线图和市场叙事 |
| `academic-clean` | 研究报告、数据分析和方案评审 |
| `minimal-mono` | 极简黑白、打印和正式归档 |

模板只影响 PDF/PPTX 确定性渲染层的版式色板，不改变 DocumentSpec、生成内容、权限或审计边界。桌面端文档导出页可以选择主题；聊天生成的 `generate_pdf` 与 `generate_pptx` 仍走同一资源和审计链路。

### 2.7 不在工具清单里的本机能力

桌面端有一部分能力**刻意不注册成 AI 工具**，而是走「只读上下文 + 客户端动作」两条路径。
它们不在上表内，评审新增本机能力前必须先读本节：

| 能力 | 通道 | 为什么不算工具 |
| --- | --- | --- |
| 磁盘容量 / 目录大小扫描 | 客户端按消息触发后作为 `LOCAL_SYSTEM` 只读上下文上报 | 路径只能来自系统选择器，模型不参与决策，也没有可传参数 |
| 隔离 / 恢复 / 永久清理 | 同上；确认由 Electron 原生对话框与清单 hash 承担 | 副作用只作用于用户当面选中的对象，不进模型可调用面 |
| 生成产物**另存到本机** | 用户在资源卡片点「保存到…」，由系统保存对话框决定路径 | 纯客户端动作；模型只知道「可另存」这一事实（`local_capabilities` 上下文），无法指定路径 |

共同点：**模型不能传路径、不能传命令、不能替用户确认**。这与云端写工具形成互补——
云端写操作靠草稿 + 权限复核，本机操作靠原生对话框 + 路径不入模型上下文。
`local_capabilities` 只用于让模型正确引导用户（不再回答「我无法保存到你的电脑」），
其契约语义仍是「仅作只读参考，不作为业务事实或写权限依据」。

## 3. 写操作确认机制

### 3.1 数据模型

新增 `AssistantActionDraft`（`assistant_action_drafts`，迁移 `20260922091500_assistant_action_drafts`），
作为「**待确认草稿**」的唯一事实源：

| 字段 | 作用 |
| --- | --- |
| `toolCallId` | 唯一，一比一对应产生草稿的工具调用，同时是执行幂等键 |
| `toolName` / `toolVersion` | 确认时要重新解析工具定义（可能已下线） |
| `arguments` | 经 `validate` 归一化的**参数快照**——确认时唯一信任的来源 |
| `preview` | 面向用户的预览（标题 + 字段列表），不含内部 ID 与权限枚举 |
| `status` | `PENDING_CONFIRMATION → CONFIRMED → EXECUTED / FAILED`，用户取消为 `REJECTED` |
| `expiresAt` | 15 分钟；过期后不可确认 |

同时给 `ToolCallStatus` 增加 `AWAITING_CONFIRMATION`：该状态下**副作用尚未发生**。

> 与 `AIActionDraft` 的分工已按第 15 节遗留问题裁定：`AIActionDraft` 保留「已执行动作流水」
> 语义（生成图片/文档后以 `EXECUTED` 留痕），`AssistantActionDraft` 专管「待用户确认的业务写」。
> 两者语义不同，合并会导致无法区分「已写」与「待写」。

### 3.2 工具侧接口

`ToolDefinition` 新增可选钩子：

```ts
buildConfirmation?(
  context: ToolConfirmationContext,   // 只有身份与租户事实，不含执行租约
  input: Record<string, unknown>,
): Promise<ToolConfirmationRequest>;   // { title, fields, summary }
```

- `ToolConfirmationContext` 刻意不含 `executionOwner` / `executionToken` / `signal`：
  生成预览不执行副作用，不应持有执行期租约，避免作者误以为可以在预览阶段调用业务写服务。
- 钩子负责把参数翻译成用户能核对的内容（例如把 `parent_department_id` 译成部门名），
  否则确认卡片上只有一串 UUID。
- 钩子抛错（例如上级部门已不存在）→ 按工具被拒绝处理，**不生成一份注定失败的草稿**。

### 3.3 轮次内的拦截点

`TurnRunnerService` 在工具通过程序化批准后增加一个分支：

```
approve(工具存在 → 权限 → 参数校验)
  ├─ riskLevel=READ            → 直接执行
  ├─ riskLevel=WRITE + buildConfirmation → 落草稿 + AWAITING_CONFIRMATION，不执行
  └─ riskLevel=EXTERNAL（生成图片/文档）→ 直接执行（幂等、无破坏性）
```

随后以 `tool_result` 事件（`status: awaiting_confirmation` + `confirmation` 预览）推给客户端，
并把 TOOL 消息回喂模型，让模型能自然地说出「请确认」而不是「已创建」。

### 3.4 确认 / 取消

| 接口 | 说明 |
| --- | --- |
| `POST /assistant/action-drafts/{draftId}/confirm` | 确认并执行 |
| `POST /assistant/action-drafts/{draftId}/cancel` | 取消 |

**确认时只提交 `draftId`**，参数一律取草稿快照。执行前的四道校验：

1. 草稿存在且属于当前成员（不属于一律 404，不泄露草稿存在性）；
2. `status === PENDING_CONFIRMATION` 且未过期（否则 409）；
3. **重新解析成员实时权限 + 重新执行 `definition.validate`**（创建草稿后被回收权限 → 403 并把草稿置 `REJECTED`）；
4. **重新核对成员状态**（`isActiveMembership`：停用 / 删除 / 租户停用 → 403）。

然后抢占式流转：`PENDING_CONFIRMATION → CONFIRMED` 的条件更新只有一次成功，
双击或重试拿到的都是 409，因此**不会重复写入**。

收口在同一事务内完成：草稿终态 + `ToolCall` 终态 + TOOL 消息 + `AuditLog` + 追加回**原轮次**的
`tool_result` 事件。事件追加回原轮次是关键：客户端重放 `events?afterSeq=N` 时能看到
`awaiting_confirmation → completed` 的完整演化，而不是永远停在待确认。

### 3.5 审计与脱敏

- 审计只记 `toolName` / `toolVersion` / `toolCallId` / `executedResourceId` / `errorCode`；
  **不落参数快照**（可能含业务敏感信息）。
- **执行失败时**，回喂模型的 `summary` 是固定的安全文案（不得携带权限码、错误码、动态错误详情），
  而**真实失败原因落库与公开事件**（`toolCall.errorMessage`、`tool_result` 事件的 `error.message`）。
  客户端据此告知用户具体原因——例如台账附件「第 172 行方向只能是收入或支出」。
  该分工是硬要求：只把友好文案给模型、只把具体原因给用户，两边都不能少。
  > 教训：此前的实现把确认预览失败的原因一并丢弃（`rejectToolCall` 未传 `errorMessage`，
  > 客户端也完全不渲染 `failed/rejected` 事件），结果是用户只被告知「操作未完成」、
  > 反复重试同一个错误，而排障所需的行号/字段名根本无处可查。
- **模型摘要与用户摘要必须分离**：工具若需要在后续调用中保留内部 ID、权限枚举或结构化指令，
  可将其放入仅回喂模型的 `ToolExecutionResult.summary`；确认接口、助手历史消息和客户端结果必须使用
  `ToolExecutionResult.userSummary`。`userSummary` 省略时才允许兼容回退到 `summary`，新增会暴露内部数据的工具不得省略。
  例如创建知识库后，模型可继续用内部 `knowledge_base_id` 调用 `save_to_knowledge`，用户只应看到
  「知识库“名称”已创建，你是该知识库的管理员」。提示词中的“不要展示内部字段”不是安全边界，服务端字段分流才是。

## 4. 客户端

两端共用同一套服务端工具与确认机制（工具在 NestJS，客户端只负责渲染）：

- **桌面端**：`apps/desktop/src/core/api.ts` 的 `confirmActionDraft` / `cancelActionDraft` / `listAssistantActionDrafts`；
  `TurnStreamEvent` 增加 `awaiting_confirmation` 与 `confirmation`；
  `apps/desktop/src/app/Workspace.tsx` 的 `ActionConfirmationCard` 展示预览字段与「确认执行 / 取消」，
  确认后立即转终态文案（避免重复点击），过期草稿不再提供确认按钮。
  样式 `apps/desktop/src/app/workspace.css` 的 `.action-confirmation`，颜色全走语义令牌。
- **移动端**：`apps/mobile/lib/src/core/mobile_api.dart` 的 `confirmActionDraft` / `cancelActionDraft`；
  `apps/mobile/lib/src/features/home/home_page.dart` 解析 `awaiting_confirmation` 事件后把草稿存入
  **页面级 `pendingConfirmations`**（而不是塞进消息体）：流式回答会反复重建气泡，
  放在气泡里的卡片会被重建丢掎；体验上也更像一个紧贴输入区上方的待办动作条。
  卡片按 Apple 最小触控目标以 44pt 高实现确认/取消两个按钮。

### 4.1 待办列表与抽屉（桌面端）

桌面端待确认项**不挂在消息上**，而是放在页面级列表 `pendingDrafts` + 输入框上方向上的抽屉：

- 事实源是 `GET /assistant/action-drafts`（PENDING_CONFIRMATION 且未过期），
  进入对话页与每轮结束后各刷新一次；流式事件只做即时插入。
- 列表项**不含参数快照**：确认时仍以服务端快照为准，客户端无法借列表接口替换业务参数。
- 抽屉提供逐项「确认执行 / 取消」与「全部确认」；批量确认**串行**执行，
  让部分失败能如实归因，而不是并发失败后互相掩盖。
- 待办数量以按钮形式常驻输入框上方，避免「有待办但用户不知道」。

> 为何必须改成常驻列表：此前确认卡片只随流式事件到达，且消息只展示**最后一条**确认项
> （`.at(-1)`），同时刷新页面即消失。后果是模型一次产出多个写操作（例如同时新建三个部门）时
> 用户只能看到最后一个、确认完以为已经完成，其余草稿静默过期——表现为「一次只能建一个」。

> 待办列表是**服务端事实源**，因此刷新后仍然可见；模型一次提出多个写操作时全部可见、
> 可逐项或一次性确认。

## 5. 失败与边界

| 场景 | 行为 |
| --- | --- |
| 参数不全 | 模型追问，不生成草稿 |
| 同名上级有多个候选 | 模型列候选让用户选，不生成草稿 |
| 上级部门在确认前被删除 | 预览阶段拒绝；执行阶段报失败并说明未写入 |
| 草稿过期 | 确认返回 409，需重新发起对话 |
| 确认前权限被回收 / 成员被停用 | 403，草稿置 `REJECTED`，无业务写入 |
| 重复确认 / 双击 | 第二次 409，只执行一次 |
| 工具已下线 | 草稿置 `FAILED`，返回明确文案 |
| 执行过程中业务报错 | 草稿 `FAILED`：**未产生写入**的文案 + `errorCode`，不泄漏原始错误 |

## 6. 新增一个业务写工具的步骤

### 6.1 必改（两处代码 + 一处业务入口）

1. 在 `apps/api/src/assistant/tools/executors/` 新建 `xxx.tool.ts`，实现 `ToolDefinition`：
   `riskLevel: 'WRITE'`、`validate`、`execute`、`buildConfirmation`。
2. 业务侧提供 `xxxForContext(context, input)` 形式的入口，**复用既有 Service 实现**，不要复制编排。
3. 在 `assistant.module.ts` 的 `providers` 注册（执行器在 `onModuleInit` 自注册）：
   ```ts
   import { XxxTool } from './tools/executors/xxx.tool';
   // providers: [ ..., XxxTool ]
   ```

补 spec：注册信息、参数校验、预览字段、执行入参。

### 6.2 条件性（按需）

| 情况 | 需要做的事 |
| --- | --- |
| 权限码在目录里不存在 | 加入 `src/rbac/permission-catalog.ts`，并写迁移把该权限回填给应持有的角色（否则**所有租户都没有**，工具对任何人都不可见） |
| 用户可能用自然语言指代既有对象（部门名/项目名/成员名） | 再加一个 `READ` 发现工具（如 `list_departments`）返回带 ID 的候选，并在 `instruction` 里要求"列候选让用户选、不要输出 ID" |
| 需要 `buildConfirmation` 里把 ID 译成名称 | 复用同一个发现工具的查询方法（`buildConfirmation` 允许只读查询，**不允许业务写入**） |
| 产物需要专属卡片（图片/文档类资源） | 才需要动桌面端；否则确认卡片是通用的，无需前端改动 |

### 6.3 完全不需要动（这是抽象的价值所在）

| 层 | 为什么不用动 |
| --- | --- |
| 确认链路本身 | `TurnRunner` 按 `riskLevel + buildConfirmation` 自动分派；草稿生命周期在 `AssistantActionDraftService` 内 |
| 幂等 / 审计 / 事件 / 断线重放 | 由草稿抢占 + `toolCallId` 唯一约束 + 事务收口统一保证 |
| `packages/contracts`（OpenAPI） | 工具是**内部**概念，不发公开契约，因此无需重新生成客户端 |
| `apps/ai-service`（Python） | 它只做"单次模型调用 + 选工具 + 填参数"，工具清单由 NestJS 通过 `ChatToolDefinition` 传入，Python 侧不需要知道工具语义 |
| 数据库 | 除非新功能本身需要新表；工具的"待确认"状态复用 `assistant_action_drafts` |
| 桌面端 / 移动端 | 确认卡片与 `awaiting_confirmation` 事件处理是通用的 |

> 判据一句话：**新增业务写工具 ≈ 写一个工具文件 + 注册一行**，
> 剩下的是"你的业务 Service 有没有一个能接受显式上下文的入口"。

### 6.4 约束与红线

- 工具名全局唯一，重复注册直接抛错（避免静默覆盖）。
- `riskLevel: 'WRITE'` 但**不**声明 `buildConfirmation` = 模型可直接落业务写入，
  必须评审确认这是有意的（幂等、无破坏性才可接受）。
- 生成新资产（图片/文档）保持 `EXTERNAL` 且直接执行，这是刻意的边界，不要改成确认。
- 工具面保持最小：模型调用次数上限 5、工具步数上限 10（`turn-runner.service.ts`），
  工具越多选错概率越高；按当前页面/权限动态收敛比一次全暴露更好。

> 任务 / 项目 / 财务等其余业务工具按同一模板接入即可；差异只在业务 Service 与预览字段。
> 当前已接入：`create_department`、`create_knowledge_base`（两者共用同一条确认链路）。

## 7. 测试

- `apps/api/src/assistant/tools/executors/departments.tool.spec.ts`：两个部门工具的注册、参数校验、
  预览字段解析、上级部门缺失拒绝、执行入参。
- `apps/api/src/assistant/drafts/assistant-action-draft.service.spec.ts`：草稿 TTL、
  越权 404、过期 409、已处理 409、权限回收 403、成员停用 403、抢占幂等、
  执行成功与失败的收口（含审计不落参数快照、失败文案不泄漏原始错误）。

> 这组测试在实现期间实际抓到过一个缺陷：一次重构意外删掉了确认时的成员状态复核，
> 测试直接失败——这也是把「安全断言」写成测试的价值所在。
