# 钉钉 DWS/MCP 连接器

## 1. 状态

- 已落地：连接器市场提供钉钉卡片和右上角 `+` 入口；Windows Desktop 首次安装以官方 DWS `v1.0.62` 为安全基线，校验安装脚本后写入当前用户的 CEES 数据目录，然后自动发起授权。
- 已落地：连接器市场可检查官方稳定版本、由用户确认升级、展示最近一次版本操作并手动回滚；升级后的版本或 Schema 健康检查失败时自动回滚。
- 已落地：DWS 安装时设置 `DWS_NO_SKILLS=1`，当前不安装 Skills，也不实现 Experts；连接器市场只展示实际可用的钉钉连接器。
- 已落地：已连接状态下，Desktop 会把当前 DWS Schema 明确标记为安全只读的查询工具交给 AI 规划；模型不需要钉钉数据时返回空计划，普通问题不会执行 DWS 业务查询。
- 已落地：不再硬编码“个人信息 / 可见组织 / 本人考勤”三类能力；当前 DWS 版本新增任何符合 `effect=read`、`confirmation=not_required`、`availability=available` 的查询工具后，CEES 无需增加能力枚举即可使用。
- 已落地：Desktop 通过 Electron 主进程调用本地 `dws`，完成授权状态读取、授权登录和可见组织快照读取。
- 已落地：API 接收 DWS/MCP 组织快照，并按 `VISIBLE_SCOPE` 幂等合并钉钉部门和人员镜像。
- 已落地：组织快照导入、映射预览和映射应用只允许当前 CEES 租户管理员执行；不检查操作者是否为钉钉管理员。
- 已落地：`VISIBLE_SCOPE` 不会因为本次快照缺少数据而标记既有部门删除或人员离职。
- 已落地：Desktop 使用统一连接状态 `NOT_INSTALLED/AUTH_REQUIRED/PROFILE_REQUIRED/READY/ERROR`，连接器市场、对话页和钉钉管理页通过 Electron 状态事件保持同步。
- 已落地：多组织或同组织多账号没有唯一当前 Profile 时，必须由用户显式选择稳定 `corpId:userId` Profile；不会默认选择第一项或最近账号。
- 已落地：DWS 明确返回 `retryable=true` 的只读 JSON 查询最多自动重试一次；等待超过 5 秒、未声明 `retryable` 或需要用户处理的错误不会自动重试。
- 已落地：DWS Schema 中以 `+` 开头的安全快捷查询命令可以被连接器发现；本人考勤、本人考勤审批和当前账号可见完整组织分别通过快捷工具或 CEES 复合只读工具查询。
- 已落地：对话中的“完整组织架构和人员”使用递归可见组织快照，不再只查询根部门的直属子部门和直接成员；人员详情兼容 DWS `orgUserId/orgUserName` 返回结构。
- 已保留：企业内部应用 `corpId/appKey/appSecret` 连接模式，作为私有部署、服务端定时任务和 DWS 不可用时的兼容路径。
- 暂缓：服务端无人值守 OAuth、后台定时同步，以及所有需要确认或会产生写入的 DWS 工具。

## 2. 目标与边界

普通用户不需要填写钉钉开放平台应用凭证。Desktop 使用本地 `dws` 完成钉钉 OAuth 登录和 MCP/产品命令调用，读取当前授权账号可见的组织、人员或个人数据。

CEES 只将钉钉数据作为外部输入：

```text
dws/MCP 负责从钉钉读取
CEES API 负责租户隔离、CEES 权限、映射、正式写入和审计
```

本连接器不检查钉钉管理员身份。它只检查当前 CEES 用户是否拥有当前租户的 `tenant_admin` 角色。钉钉实际返回的数据范围由当前账号、企业策略、OAuth 授权范围和 MCP 工具能力共同决定。

## 3. 连接模式

### 3.1 DWS_LOCAL

默认的交互式连接方式：

```text
CEES Desktop
  -> Electron IPC
  -> 本地 dws
  -> 钉钉 OAuth/Profile
  -> 钉钉 MCP 或 contact 命令
  -> 结构化组织快照
```

CEES 不接收或保存 dws 管理的 Access Token、Refresh Token 或 AppSecret。Desktop 只把必要的身份摘要和组织快照提交给 CEES API。

对话查询采用动态 Tool Loop：

```text
Desktop: dws schema --all --compact --format json
  -> 仅保留 effect=read + confirmation=not_required + availability=available
  -> 转成不含 CLI 路径和凭据的完整工具目录
API: POST /assistant/connectors/dingtalk/plan
  -> 目录超过 ai-service 单轮 32 工具限制时，先从完整目录动态选出最多 32 个候选
  -> 再由 AI 选择具体工具 ID 和结构化参数，不执行 dws
Desktop: 重新读取具体 leaf Schema
  -> 再次校验只读安全属性、工具身份和参数白名单
  -> execFile 执行固定 CLI 路径
  -> JSON 结果脱敏并作为 connectorContexts 发起正式对话轮次
```

因此，能力范围以用户电脑上当前受管 DWS 版本的 Schema 为准，而不是由 CEES 写死产品清单。模型永远不能返回 shell、原始 argv 或任意命令路径。

对话查询中的组织和考勤复合只读能力：

```text
用户询问本人考勤/请假
  -> 优先使用 DWS 快捷只读工具，当前用户 ID 由 DWS Profile 注入
  -> 日期缺省时本人审批默认使用本月第一天至今天

用户询问全部可见组织和人员
  -> 使用 CEES 复合只读工具
  -> 从根部门递归读取直属子部门
  -> 逐部门读取成员并批量读取人员详情
  -> 去重、脱敏并标记 complete/departmentCount/userCount
```

上述能力仍然只读取当前 DWS Profile 能看到的数据，不扩大钉钉账号本身的通讯录或考勤权限；组织复合工具也不会执行 CEES 导入、映射或其他正式业务写入。

连接器市场的一键连接流程为：

```text
点击钉钉卡片 +
  -> 展示安装、授权和数据边界
  -> 下载首次安装基线版本的官方 install.ps1
  -> SHA-256 校验安装脚本
  -> 安装到 <userData>/connectors/dingtalk/bin
  -> dws auth login 打开钉钉授权
  -> 卡片显示已连接
```

当前只支持 Windows 自动安装。Linux/macOS 可继续使用系统 PATH 中已有的 `dws`，但不会由 CEES 自动下载安装。

### 3.1.1 版本检查、升级与回滚

- 首次安装基线固定为 `v1.0.62`；安装完成后，用户可以在连接器市场显式检查并升级到 DWS 官方最新稳定版本。
- CEES 强制使用 `https://api.github.com` 和 `DingTalk-Real-AI/dingtalk-workspace-cli`，不接受进程环境变量把检查、升级或回滚重定向到其他源。
- 只接受 `track=release` 且非 prerelease 的标准三段版本；不开放 beta、预发布版本或任意版本输入。
- 只有 Windows 下安装在 CEES 用户目录中的受管 `dws.exe` 支持自动升级和回滚；系统 PATH 中的 DWS 只能检查版本，由用户自行维护。
- 升级必须由用户显式确认，并固定传入 `--skip-skills` 和 `DWS_NO_SKILLS=1`，不会因升级自动安装 Skills 或启用 Experts。
- 官方升级器负责下载、SHA-256 校验、升级前备份和二进制替换。CEES 不重复实现下载器或覆盖官方备份机制。
- 升级完成后，CEES 依次检查 `dws --version` 与 `dws schema --all --compact --format json`；实际版本必须与目标版本完全一致，Schema 必须可读取。
- 健康检查失败时立即调用官方 `dws upgrade --rollback -y` 自动回滚；连接器市场也仅在存在 CEES 升级流程产生的备份时开放手动回滚。
- 非敏感版本状态保存到 `<userData>/connectors/dingtalk/release-state.json`，只包含版本、检查时间、发布摘要、回滚可用性和最近操作结果，不保存 Token 或其他凭据。

### 3.1.2 本地连接状态与恢复

| 状态 | 含义 | 恢复动作 |
| --- | --- | --- |
| `NOT_INSTALLED` | 未找到可执行的 DWS | Windows 一键安装；其他系统提示手动安装 |
| `AUTH_REQUIRED` | 未登录、Token 失效或刷新失败 | 用户重新发起钉钉授权 |
| `PROFILE_REQUIRED` | 已有多个账号或组织，但没有唯一当前 Profile | 用户显式选择组织账号后执行 `profile switch` |
| `READY` | 安装、授权和当前 Profile 均有效 | 可以发现工具、执行只读查询和读取可见组织 |
| `ERROR` | 超时、临时不可用或无法归类的本地错误 | 用户重试状态检查；不自动改身份或切换组织 |

Electron 主进程是本地状态事实源。授权、Profile 切换以及本地查询失败后，主进程重新检查状态并广播给全部 Desktop 页面；Renderer 不根据错误文案自行推断连接状态。

自动恢复只适用于 DWS 结构化错误中明确声明 `retryable=true` 的只读 JSON 调用，最多重试一次并复用原参数。`retry_after_seconds` 大于 5 秒时立即返回错误，由用户稍后重试；授权、Profile 选择和任何写操作都不自动重试。

### 3.2 SELF_MANAGED_APP

兼容已有实现：租户配置企业内部应用 `corpId/appKey/appSecret`，API 服务端直接调用钉钉开放 API。该模式保留给后台定时同步、私有部署和本地 dws 不可用的环境。

如果租户已经使用 `SELF_MANAGED_APP`，导入 DWS 可见范围快照不会清空企业应用凭证、切换主连接模式或覆盖企业应用验证状态；两种来源可以并存，分别通过同步任务的 `source/scope` 区分。只有首次通过 DWS 建立连接的租户才创建 `DWS_LOCAL` 集成。

## 4. 权限规则

| 操作 | 普通成员 | CEES 租户管理员 |
| --- | --- | --- |
| 连接自己的钉钉账号 | 可以 | 可以 |
| 读取当前账号可见组织 | 可以 | 可以 |
| 查询个人数据 | 可以 | 可以 |
| 提交组织快照到当前租户 | 不可以 | 可以 |
| 预览组织映射 | 不可以 | 可以 |
| 应用组织映射 | 不可以 | 可以 |
| 创建 CEES 部门和成员 | 不可以 | 可以 |

`dingtalk.organization.sync`、`dingtalk.organization.mapping.preview` 和 `dingtalk.organization.mapping.manage` 仍然作为接口级权限；同时服务端硬性要求当前上下文角色包含 `tenant_admin`。不根据钉钉用户的 `admin` 或 `boss` 字段授权 CEES 操作。

对话连接器是“用户授权范围内的只读参考”，不替代 CEES 权限，也不能直接创建或修改 CEES 正式业务数据。组织导入仍必须走管理员确认的正式 API 流程。

## 5. 可见范围语义

DWS/MCP 组织快照使用：

```text
source = DWS_MCP
scope = VISIBLE_SCOPE
```

这表示本次导入的是当前钉钉授权账号能够通过 MCP 获取的数据，不承诺是企业完整组织。同步任务记录：

- `authorizedByMembershipId`：发起导入的 CEES 成员；
- `authorizedExternalUserId`：使用的钉钉用户；
- `externalCorpId`：来源钉钉企业；
- `fetchedAt`：快照读取时间；
- `profile`：本地 dws 当前组织 profile；
- 部门和人员数量。

`VISIBLE_SCOPE` 只对本次返回的部门和人员执行 upsert：

- 返回的部门/人员恢复为可见和有效；
- 未返回的既有镜像保持原状态；
- 不把未返回部门标记 `isDeleted=true`；
- 不把未返回人员标记为离职；
- 管理员可以在映射预览中决定是否导入本次结果。

只有已有企业应用模式的 `FULL_SCOPE` 同步，或者未来数据源明确声明完整快照时，才允许处理未返回数据的删除/离职语义。

## 6. 组织导入流程

```text
1. CEES Desktop 检查本地 dws 登录态
2. 租户管理员通过 dws 登录钉钉
3. dws 读取当前账号可见的部门和人员
4. Desktop 将快照 POST 到 /dingtalk/organization/snapshot
5. API 校验租户管理员、快照结构和外部企业标识
6. API 创建 DWS_MCP/VISIBLE_SCOPE 同步任务
7. API 幂等合并外部镜像
8. 管理员执行 mapping/preview
9. 管理员处理冲突、角色和创建选项
10. 管理员执行 mapping/apply
11. API 在事务中写入 CEES 部门、成员和角色，并记录审计
```

组织快照导入不会直接创建 CEES 登录账号。账号创建、角色分配和一次性激活凭证仍然只发生在管理员确认的映射应用阶段。

## 7. 安全要求

- Renderer 不直接执行 Shell；只能通过 Electron preload 暴露的 IPC 调用 dws。
- DWS 查询路径由当前 Schema 动态发现，但只接受明确声明 `effect=read`、`confirmation=not_required`、`availability=available` 的工具。
- AI 只返回本地稳定工具 ID 与结构化参数；Desktop 不接受模型提供的 shell、CLI 路径或原始 argv。
- 每次执行前重新读取具体 leaf Schema，拒绝 Schema 漂移、写工具、需要确认的工具、不可用工具和未声明参数。
- Windows 对话查询只使用安装在 CEES 用户目录中的受管 `dws.exe`，不通过 `cmd.exe` 执行模型参数。
- DWS 版本检查、升级和回滚固定使用官方 GitHub API 与官方仓库；允许继承 GitHub 认证 Token 以提高限额，但 Token 不写入状态、日志或 Renderer 响应。
- 自动升级仅允许最新正式稳定版本，必须由用户确认，并始终跳过 Skills 安装。
- API 不接受外部提交的 `tenantId`、`membershipId` 作为权限依据，始终使用 JWT 和租户上下文。
- 快照导入必须再次检查 `tenant_admin`，不能依赖前端按钮隐藏。
- Token、AppSecret、MCP 凭证不得进入 AI Prompt、审计 metadata 或普通 API 响应。
- 对话上下文进入 API 前拒绝 `token`、`secret`、`cookie`、`authorization`、`credential` 和 `password` 等字段，单轮连接器上下文上限为 64KB。
- API 将连接器上下文作为用户消息的只读参考块注入模型，并明确防止把外部文本当作指令；连接器上下文不作为租户或业务权限依据。
- 快照导入、映射应用和失败结果必须记录操作者、租户、授权用户、来源和数量。
- dws 未安装、未登录、多个组织未选择、命令超时和返回非法 JSON 都要明确失败，不得把空结果当作组织为空。
- 快照至少包含一名可见人员；空快照在 API 层拒绝，不创建成功同步记录，也不覆盖既有镜像。

## 8. 失败语义

| 情况 | 处理 |
| --- | --- |
| dws 未安装 | Desktop 提示安装连接器，不调用 API |
| dws 未登录 | Desktop 提示授权登录 |
| Token 失效或刷新失败 | 状态切换为 `AUTH_REQUIRED`，清理已发现工具缓存并提示重新授权 |
| 多组织或多账号没有唯一当前 Profile | 状态切换为 `PROFILE_REQUIRED`，列出稳定 Profile 供用户明确选择 |
| DWS 明确返回可重试错误 | 只读 JSON 查询按返回等待时间最多重试一次；等待超过 5 秒则直接失败 |
| DWS 未声明错误可重试 | 不猜测、不盲目重试，状态切换为 `ERROR` 并允许用户重新检查 |
| 官方稳定版本检查失败 | 保留已安装版本和上次检查信息，展示脱敏错误，不自动升级 |
| 系统 PATH 中的 DWS 请求升级 | 只允许检查版本，提示用户通过自己的安装渠道维护 |
| 升级后版本或 Schema 健康检查失败 | 自动调用官方回滚；成功后记录 `ROLLED_BACK` 并提示原始升级错误 |
| 升级失败且自动回滚失败 | 保留手动回滚入口并记录 `FAILED`，不得把连接器标记为升级成功 |
| 用户执行手动回滚 | 仅回滚到 CEES 最近一次升级前版本，回滚后再次执行版本和 Schema 健康检查 |
| DWS Schema 没有安全只读工具 | 本轮不执行连接器查询，正式对话继续使用其他上下文 |
| AI 返回目录外工具或未声明参数 | Desktop/API 拒绝计划，不执行本地命令 |
| 执行前 leaf Schema 安全属性变化 | 拒绝执行并提示重试，不沿用旧目录 |
| DWS Schema 使用 `+` 快捷命令 | 仅允许符合安全命名规则的快捷命令词，例如 `+my-attendance`；不放宽到任意 Shell 字符 |
| DWS 返回 `orgUserId/orgUserName` | 按 DWS 组织员工模型解析为 CEES 外部人员 ID 和姓名，不因字段名不同丢弃人员 |
| 对话请求完整组织架构 | 使用递归可见组织复合只读工具；结果带完整性标记，不能把直属部门结果宣称为全量 |
| 组织/人员结果超过单轮上下文上限 | 返回截断警告和 `complete=false`，提示缩小范围，不宣称已返回全部人员 |
| 多个组织且没有当前 profile | 要求用户先选择组织 |
| dws 返回空数据 | 失败，不覆盖已有镜像 |
| 快照结构重复或引用不存在部门 | API 返回 400，不写入镜像 |
| 普通成员提交快照 | API 返回 `DINGTALK_TENANT_ADMIN_REQUIRED` |
| 同一租户已有运行中的同步 | API 返回 `DINGTALK_SYNC_ALREADY_RUNNING` |
| MCP 只返回部分组织 | 按 `VISIBLE_SCOPE` 合并，不标记未返回数据删除 |

## 9. 受影响契约与迁移

- OpenAPI：`packages/contracts/openapi/openapi.yaml`。
- 生成客户端：`packages/api-client/src`，通过 `pnpm contracts:gen` 生成。
- Prisma schema：`apps/api/prisma/schema.prisma`。
- Prisma migration：`apps/api/prisma/migrations/0037_dingtalk_dws_mcp_connector/migration.sql`。
- Prisma migration：`apps/api/prisma/migrations/0038_assistant_connector_contexts/migration.sql`，为用户消息保存脱敏连接器上下文。
- API 新接口：`POST /api/v1/dingtalk/organization/snapshot`。
- Assistant 轮次请求新增可选 `connectorContexts`，详见 `docs/api/assistant-api.md`；它只承载本轮只读上下文，不承载 DWS 凭据。
- API 新接口：`POST /api/v1/assistant/connectors/dingtalk/plan`，只返回本地查询计划，不执行 DWS。
- 旧接口：`POST /api/v1/dingtalk/organization/sync` 仍保留，仅服务于 `SELF_MANAGED_APP` 和 `FULL_SCOPE`。
