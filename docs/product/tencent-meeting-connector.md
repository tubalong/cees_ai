# 腾讯会议连接器

## 1. 当前状态

腾讯会议连接器当前采用“Desktop 托管腾讯官方 `@tencentcloud/tmeet` CLI + 浏览器 OAuth + 本地命令执行”路线，不再使用个人 Token 或远程 MCP。

已落地：

- Desktop 固定安装 `@tencentcloud/tmeet 1.0.18`，不依赖用户预装 Node.js 或 npm；
- 从 npm 官方包下载单一 tgz，校验 SHA-256 `51d0cbb69d8400e29e73e88a5e1a0a3b6ef84323e8fa723e7da6725974025e61`，只提取当前平台二进制；
- 支持 Windows x64、macOS Intel/Apple Silicon、Linux x64/ARM64；
- 连接时执行 `tmeet auth login`，由官方 CLI 打开浏览器并完成设备码 OAuth；
- OAuth Token 和 RefreshToken 由官方 CLI 使用 AES-256-GCM 加密，不进入 Renderer、CEES API、数据库或模型上下文；
- CLI 配置与数据通过 `TMEET_CLI_CONFIG_DIR`、`TMEET_CLI_DATA_DIR` 隔离在 Electron `userData/connectors/tencent-meeting`；
- Desktop 从固定允许列表读取已安装 CLI 的 `--help`，生成与当前版本对齐的参数 Schema；
- API 只根据用户问题和 Desktop 提交的命令目录生成最多五条无副作用调用计划；
- Desktop 执行前重新校验工具、参数和风险，所有写入或破坏性操作必须确认；
- 执行结果脱敏、限长后以 `TENCENT_MEETING` 上下文注入本轮对话；
- 不建设腾讯会议列表或会议详情等平行业务页面。

## 2. 架构与边界

```text
Renderer
    -> ConnectorHost
        -> TencentMeetingConnectorAdapter
            -> LocalCliTransport
                -> Managed @tencentcloud/tmeet 1.0.18
                    -> Tencent Meeting OAuth / Open API

Renderer
    -> CEES API /assistant/connectors/tencent-meeting/plan
        -> 只生成命令调用计划
        -> 不接收 OAuth Token，不执行本地 CLI
```

`apps/api` 仍是 CEES 业务数据的唯一事实源。腾讯会议 CLI 的外部操作只影响腾讯会议，不能绕过 CEES API 创建或修改项目、任务、成员、财务、法务等正式资源。

## 3. 连接与解绑

1. 用户在连接器市场点击腾讯会议“连接”。
2. Desktop 下载固定 npm 包、校验 SHA-256 并只提取当前平台二进制；已安装时直接复用。
3. Desktop 使用独立配置和数据目录执行 `tmeet auth login`。
4. 官方 CLI 自动打开系统浏览器；用户登录腾讯会议并确认 OAuth 授权。
5. CLI 最多等待五分钟并将加密凭据写入本地隔离目录。
6. Desktop 执行 `tmeet auth status`，只向 Renderer 返回登录状态、用户名、OpenId、版本和工具数量。
7. 解绑先执行 `tmeet auth logout`，再删除 CEES 专属配置和数据目录；受管二进制保留，便于下次快速连接。

CEES 不要求用户填写 SDK ID、Secret、Corp ID 或个人 Token，也不在服务端代管腾讯会议凭据。账号可见数据和可执行动作仍由腾讯会议账号、产品版本、OAuth 授权及资源权限决定。

## 4. 对话执行

1. Desktop 检查 CLI 已安装且 `auth status` 为已登录。
2. Desktop 对固定允许列表中的命令执行 `--help`，从官方参数定义生成工具 Schema 并缓存。
3. Desktop 将用户问题和受限工具目录提交给 `POST /assistant/connectors/tencent-meeting/plan`。
4. API 只允许模型返回目录内工具和参数，最多五条调用；下发前把带点号的命令 ID（如 `meeting.list`）映射成 `tencent_meeting_tool_<序号>` 模型工具名，真实命令 ID 与风险标记写在描述里，返回时再映射回内部 ID。
5. Desktop 对 `WRITE`、`DESTRUCTIVE` 和未知风险操作展示精确参数并要求确认。
6. Desktop 将结构化参数转换为 CLI flag，禁止模型指定可执行文件、Shell、环境变量、网络地址或额外参数。
7. CLI 使用 JSON 输出执行官方能力；只读查询默认启用 `--compact`。
8. Desktop 移除 Token、Secret、Cookie、Authorization、Credential、Password 等字段并限制上下文字节数。

当前采用受控两轮接力（契约 `0.47.0`）：`规划 → 确认 → 执行` 最多两轮，第二轮只回喂最近 5 条脱敏摘要（工具 ID、参数摘要、结果摘要、状态），两轮合计调用仍 ≤ 5 次，且每一轮执行前各自确认。因此「先查会议 ID 再取消/更新」这类依赖链可以在一次对话里完成。需要五次以上调用、或目标无法由上一轮结果唯一确定的链路仍应拆成多轮。

规划请求由服务端注入**租户时区的当前时间参考**（`Current local time is YYYY-MM-DDTHH:mm:ss±hh:mm (timezone <IANA>)`），并要求模型把「今天 / 本周 / 这个月」这类相对表达换算成具体日期后再填参数；时区取 `Tenant.timezone`，缺失或非法时回退平台默认 `Asia/Shanghai`，不依赖服务器本地时区。此前规划指令里引用了并不存在的 `convert_timestamp` 工具，模型只能凭记忆猜年份和月份，历史会议查询窗口因此被算到错误月份（同一账号在不同轮次得到 0 条 / 1 条等互相矛盾的结果）。该指令已删除，相对日期一律以注入的当前时间为唯一参考点。

模型工具名必须匹配 ai-service 的 `^[A-Za-z][A-Za-z0-9_-]*$`（不允许点号），描述不超过 2048 字符。腾讯会议允许列表里的命令 ID 全部含点号，因此规划器统一走共享的模型工具定义构造器生成别名、截断描述并回映射。此前版本直接把 `meeting.list` 作为模型工具名下发，会被 ai-service 请求校验拦成 422，导致任意腾讯会议对话查询失败。

## 5. 当前暴露能力

当前允许列表覆盖：

- CLI 应用展示配置查询与设置；
- 会议创建、查询、搜索、更新、取消；
- 会议受邀成员查询、添加、移除和替换；
- 录制列表、地址、搜索、智能纪要、转写及录制权限申请；
- 参会成员、等候室记录、报告导出和异步结果；
- 元宝纪要搜索与详情；
- 呼叫入会、移出成员和等候室管理。

暂不暴露：

- `event consume` 等长连接命令：当前连接器调用模型不管理长期子进程；
- `contact` 独立查询：官方 Skill 明确限制通讯录只能作为会议邀请或呼叫入会的前置步骤；受控两轮接力虽已落地，但通讯录结果要跨轮传递并叠加写确认，确认成本高于收益，因此暂不开放；
- `tshoot` 日志和反馈：涉及本地日志导出或向厂商提交问题，不属于普通对话查询。

这三类能力需在建立专用进程生命周期、受控链式调用或明确交互后再开放，不能只因 CLI 存在命令就直接暴露给模型。

## 6. 风险与确认

- `READ`：会议、录制、报告和纪要查询，可直接执行；
- `WRITE`：创建或更新会议、修改受邀成员、呼叫入会、等候室操作、报告导出、应用信息设置，必须确认；
- `DESTRUCTIVE`：取消会议、移出成员、提交录制权限申请，必须确认；
- 未识别的新命令默认按 `DESTRUCTIVE` 处理。

确认卡片必须展示工具名称、风险等级和完整结构化参数。`record.permission-apply-commit` 只有在用户明确确认先前预览的权限申请后才允许规划和执行。

## 7. 安全设计

- 下载地址、版本、哈希和归档条目全部硬编码，禁止远程响应指定可执行路径；
- tgz 解压限制总大小、单条目大小和精确条目名，不写出任意归档路径；
- CLI 只由 Electron Main Process 启动，Renderer 不接触本地路径或凭据；
- 配置目录和数据目录均在腾讯会议连接器专属根目录内，递归删除前验证绝对路径；
- 工具参数必须存在于当前 CLI 帮助生成的 Schema，未知字段直接拒绝；
- 本地命令通过 `execFile` 执行，`shell=false`，模型不能注入 Shell；
- API 不接收或返回 OAuth Token、CLI 路径、环境变量、下载地址或 Header；
- 第三方结果不能作为 CEES 租户、角色或业务权限判断依据。

## 8. 契约与迁移

公开契约 `0.40.0` 保留 `POST /assistant/connectors/tencent-meeting/plan` 的请求和响应结构，仅将语义从“远程 MCP 动态工具”修正为“本地官方 CLI 版本化命令”。生成客户端必须重新生成。

从 `0.39.0` 升级时：

- 删除 Desktop 个人 Token 输入和 `cees:tencent-meeting-connect-token` IPC；
- 删除 `safeStorage` Token 文件和远程 MCP 执行路径；
- 旧 `credential.secure` 不迁移，用户需要重新点击连接并完成浏览器 OAuth；
- 服务端数据库无需新增迁移，CEES API 仍不保存腾讯会议凭据。

## 9. 验收

- 首次连接可自动安装固定 CLI 并打开浏览器 OAuth；
- 授权后可通过 AI 查询当前账号会议、录制、报告和纪要；
- 写操作未确认时拒绝执行，确认后使用精确参数执行；
- Renderer、API、数据库、日志和模型上下文不出现 OAuth Token；
- 解绑后 `auth status` 为未登录，CEES 专属凭据目录已删除；
- 安装包哈希错误、平台不支持、授权超时、CLI 输出异常均返回可恢复错误；
- Desktop 类型检查、生产构建、连接器测试、API Jest、契约 lint 和生成客户端全部通过。

## 10. 官方来源

- npm 包：`@tencentcloud/tmeet 1.0.18`
- 官方源码：`TencentCloud/tencentmeeting-cli`
- 官方授权命令：`tmeet auth login`、`tmeet auth status`、`tmeet auth logout`
