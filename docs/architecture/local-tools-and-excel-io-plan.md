# 本机工具与 Excel 读写：实现说明与风险登记

> 状态：**Excel 生成、本机只读扫描、隔离/恢复/永久清理、生成产物另存为、本机操作审计已实现（2026-09-23）**。关联：
> - [AI 助手业务写操作](../product/assistant-business-tools.md)（云端写工具与确认机制）
> - [桌面端安全加固](../engineering/desktop-security-hardening.md)（CSP / IPC / webview / 令牌）
> - [AI 服务基础](ai-service-foundation.md)、[文件上传](file-upload.md)
>
> 本文覆盖四件事：① 聊天框上传 Excel/CSV 并由 AI 生成新的 XLSX；② 本机只读工具（磁盘容量与目录大小扫描）；
> ③ 可恢复的本机写操作（隔离 / 恢复 / 永久清理）；④ 生成产物另存为（§8）。
> **进程控制、启动项、GUI 自动化仍未实现；AI 自主在任意路径新建/改写本地文件仍未实现（§8.4 说明它为何不是本计划的下一步）。**

## 1. 现状核查（实现前必须先知道已经有什么）

| 能力 | 现状 | 证据 |
| --- | --- | --- |
| 聊天上传 Excel | **已可用**：NestJS 允许 `spreadsheetml.sheet` MIME | `apps/api/src/file/file.service.ts` 的允许列表 |
| AI 读取 Excel 内容 | **已可用**：`resolveDocumentParts` → gateway `extractFile` → ai-service `extract_text` → `extract_xlsx_text`（stdlib ZIP/XML，无新依赖） | `apps/api/src/assistant/runtime/message-content.service.ts`、`apps/ai-service/app/extraction/{extractor,formats}.py` |
| AI 生成 DOCX/PDF/PPTX | 已可用，且架构是**两步**：LLM `compose` 出结构化 spec → 确定性 `render` 出字节 | `apps/ai-service/app/api/routes/documents.py`、`apps/api/src/assistant/tools/executors/generate-document.tool.ts`（`FORMATS` 表驱动） |
| AI 生成 XLSX | **已实现**：`compose-spreadsheet` → `render-xlsx` → `generate_xlsx` → COS/ManagedDocument | `spreadsheet_composer.py`、`xlsx_renderer.py`、`generate-document.tool.ts` |
| 本机只读上下文通道 | 已存在且是**现成的最佳载体**：Desktop 读取本地只读数据后作为 `connectorContexts` 随轮次上报，服务端明确其「不作为业务事实或权限依据」 | `ConversationMessage.connectorContexts`、`POST /assistant/connectors/dingtalk/plan` |

桌面端与移动端均已支持聊天上传 Excel/CSV；生成结果以新的 XLSX 正式文件交付，绝不覆盖用户原文件。

## 2. Excel 读写方案

遵循现有「compose → render」两步架构，避免让模型直接吐大块表格 JSON（Token 不可控、易截断）：

1. **契约（ai-service）**：新增 `SpreadsheetSpec`、`ComposeSpreadsheetRequest/Response`、`RenderXlsxRequest`；
   路径 `/internal/v1/documents/compose-spreadsheet`、`/render-xlsx`。
2. **ai-service**：`app/documents/spreadsheet_composer.py`（一次 LLM 调用 + JSON schema 约束）+ `xlsx_renderer.py`
   （`xlsxwriter`，确定性渲染，不调 LLM、不产生 Token 成本）；沿用现有 `normalize` / `validation` 风格做清洗与上限校验。
3. **NestJS**：`generate_xlsx` 从当前 `turnId` 重建附件内容，调用 composer/renderer，写入
   `ManagedDocument.spreadsheetSpec`、`FileObject`、`AIActionDraft` 与审计；同一 `toolCallId` 幂等。
4. **客户端**：桌面与 Flutter 均识别 `generate_xlsx`，通过 `/documents/{id}/file` 下载已落盘文件；
   Flutter 使用上传会话直传，不把大文件放进 SSE 请求体。
6. **上限（必须做）**：≤ 5 个工作表、≤ 2000 行、≤ 60 列、单元格文本 ≤ 500 字符；
   超限直接拒绝并回报模型，**不允许静默截断**（静默截断会让用户以为数据完整）。

**改写既有文件 vs 新建文件**：首版只做「生成一个新的 xlsx」；「原地改写用户上传的 xlsx」需要文件级 diff 语义
（保留未改动的样式/公式），建议作为第二步，且必须明确告知用户「生成的是新文件」。

## 3. 本机只读工具（磁盘容量与目录大小扫描）

**不引入**「服务端工具等待客户端执行」的双向通道（那是全新基础设施，且带来超时/断连/重放语义）。
改为复用**只读上下文**通道：

1. Electron main 的 `local-tools/disk-scanner.ts` 提供卷容量和用户选择目录的聚合扫描。
2. 目录只能由 Electron 系统选择器产生；模型/renderer 不能传路径。结果作为
   `connectorContexts` 随轮次上报；服务端仅作为只读上下文使用，**不作为业务事实**。
3. 隐私最小化：只上报卷容量、目录总大小、条目数、Top-N 一级子目录及大小，
   **不上报完整文件路径与文件名**；单次扫描有深度/条目/耗时上限。
4. 默认上限为 4 层、100,000 项、15 秒；不跟随符号链接/Junction，超限返回 `truncated=true`。

## 4. 可恢复的本机写操作（隔离 / 恢复 / 清理）

这一步是**唯一会改动用户数据**的部分，必须先有清单与恢复语义，再做删除：

1. **隔离优先**：只使用同卷原子 `rename`；跨卷返回逐项失败，刻意不做“复制后删除”降级。
2. **不可变清单 + hash**：扫描产出 `CleanupPlan`（每项路径、大小、类别、理由），渲染为用户可核对的清单并计算内容 hash；
   用户确认的是**这份清单的 hash**，执行前再次校验 hash 一致，防止确认与执行之间清单被替换。
3. **逐项结果，不做整体成败**：每项记录 `moved / skipped / failed + reason`；部分成功必须如实回传，
   不允许只报「失败」或只报「成功」。
4. **恢复**：隔离区保留元数据（原路径、隔离时间、清单 id），支持按清单回滚；
   恢复前校验目标路径是否已被占用（占用则要求用户选择新路径，不覆盖）。
5. **崩溃恢复**：任务清单以 `0600` 权限原子写入 userData；启动时核对原路径/隔离路径，
   把 `EXECUTING/RESTORING/CLEANING` 标记为 `RECOVERY_REQUIRED`，绝不自动重放。
6. **审计：已落地**。云端只记录动作摘要与清单 hash，**不记录完整本地路径**。
   实现：`TurnStateService.writeLocalOperationAudits` 在轮次创建事务内，对每个 `provider=LOCAL_SYSTEM`
   的只读上下文写一条 `action=LOCAL_SYSTEM_OPERATION`、`resourceType=LOCAL_SYSTEM` 的审计事件。
   metadata 按**字段白名单**（`pickLocalAuditSummary`）提取，绝不原样序列化 `context.data`：
   即使客户端将来多传路径或文件名，也不会进审计表。`resourceId` 恒为 null（本地对象没有云端 ID）。

## 5. 风险登记（对照既有生产环境风险清单，逐条给出控制措施）

| # | 风险 | 控制措施（落到哪一处） |
| --- | --- | --- |
| 1 | 重复执行 | 云端写工具已有草稿抢占 + `toolCallId` 唯一；本机清单以 hash 确认 + 逐项幂等键（路径+大小+mtime） |
| 2 | 确认后权限变化 | 云端已有 403+置 REJECTED；本机侧执行前复核目录仍在授权范围内 |
| 3 | 参数被替换 | 云端只提交 `draftId`、参数取快照；本机只提交清单 hash，不接受重新下发的路径列表 |
| 4 | 提示词注入 | 外部内容（文件名、单元格文本、网页）不得提升权限或跳过确认；本机工具**不接受模型传来的任意路径/命令** |
| 5 | 符号链接 / Junction | 扫描与清理默认不跟随 reparse point，显式跳过并记录 |
| 6 | 部分成功 | 逐项结果回传（见 §4.3），聚合摘要不得掩盖失败项 |
| 7 | 隐私外泄 | 只读扫描只上报聚合值；审计不落本地完整路径（见 §3.3、§4.6） |
| 8 | 进程崩溃 | 隔离区 + 清单持久化，启动进入 `RECOVERY_REQUIRED`（见 §4.5） |
| 9 | XSS 放大权限 | 已加固：CSP、IPC 来源校验、webview 策略、令牌移出 Web Storage（见安全加固文档） |
| 10 | 杀毒误报 | 隔离器与 Agent Host 需代码签名；不打包可疑二进制 |
| 11 | 工具数量膨胀 | 本机工具走只读上下文通道而非工具清单；云端工具保持最小集 |
| 12 | 审计数据过敏 | 只记动作摘要、聚合大小、清单 hash（见 §4.6）；实现按字段白名单提取，不原样落 `data` |
| 13 | 另存为写成可执行文件 | 扩展名白名单（`ALLOWED_EXTENSIONS`），`.exe/.bat/.ps1/.lnk/.js` 一律拒绝；建议文件名过 `sanitizeBaseName` 去除目录分隔与控制字符、规避 Windows 保留名（见 §8.2） |
| 14 | 另存为写穿符号链接 | 目标已存在且 `lstat().isSymbolicLink()` 时拒绝；目标是目录也拒绝；同目录临时文件 + `rename` 原子替换（见 §8.2） |
| 15 | 超限内容被静默截断 | 超过 64 MB 直接拒绝并提示；写失败会清理临时文件，不留下半截文件 |

## 6. 实施顺序与验收口径

1. **Excel 生成：已完成**。`compose-spreadsheet` + `render-xlsx` + `generate_xlsx` + 两端上传下载。
   验收：ai-service 渲染单测（含 CJK、数字、多表）；api 工具单测（注册/参数上限/预览）；桌面端可下载并用 Excel 打开无告警。
2. **本机只读扫描：已完成**。固定 IPC + 系统目录选择器 + `LOCAL_SYSTEM` 上下文。
   验收：聚合值正确（与系统工具交叉核对）、不跟随 reparse point、无完整路径上云。
3. **隔离 / 恢复 / 清理：已完成**。永久清理仅删除隔离区副本，并要求第二次原生确认。
   验收覆盖：hash 篡改拒绝、逐项状态、恢复不覆盖、隐私输出、崩溃后 `RECOVERY_REQUIRED`。4. **本机操作审计：已完成**（§4.6）。验收：每个 `LOCAL_SYSTEM` 上下文各产生一条审计；
   DingTalk 上下文不产生；即使客户端多传 `paths`/`originalPath`/`displayName`，metadata 仍不含本地明细。
5. **生成产物另存为：已完成**（§8）。验收：字节与源文件一致、原子替换、扩展名白名单、
   目标为符号链接/目录时拒绝、超限与空内容拒绝、用户取消不报错。
## 7. 聊天调用方式与边界

本机操作**不由模型决定**（服务端不下发本机指令，§3），而是桌面端按消息内容识别意图后执行。
识别口径如下，任一「对象词 + 意图词」同时出现即触发：

| 操作 | 对象词 | 意图词 | 是否打断 |
| --- | --- | --- | --- |
| 卷容量扫描 | 磁盘 / 硬盘 / 盘符 / 分区 / 字母盘 | 容量 / 空间 / 占用 / 剩余 / 可用 / 情况 / 列表 / 有哪些 / 多少个 / 扫描 / 查看 / 看下 / 满 / 够 | 否（无弹窗） |
| 目录大小扫描 | 目录 / 文件夹 | 大小 / 多大 / 占用 / 空间 / 容量 / 统计 / 分析 / 扫描 / 多少 | 是（弹系统目录选择器） |
| 隔离 | 清理 / 隔离（含「帮我/请/执行…清理」） | — | 是（弹选择器 + 确认框） |
| 恢复 | 恢复 / 还原 + 隔离/清理/文件/目录 | — | 是（确认框） |
| 永久清理 | 永久清理 / 彻底删除 / 清空隔离区 | — | 是（二次原生确认） |
| 另存为 | 资源卡片上的「保存到…」按钮 | — | 是（系统保存对话框） |

设计取舍：**卷容量扫描可以宽松**（只读聚合值、无弹窗），**目录与写操作必须保守**（会弹窗打断用户，
因此要求明确的度量词，避免「知识库目录里查一下」这类无关说法莫名弹窗）。

- “查看 C 盘剩余空间”“扫描盘符”“看看我的盘符情况”触发卷容量扫描；
- “扫描这个目录的占用”“这个文件夹多大”弹系统目录选择器后扫描；
- “清理这些文件”弹文件选择器，确认后移动到隔离区；“清理这个目录”弹目录选择器；
- “恢复刚才隔离的文件”恢复最近可恢复任务；
- “永久清理隔离区”仅删除最近任务的隔离副本，并显示不可恢复确认；
- “生成一张图”/“生成一份季度总结”由模型生成产物，用户在资源卡片点「保存到…」，
  再由系统保存对话框决定落盘位置（§8）。**模型不能自己把文件放到桌面**——
  位置只能由用户在本机对话框里选择，这是 §8.1 刻意的边界。

本地工具不注册 PowerShell/Shell，不接受模型生成的路径、glob、环境变量或 argv。iPhone 不具备扫描电脑磁盘的能力；
移动端只同步 Excel 上传/生成/下载。本机工具仅在 Electron preload 存在时可用。

每步独立提交、独立验证；不要合并为一次大改动。

## 8. 生成产物另存为（本机保存）

目标：AI 已生成的文档/表格/图片可以**另存到用户选择的本机位置**，而不是只能落到默认下载目录。
实现日期 2026-09-23，属「按改动用户数据程度递增」顺序里的第 4 步（前 3 步见 §6）。

### 8.1 为什么不引「双向工具通道」

WorkBuddy 那类能力的本质是「服务端下发工具调用 → 客户端执行 → 结果回传」。本计划 §3 已明确不引入该通道
（超时/断连/重放是全新基础设施）。另存为**不需要**它，因为：

1. 产物由现有云端工具产出（`generate_docx/pdf/pptx/xlsx/image`），走已有确认与幂等机制；
2. 保存动作由**用户点击资源卡片上的「保存到…」**触发，是一次纯客户端动作；
3. 目标路径由 Electron 的 `dialog.showSaveDialog` 产生，**模型与渲染层都无法指定路径**。

因此新增能力不触碰 §3「不引入双向通道」与 §7「不接受模型生成的路径」两条红线。

### 8.2 实现与护栏

| 位置 | 作用 |
| --- | --- |
| `apps/desktop/electron/local-tools/file-saver.ts` | 扩展名/大小/符号链接/目录校验 + 原子写入 |
| `apps/desktop/electron/main.ts`（`cees:local-save-generated-file`） | 弹系统保存对话框，再把字节交给 writer |
| `apps/desktop/electron/preload.ts` | 暴露 `localSystem.saveGeneratedFile` |
| `apps/desktop/src/core/api.ts`（`fetchGeneratedDocumentBytes`） | 取回已落盘文件字节，**不触发浏览器默认下载** |
| `apps/desktop/src/app/Workspace.tsx` | 资源卡片「保存到…」按钮；图片与文档均支持 |

护栏（逐条对应 §5 风险登记 13–15）：

- **路径只能来自系统对话框**：writer 不接受路径入参；`suggestedName` 仅作对话框默认名并过 `sanitizeBaseName`。
- **扩展名白名单**：`docx/pdf/pptx/xlsx/csv/md/txt/json/png/jpg/jpeg/webp/gif`；其余（含 `.exe/.bat/.ps1/.lnk/.js/.zip`）拒绝。
- **大小上限 64 MB**，超限拒绝且不静默截断；空内容拒绝。
- **不写穿符号链接**：目标已存在且为符号链接时拒绝；目标是目录时拒绝。
- **原子写**：同目录临时文件（`0o600` 语义的 `wx`）+ `rename` 替换；失败清理临时文件。
- **覆盖语义**：由系统保存对话框承担覆盖确认（原生、显式、用户可见），不重复弹窗；但仍拒绝链接与目录。

### 8.3 能力告知（模型侧）

桌面端在每轮把一条 `toolId=local_capabilities` 的 `LOCAL_SYSTEM` 只读上下文随轮次上报（在钉钉分支**之后**入队，
因为钉钉会整体替换 `connectorContexts`），内容仅为「可用于另存到本地」这一事实。作用是让模型正确引导用户
（「点资源卡片上的保存到…选择位置」），而不是回答「我无法保存到你的电脑」。它**不构成任何执行授权**：
契约中 `connectorContexts` 的语义仍是「仅作只读参考，不作为业务事实或写权限依据」。

契约随之扩展（`packages/contracts/openapi/openapi.yaml`）：`ConnectorContext.toolId` 白名单新增 `local_capabilities`；
`connectorContexts` 的 `maxItems` 由 3 放宽到 5（= 钉钉计划调用 3 + 本机操作 1 + 能力声明 1），属兼容扩展。

### 8.4 明确不做（以及为何不是下一步）

- **AI 自主在任意路径新建/改写本地文件**：需要一个「服务端下发 → 客户端执行 → 结果回传」的双向通道，
  以及模型可传路径的参数契约。这正是 §3 拒绝、§7 禁止的部分，**不是本程序的自然下一步**，
  属于另一个量级的架构决定。
- **另存为的云端审计**：当前不写。产物字节经 `GET /documents/{id}/file` 取得，该接口本身不写审计；
  另存为是**用户点击触发的本机动作**，授权与记录由系统保存对话框承担，不归属「AI 对用户机器的操作」。
  若要把它纳入审计（例如出于数据外发合规），应先给下载接口补审计，再让客户端上报保存结果，
  而不是单独给保存动作开一个旁路。
