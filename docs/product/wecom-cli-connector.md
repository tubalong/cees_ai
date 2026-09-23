# 企业微信 CLI 连接器

## 1. 当前状态

企业微信连接器采用 Desktop 托管安装官方 `@wecom/cli`、企业微信扫码授权智能机器人、动态发现 CLI Schema、API 无副作用规划、Desktop 本地执行的路线。CEES 不要求普通用户填写 CorpId、AppKey 或 AppSecret，也不在 API、数据库或 Renderer 中保存企业微信授权凭据。

当前已落地：

- 连接器市场提供企业微信卡片、安装/连接入口、二维码授权状态和解绑；
- Desktop 固定安装 `@wecom/cli 1.3.2` 对应平台二进制，下载包固定 URL 并校验 SHA-256；
- 授权凭据由官方 CLI 保存在 CEES 独立配置目录 `userData/connectors/wecom/config`；
- 使用 `schema list` 和 `schema get` 动态发现机器人当前实际拥有的工具；
- API 只根据用户问题和受限工具目录规划最多三条调用，不接收凭据、不执行 CLI；
- Desktop 对 `WRITE`、`DESTRUCTIVE` 和未知风险工具执行前展示精确参数并要求确认；
- CLI 结果脱敏、限长后以 `WECOM` 上下文注入对话；
- “我的企业微信信息”“我是谁”等请求使用 Desktop 只读复合工具：先解析当前授权真人身份，再按内部 userid 精确匹配通讯录资料；
- “去试试”会新建会话，并优先使用企业微信连接器。

## 2. 架构与边界

```text
Renderer
    -> ConnectorHost
        -> WeComConnectorAdapter
            -> LocalCliTransport
                -> managed wecom-cli
                    -> WeCom intelligent bot authorization

Renderer
    -> POST /assistant/connectors/wecom/plan
        -> WeComConnectorPlannerService
            -> 只规划动态工具调用
```

`apps/api` 仍是 CEES 正式业务数据的唯一事实源。企业微信 CLI 的外部写操作只影响企业微信，不得绕过 CEES API 创建或修改租户、组织、角色、项目、任务、人事、财务或法务正式数据。

企业微信能力等于官方 CLI 当前版本、智能机器人授权和用户在企业微信中的实际权限交集。CEES 不承诺企业通讯录全量遍历、考勤、OA 审批或其他未出现在动态工具目录中的能力。

## 3. 安装与授权流程

1. 用户点击企业微信卡片右上角“+”或详情页“连接”。
2. Desktop 根据操作系统和 CPU 架构下载固定平台包，拒绝重定向、超限响应和 SHA-256 不匹配。
3. 安装器只从 tgz 的 `package/bin/wecom-cli(.exe)` 提取目标二进制，不执行 npm 安装脚本。
4. Desktop 启动 `wecom-cli auth init --noninteractive --no-browser --output-qrcode <path>`。
5. Renderer 展示二维码并每 1.5 秒轮询授权状态；用户使用企业微信扫码并完成机器人授权。
6. Desktop 通过 `wecom-cli auth show --status` 验证结果；授权成功后发现工具数量并更新卡片。
7. 解绑时 CEES 停止进行中的授权、清除工具缓存并删除本机专属配置目录；企业微信侧已经创建的机器人可能仍需用户在企业微信中自行管理。

支持平台：Windows x64、macOS x64/arm64、Linux x64/arm64。未列出的平台拒绝自动安装，不降级执行未知二进制。

## 4. 动态工具与对话

1. Desktop 调用 `schema list` 获取方法摘要，最多接受 256 个工具；
2. 并发调用 `schema get <method>`，解析 `$ref` 并压缩参数 Schema；
3. 包含 Token、Secret、Cookie、Password、BotId、本地路径或输出目录参数的工具不对模型开放；
4. 工具目录超过 32 项时，API 先从不可信目录选择候选，再生成正式调用；
5. CLI 方法名包含点号，API 使用本轮临时模型别名，返回前再映射回真实方法，避免违反模型工具名约束；
6. Desktop 重新校验工具仍存在、参数大小和确认标记，再以参数数组执行 CLI，始终禁用 shell；
7. 下载类工具只能写入 `userData/connectors/wecom/downloads`；
8. 单轮最多执行三个连接器调用，返回结果清除凭据字段并限制在上下文预算内。

当前用户资料属于 Desktop 内部复合能力。动态目录中的原始 `identity.whoami` 不直接暴露给模型，避免其返回的安全提示、内部 ID 和指令性身份上下文影响回答。复合工具只把姓名、英文名、部门、职务和邮箱等可读字段注入会话，机器人 ID、授权用户 ID 和原始身份上下文仅用于本地匹配，不返回 Renderer 或 API。

若当前机器人没有“通讯录”权限，官方 CLI 会返回错误码 `850002`。Desktop 将其转换为结构化的 `permissionRequired=true`、缺失权限和官方授权入口；AI 应明确说明需要机器人创建者授权，而不能回答“没有查询工具”。授权完成后无需重新安装连接器，用户可直接再次发起查询。

风险规则：

- `get/list/search/query/whoami/download/read/check/show`：`READ`；
- `create/update/send/reply/forward/append/import/upload/add/finish/rename/write/set`：`WRITE`；
- `delete/cancel/remove/clear/overwrite`：`DESTRUCTIVE`；
- 未知动作默认 `DESTRUCTIVE`。

所有非 `READ` 工具必须确认；Renderer 确认后只附加 `confirmed=true`，Main Process 仍会按最新工具定义复核。

## 5. 凭据与安全

- `WECOM_CLI_CONFIG_DIR` 固定为 CEES 专属目录，避免读取或污染用户其他 CLI 配置；
- Renderer 只能看到状态、二维码、版本和工具数量，不能读取配置文件或授权材料；
- API、Prisma、日志和连接器上下文不得保存企业微信凭据；
- 下载固定版本、固定平台包、固定哈希；安装器限制压缩包、二进制和 TAR 条目大小；
- 本地命令使用 `execFile`/`spawn` 参数数组且 `shell=false`；
- 动态 Schema 和描述按不可信输入处理，API 只允许返回请求目录内的工具；
- 结果递归清除敏感字段，限制嵌套深度、字符串长度和总字节数。

## 6. 当前限制与后续

- 当前一般工具仍采用单轮批量规划，后一工具不能直接引用前一工具的实时结果生成参数；当前用户资料已通过确定性的 Desktop 复合工具解决，其他复杂链路仍应拆成多轮；
- 官方 CLI 未暴露的考勤、OA 审批、完整组织同步等能力当前不可用；
- 连接状态仅代表 CLI 授权有效，不代表用户对每个企业微信资源都有权限；
- 当前不把企业微信结果同步为 CEES 正式数据，也不提供租户管理员批量导入流程；如后续实现，必须另建确认、权限、审计和幂等写入链路；
- CLI 升级需要更新固定版本、平台 URL、SHA-256、兼容性测试和本文档，不能自动跟随 latest。

## 7. 验证

- Desktop：`pnpm --filter @cees/desktop test:dws`、`pnpm --filter @cees/desktop build`；
- API：企业微信规划器 Jest、`pnpm --filter @cees/api build`；
- 契约：`pnpm --filter @cees/contracts lint`、重新生成 `packages/api-client` 并 typecheck；
- 手工：安装、二维码显示、扫码授权、动态工具发现、只读查询、写操作确认、解绑和再次授权。

API 契约见 [企业微信连接器 API](../api/wecom-connector-api.md)，通用边界见 [Desktop 连接器运行时](../architecture/connector-runtime.md)。
