# AI 管家技术设计（草案）

> 状态：**草案（2026-09-28，待评审，未实现）**。本文是《[AI 管家：主动跟进与推动](../product/proactive-assistant.md)》的配套技术设计（施工图）：数据模型、状态机与幂等、证据链结构、接口草案、翻译调用链与规则框架要点。实施时以 Prisma 迁移与 `packages/contracts` 契约为准。
>
> 关联文档：[通知中心](../product/notification-center.md)｜[用户级记忆](user-memory.md)｜[Assistant Tool Loop](assistant-tool-loop.md)｜[上下文与压缩](contextual-chat.md)

---

## 1. 数据模型

> 命名遵循项目惯例（snake_case、Prisma 迁移演进）。以下为设计草案，实施时以迁移为准。

### 1.1 跟进记录 `assistant_follow_ups`（管家的笔记本，核心表）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `tenantId` | uuid | 租户隔离 |
| `ruleCode` | text | 产出它的规则（对应规则表的 code） |
| `recipientMembershipId` | uuid | 该谁管这件事（送达对象），成员维度不挂 User（防跨租户） |
| `objectType` / `objectId` | text / uuid | 业务对象（CONTRACT/TASK/APPROVAL…） |
| `severity` | enum | `INFO / WARNING / CRITICAL` |
| `status` | enum | `PENDING / RESOLVED / DISMISSED / EXPIRED`（状态机见 1.4） |
| `title` | text | AI 翻译的标题（校验失败时为模板文案） |
| `summary` | text | AI 翻译的说明（人话 + 为什么） |
| `evidence` | jsonb | 结构化证据链（见第 2 章），**不含自由文本大段原文** |
| `dedupKey` | text unique | `租户+规则+对象+收件人+窗口` 的哈希，幂等键 |
| `firstDetectedAt` / `lastDetectedAt` | timestamptz | 首次/最近一次被规则命中 |
| `deliveredAt` | timestamptz? | 实际送达时间（静默时段内可为 null） |
| `readAt` | timestamptz? | 用户查看过 |
| `resolvedAt` / `resolution` | timestamptz? / enum? | `MANUAL / RECOVERED / DISMISSED / EXPIRED` |
| `feedback` | jsonb? | 用户反馈（有用/没用/屏蔽类）供反馈闭环聚合 |
| `createdAt` / `updatedAt` | timestamptz | — |

### 1.2 规则配置 `assistant_follow_up_rules`

**设计取舍：** "规则完全配置化（让使用者写条件表达式）"会造出一个迷你规则引擎——超出第一期需要，而且错误配置会直接产生错误提醒，风险不可控。因此采用**"逻辑在代码、参数在表"**：

- **代码里**：每条规则一个 detector（确定性查询函数），产出命中事实包；
- **表里**（平台级，seed 内置）：`code`、`name`、`domain`（FINANCE/LEGAL/HR/PROJECT/COMMON）、`description`、`severity` 默认值、`thresholds`（jsonb，阈值参数如"停滞天数 14"）、`scanIntervalMinutes`、`dailyLimitPerUser`、`enabled`；
- 调整阈值、停用某条规则是**运营/配置工作**（改表），新增规则是开发工作（写 detector + 插一行配置）；
- 租户级阈值覆盖列为未来扩展点，第一期不做（避免表复杂度与权限点）。

### 1.3 提醒设置 `assistant_follow_up_preferences`

| 字段 | 说明 |
| --- | --- |
| `membershipId` unique | 个人级设置（与用户记忆同维度，不挂 User） |
| `enabled` | 总开关 |
| `dailyLimit` | 每日送达上限（默认 10） |
| `quietHours` | 静默时段（默认 22:00-08:00，租户时区） |
| `criticalBypassQuietHours` | 严重级别是否穿透静默（默认否） |
| `domainSwitches` | 按域订阅开关（jsonb：FINANCE/LEGAL/HR/PROJECT） |
| `minSeverity` | 最低送达级别（默认 INFO） |

无设置记录时使用默认值（惰性创建，不强制每人一行）。

### 1.4 状态机与生命周期

```
                     ┌──────────────┐
  规则命中 ────────▶ │   PENDING    │  （管家在跟进；可能未送达——静默期）
                     └──────┬───────┘
          用户"处理完了" ────▶ RESOLVED (MANUAL)
          用户"不用管"   ────▶ DISMISSED（短期抑制同类）
          下一轮复核不命中 ──▶ RESOLVED (RECOVERED)  ← 事情自愈（如合同已续签）
          超期未处理      ────▶ EXPIRED（默认 30 天，规则可覆盖）
```

技术注解：

- **自动复核（RECOVERED）**：每轮扫描先复查仍在 `PENDING` 的记录，业务条件不再命中 → 自动关闭并标注"已自行解决"；防止"事早办完了管家还在催"；
- 所有状态流转写审计；用户操作（resolve/dismiss）幂等：重复请求返回当前状态，不报错、不双写。

### 1.5 幂等与去重

- `dedupKey` 唯一约束：同一件事对同一人重复命中，只更新 `lastDetectedAt` 与证据，不新建记录、不重复送达；
- 送达通知复用通知中心 `dedupKey` 机制：`followup:{followUpId}`，天然防重；
- "时间窗降频"改变的是"送不送"，不是"记不记"——记录一直在（管家始终记着），送不送由抑制层决定。

---

## 2. 证据链数据结构

以"合同停滞"为例，一条跟进记录的 `evidence` 结构：

```json
{
  "conclusion": "合同 A 疑似停滞",
  "facts": [
    { "key": "status", "label": "合同状态", "value": "ACTIVE", "source": "contracts.status" },
    { "key": "last_activity", "label": "最近一次更新", "value": "14 天前", "source": "contracts.updated_at" },
    { "key": "owner", "label": "负责人", "value": "张三", "source": "contracts.owner_id → users.display_name" }
  ],
  "rule": { "code": "legal.contract_stalled", "threshold": "14 天", "severity": "WARNING" },
  "capturedAt": "2026-09-28T09:00:00+08:00"
}
```

三个要点：

1. **facts 是结构化字段**（key/label/value/source），不是自然语言——source 记录字段级来源，可复核；
2. **capturedAt 记录读取时间**——证据是"当时读到的事实"，用户事后质疑时能解释；
3. **facts 里不放自由文本大段原文**（如合同全文），防止把敏感长文本复制进推送表；需要细节时凭 objectId 去业务页看（权限控制仍在业务侧）。

## 3. 接口草案

> 公开接口遵循契约优先：`packages/contracts` 先改、重新生成客户端。以下路径为草案，实施时以契约为准。

### 3.1 用户接口（公开契约）

| 接口 | 说明 |
| --- | --- |
| `GET /assistant/follow-ups` | 我的跟进列表（仅收件人本人可见；支持 status/domain/severity 过滤与分页；默认按 severity + 最近时间排序） |
| `GET /assistant/follow-ups/{id}` | 详情（含完整证据链；非本人 404，不泄露存在性——沿用草稿接口的安全惯例） |
| `POST /assistant/follow-ups/{id}/resolve` | 手动标记处理完成（幂等） |
| `POST /assistant/follow-ups/{id}/dismiss` | 不用管（幂等；写反馈） |
| `GET /assistant/follow-up-preferences` | 我的提醒设置（无记录返回默认值） |
| `PUT /assistant/follow-up-preferences` | 更新设置（开关/上限/静默/订阅） |

### 3.2 内部机制接口（不进公开契约）

| 接口 | 说明 |
| --- | --- |
| ai-service：新增"跟进文案翻译"内部接口 | 输入素材（规则+证据+收件人背景），输出 title/summary/citations；仅 NestJS 经内部 Token 调用 |
| 后台任务：扫描器 | 进程内定时任务（沿用 jobs 框架与分布式锁），无需对外接口 |

### 3.3 权限码与数据范围

- **新权限码**：`assistant.followup.read`（查看与处理自己的跟进）；接入 `permission-catalog` 并随迁移授予默认角色——与 `dashboard.read` 的同款做法；
- 数据范围红线（见主文档第 6 章）：发现阶段按收件人数据范围过滤；查询接口实时二次校验；审计不落证据全文。

## 4. AI 翻译调用链与降级

**调用链：** 后台扫描任务 → NestJS 组装"翻译素材"（规则信息 + 证据 facts + 收件人岗位与记忆摘要）→ ai-service 内部接口（新增，不出公开契约）→ 返回 `{ title, summary, citations[] }` → **NestJS 校验 citations 全部命中素材事实** → 通过则采用，不通过或调用失败则降级为模板文案（`title/summary` 由规则模板生成）。

**成本控制：** 翻译走便宜模型档位；单租户每日翻译调用设上限（超出当日新事项降级模板文案）；调用记录走现有 `AiInvocationRecorderService` 计量，额度纳入 AI Credit 体系。

## 5. 规则框架设计要点（待块 1 细化）

- **detector 统一接口（草案）**：输入 = 租户上下文 + 扫描窗口 + 规则参数（thresholds）+ 数据范围；输出 = 命中事实包列表（对象类型/ID + 事实清单 + 严重级别）；
- **注册表**：detector 按职能域组织（finance/legal/hr/project/common），启动时注册并与配置表交叉校验（有配置无代码 / 有代码无配置均告警）；
- **一对多复用**：一个 detector 可对应多条配置实例（不同对象、不同阈值）；给某岗位加发现能力 = 复用 detector 加配置行，或新增 detector + 配置行；
- **扫描调度**：复用 jobs 框架（60 秒轮询 + 分布式锁），按每条规则的 `scanIntervalMinutes` 决定每轮实际执行哪些规则；先执行"自动复核"再执行"新规则扫描"。

## 6. 实现落点与复用清单

| 层 | 落点 | 说明 |
| --- | --- | --- |
| NestJS 模块 | `apps/api/src`（新建 followup 模块，命名以实施为准） | 数据、扫描、抑制、送达、接口 |
| 后台任务 | `apps/api/src/jobs`（新增一类扫描任务） | 复用 60 秒轮询 + Redis 分布式锁 |
| ai-service | 新增"跟进文案翻译"内部接口 | 仅 NestJS 经内部 Token 调用，不进公开契约 |
| 契约 | `packages/contracts/openapi/openapi.yaml` | 3.1 用户接口；生成 `packages/api-client` |
| 权限 | `permission-catalog` + 迁移 | 新权限码随迁移授予默认角色 |
| 审计 | 现有审计体系 | 跟进创建/送达/处理/反馈动作全程可审计 |
