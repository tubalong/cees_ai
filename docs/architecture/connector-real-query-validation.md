# 连接器真实查询联调验收

> 状态：阶段二完成，阶段三联调清单已建立。本文只记录真实账号验证方法，不记录 Token、Cookie、仓库密钥或第三方返回中的敏感字段。
> 验证基线：2026-09-30，分支 `test/connector-real-query-validation`。

## 1. 验收前提

- Desktop 使用包含最新连接器执行层的构建，API 使用与当前 `packages/contracts` 兼容的版本。
- 分别在连接器页面完成钉钉、腾讯会议和 GitHub 授权；GitHub 必须重新授权并确认 OAuth scope 包含 `repo`。
- 测试账号必须确实拥有目标数据权限；“账号没有数据”和“账号没有权限”必须分别验证。
- 测试过程只记录连接器名称、工具名称、时间范围、`complete`、`hasMore`、`permissionRequired`、错误类别和记录数量，不复制原始 Token 或完整敏感内容。

## 2. 腾讯会议

### 用例 T1：历史会议

在助手中发送：`帮我查询 2026 年 1 月 1 日到 2026 年 9 月 30 日的历史会议，并按时间倒序总结。`

验收：

- 规划到 `meeting.list-ended` 或等价的历史会议查询工具，并带明确开始、结束日期。
- Desktop 自动跟随 `next_page_token`，不要求用户手工分页。
- 多页结果合并后 `data.completeness.complete=true`、`pagesFetched` 等于实际请求页数、`hasMore=false`。
- 若达到分页上限、游标重复或服务端返回矛盾字段，必须返回 `complete=false` 和 `warnings`，回答不能声称覆盖全部历史。

### 用例 T2：空结果与失败结果

- 使用权限明确但确实没有会议的时间范围，确认只有 `complete=true` 的空列表才被回答为“当前范围没有会议”。
- 使用无权访问的会议或录制，确认权限错误不会被回答为“没有会议/没有录制”。

## 3. 钉钉

### 用例 D1：历史日历或会议

发送：`帮我查询 2026 年 1 月 1 日到 2026 年 9 月 30 日的钉钉历史日程和会议。`

验收：

- 不因用户没有点名具体子产品而静默猜错；需要选择时展示钉钉日历、群聊、听记等明确选项。
- 动态 DWS 工具返回 `next_cursor`、`next_page_token` 或嵌套分页字段时，Desktop 自动续页并合并数组。
- `data.completeness.complete=true` 才能表示本次范围已取完；`hasMore=true`、游标重复或分页上限触发时必须显式提示不完整。

### 用例 D2：历史考勤

发送：`查询我 2026 年 9 月 1 日到 2026 年 9 月 30 日的全部考勤打卡。`

验收：

- 工具参数包含完整日期区间，不能退化成默认“今天”。
- 结果按 `workDate`、`actualCheckTimeLocal` 和 `baseCheckTimeLocal` 展示，不重新解释原始时间戳。
- `data/result/meta.pagination` 任一层出现未耗尽分页时，考勤上下文 `complete=false`。

## 4. GitHub

### 用例 G1：私有仓库

发送：`列出我有权限访问的私有仓库，并查看指定私有仓库最近的提交和 Pull Request。`

验收：

- 授权状态为 `READY`，且保存的 OAuth scope 包含 `repo`。
- 规划优先选择仓库、提交和 Pull Request 工具，不以用户资料或公开仓库结果替代私有仓库数据。
- 私有仓库查询成功时返回真实仓库数据；权限拒绝时返回 `complete=false`、`permissionRequired=true`，不能返回空列表冒充成功。

### 用例 G2：授权诊断

- 使用缺少 `repo` 的旧授权，连接器状态必须显示 `GITHUB_SCOPE_REQUIRED` 并要求重新连接。
- 使用账号有权但 MCP 暂时失败的场景，结果必须标记查询失败，而不是声称目标仓库不存在。

## 5. 结果记录模板

每条用例只记录以下字段：

```text
case: T1 | D1 | G1
connector: TENCENT_MEETING | DINGTALK | GITHUB
queryRange: 2026-01-01..2026-09-30
toolIds: <tool names only>
complete: true/false
hasMore: true/false
permissionRequired: true/false
recordCount: <number>
failureCategory: none | permission | mcp | cli | auth
```

通过标准是：数据确实返回时不丢页；数据为空时有明确完整标记；无权限或失败时不伪装成空数据；任何不完整结果都能在最终回答中被用户感知。
