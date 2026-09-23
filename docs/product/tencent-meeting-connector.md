# 腾讯会议连接器

## 1. 当前状态

腾讯会议连接器已从“CEES 服务端 OAuth + 固定 Open API 工具”切换为“Desktop 本地个人 Token + 腾讯会议官方远程 MCP”。旧服务端授权、Token 托管、固定五工具网关和相关数据表已删除，不再作为回退路径。

当前已落地：

- Desktop 连接器市场提供腾讯会议连接入口，用户前往腾讯会议 AI Skill 页面获取个人 Token 后粘贴连接；
- Token 只在 Electron Main Process 中处理，并通过 Electron `safeStorage` 加密保存到当前设备；
- Desktop 固定访问腾讯会议官方远程 MCP：`https://mcp.meeting.tencent.com/mcp/wemeet-open/v1`；
- 使用 JSON-RPC `tools/list` 动态发现当前账号可用能力，使用 `tools/call` 执行；
- API 只根据用户问题和 Desktop 提交的动态工具目录生成调用计划，不接收 Token、不访问腾讯会议、不执行工具；
- 读取操作可直接执行，写入和破坏性操作必须在 Desktop 展示工具、风险和精确参数并由用户确认；
- 执行结果脱敏、限长后，以 `TENCENT_MEETING` 连接器上下文注入本轮对话；
- Desktop 不建设腾讯会议列表、会议详情等独立业务客户端页面。

## 2. 目标与边界

本连接器用于让用户在 CEES 对话中使用其腾讯会议账号已经具备的官方 AI Skill 能力。能力范围由腾讯会议返回的动态工具目录和个人 Token 权限决定，CEES 不维护平行的固定工具清单。

```text
Renderer
    -> Electron Connector IPC
        -> TencentMeetingConnectorAdapter
            -> TencentMeetingCredentialStore (safeStorage)
            -> RemoteMcpTransport
                -> Tencent Meeting Official Remote MCP

Renderer
    -> CEES API /assistant/connectors/tencent-meeting/plan
        -> 只生成动态工具调用计划
        -> 不接收 Token，不执行腾讯会议工具
```

`apps/api` 仍是 CEES 正式业务数据的事实源。腾讯会议 MCP 的外部写操作只影响腾讯会议，不得绕过 CEES API 创建或修改 CEES 项目、任务、成员、财务、法务等正式资源。

## 3. 连接流程

1. 用户在连接器市场点击腾讯会议“连接”。
2. Desktop 打开腾讯会议 AI Skill 页面：`https://meeting.tencent.com/ai-skill.html`。
3. 用户在腾讯会议页面获取个人 Token，并粘贴到 CEES 连接弹窗。
4. Electron Main Process 校验 Token 格式，并使用该 Token 调用 `tools/list`。
5. 验证成功后，Token 通过 `safeStorage.encryptString` 加密并写入当前设备用户目录。
6. Renderer 只收到连接状态、工具数量和验证时间，不读取或回显已保存 Token。
7. 用户解绑时删除本地密文和工具缓存；重新连接必须再次提供个人 Token。

个人版、专业版账号可按腾讯会议实际开放状态使用；企业版或商业版账号若尚未获得 AI Skill 灰度能力，可能无法生成或使用个人 Token。CEES 不绕过腾讯会议账号、版本、灰度或资源权限限制。

## 4. 对话执行流程

1. Desktop 判断当前问题需要腾讯会议能力，并检查本地连接状态。
2. Desktop 从官方 MCP 调用 `tools/list`，获得动态工具名称、说明、参数 Schema 和注解。
3. Desktop 将用户问题和经过大小、数量限制的工具目录提交给 `POST /assistant/connectors/tencent-meeting/plan`。
4. API 调用模型生成最多三条工具调用计划，并拒绝目录外工具、重复 ID、非法 Schema 和风险标记不一致。
5. Desktop 对所有 `WRITE`、`DESTRUCTIVE` 以及未知风险工具展示二次确认。
6. 用户确认后，Desktop 直接调用官方 MCP `tools/call`；取消时不产生外部副作用。
7. Desktop 清除 Token、Secret、Cookie、Authorization、Credential、Password 等敏感字段，限制单次上下文字节数，再注入会话。
8. API 使用连接器上下文回答用户，但不把第三方结果作为 CEES 业务权限或正式业务写入依据。

当前规划是单轮批量规划：后一个工具暂不能引用前一个工具的实时结果生成新参数。存在依赖关系的复杂操作应拆成多轮对话。

## 5. 动态工具与风险

风险识别顺序：

1. MCP `destructiveHint=true`：`DESTRUCTIVE`；
2. MCP `readOnlyHint=true`：`READ`；
3. 已知取消、更新、权限提交和反馈工具：`DESTRUCTIVE`；
4. `schedule_meeting`：`WRITE`；
5. `get_*`、`search_*`、`list_*`、`convert_*`、`check_*` 及权限预览工具：`READ`；
6. 无法识别的新工具默认 `DESTRUCTIVE`。

所有非 `READ` 工具都必须确认。确认框必须显示工具名称、风险等级和完整结构化参数，不能只显示“是否继续”。腾讯会议返回的新工具无需发布 CEES 新版本即可被发现，但仍受工具数量、Schema、风险和上下文大小限制。

## 6. 安全设计

- Token 不进入 Renderer Local Storage、CEES API、Prisma、日志、审计事件或模型提示词；
- 操作系统安全存储不可用时拒绝保存 Token，不降级为明文；
- 远程地址固定为无凭据 HTTPS URL，禁止重定向、任意 URL、Host/Cookie 等危险请求头和请求头换行注入；
- 请求设置超时和响应字节上限，JSON-RPC、HTTP、超时和网络错误保持结构化语义；
- `tools/call` 只允许调用当前 `tools/list` 返回的工具；
- `_client_info` 仅在工具 Schema 明确声明该字段时注入；
- 写操作确认发生在持有 Token 的 Desktop，API 无法代替用户静默执行；
- Token 代表腾讯会议个人身份，用户在腾讯会议中不可见或无权操作的资源，CEES 同样不能访问。

## 7. 契约与数据迁移

公开契约 `0.38.0` 是破坏性变更：

- 删除旧 `/connectors/tencent-meeting/*` OAuth、状态、解绑、工具发现和执行接口；
- 新增 `POST /assistant/connectors/tencent-meeting/plan`；
- `ConnectorContext.provider` 增加 `TENCENT_MEETING`；
- Prisma migration `20260923040000_remove_tencent_meeting_oauth_backend` 删除旧连接和 OAuth State 表及枚举；
- 旧服务端 OAuth Token 不自动迁移，升级后每台设备都需要用户使用个人 Token 重新连接；
- 服务端不再需要 `TENCENT_MEETING_*` OAuth、Secret、回调或加密密钥环境变量。

## 8. 验收

- 未连接时不查询或伪造腾讯会议结果；
- 正确 Token 可完成 `tools/list` 验证并显示动态工具数量；
- 错误或失效 Token 给出重新获取提示，不保存无效 Token；
- 对话可以调用当前目录中的读取工具并基于结果回答；
- 创建、更新、取消及未知工具在执行前必须确认，取消确认后无外部调用；
- 解绑后本地密文删除，再次查询提示重新连接；
- Renderer、API 请求、数据库、日志和模型上下文中不出现个人 Token；
- Desktop TypeScript、生产构建、连接器测试、API 规划器 Jest、契约 lint 和生成客户端检查通过。

## 9. 官方参考

- 腾讯会议 AI Skill：<https://meeting.tencent.com/ai-skill.html>
- 腾讯会议 AI Skill 使用帮助：<https://meeting.tencent.com/support/topic/2233/index.html>
- 腾讯会议官方远程 MCP：`https://mcp.meeting.tencent.com/mcp/wemeet-open/v1`
