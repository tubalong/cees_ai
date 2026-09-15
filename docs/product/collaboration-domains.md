# 协作域客户端对接（项目 / 任务 / 会议 / 报告 / 通知 / 工作台 / AI / 批量导入 / 文件上传）

> 状态：已落地
> 对接契约版本：`0.19.0`（依据《CEES AI 平台使用、接口与数据库字典》2026-09-11 版）
> 客户端：Desktop（Electron + React）、Mobile（Flutter）

本文说明客户端在协作域已经对接的接口范围、交互约定与遗留假设。接口参数以使用文档与 `packages/contracts/openapi/openapi.yaml`（同步后）为准。

## 1. 已对接范围

| 域 | Desktop | Mobile | 说明 |
| --- | --- | --- | --- |
| 组织批量导入 | ✅ | 仅 API 封装 | Excel 由桌面端解析，移动端不提供 Excel 导入界面 |
| 文件上传 | ✅（任务附件） | API 封装 | 预签名 PUT 直传 COS，HEAD 校验后登记正式文件 |
| 项目与项目成员 | ✅ | ✅ | CRUD、状态机 8 命令、成员角色、负责人转移 |
| 任务、评论、附件、动态 | ✅ | ✅（附件除外） | 任务 CRUD、父子任务约束由服务端校验、状态流转、执行人替换、评论、附件、动态 |
| 会议管理 | ✅ | ✅ | 创建、状态流转、参会人、邀请应答、纪要（创建/编辑/发布/重开） |
| 日报与周报 | ✅ | ✅ | 创建草稿、编辑、提交、撤回、删除、审核 |
| AI 对话 | ✅（invoke + compact） | ✅（invoke） | 会话历史仅存客户端本地，服务端只记 Token |
| 通知中心 | ✅ | ✅ | 列表、未读数、单条/全部已读 |
| 工作台看板 | ✅ | ✅ | overview / todos / task-statistics / upcoming-meetings |

## 2. 关键实现位置

### 2.1 Desktop

- API 层：`apps/desktop/src/api.ts`（按域分段：组织导入、文件上传、AI、通知、看板、项目、任务、会议、报告）
- 页面：
  - `ProjectManagement.tsx`：项目列表 / 详情 / 状态机 / 成员 / 任务 / 任务详情（评论、附件、动态）
  - `MeetingManagement.tsx`：会议列表 / 详情 / 参会人 / 应答 / 纪要
  - `WorkReportPage.tsx`：日报周报生命周期
  - `NotificationCenter.tsx`：通知中心（侧边导航带未读徽标）
  - `OrganizationImportModal.tsx`：批量导入（模板下载、解析、预览、校验、确认、凭证导出）
  - `Workspace.tsx`：首页接入 dashboard 真实数据；AI 助手对接 `chat/invoke` + `chat/compact`

### 2.2 Mobile

- API 层：`apps/mobile/lib/src/core/mobile_api.dart`（与桌面端同域分段）
- 页面：`lib/src/features/workbench/`（workbench_page + overview/projects/meetings/reports/notifications 五个 tab）；`home_page.dart` 双模式对话对接 `chat/invoke`

## 3. 组织批量导入（桌面端）

- **模板下载**：`OrganizationImportModal.tsx` 顶部「下载 Excel 模板」按钮，CDN 地址由常量 `ORGANIZATION_IMPORT_TEMPLATE_URL` 控制（部署时替换为实际地址）。
- **Excel 结构**：Sheet「部门」（部门路径 / 排序 / 部门说明）+ Sheet「人员」（姓名 / 登录账号（可选）/ 部门路径），与使用文档 20.5.1 一致。
- **前端校验**：路径分隔与层级（≤10 级、无 `//`、不以 `/` 开头结尾）、路径唯一、父路径存在、账号 3～32 位字母数字、批次内账号去重。
- **clientRef**：按 Excel 行号生成 `department-row-N` / `member-row-N`。
- **账号建议**：登录账号留空的成员在解析后逐个调用 `POST /tenants/current/account-suggestions` 生成拼音建议，管理员可在预览表覆盖。
- **默认角色**：从 `GET /roles` 拉取并过滤 `tenant_admin`；成员可单独覆盖（`roleIds` 优先于 `defaultRoleIds`）。
- **激活有效期**：1～30 天，默认 7 天。
- **校验/确认**：先 `validate`（展示 CREATE/REUSE 与逐项 issues，问题行标红）；`valid=true` 才允许 `confirm`。
- **凭证导出**：确认成功后立即用 SheetJS 生成「成员激活凭证-<租户>-<日期>.xlsx」（姓名/部门/租户编码/登录账号/激活码/过期时间），一次性激活令牌不落库不缓存。

## 4. 文件上传

- 流程：`POST /upload-sessions`（Header `Idempotency-Key`）→ 预签名 `PUT` 直传 COS → `POST /upload-sessions/{id}/complete` → 获得 `fileObjectId`。
- 桌面端封装 `uploadAttachmentFile(file)`，用于任务附件（`POST .../attachments` 携带 `fileObjectId`）。
- 响应字段兼容：直传地址按 `uploadUrl | putUrl | url` 宽松解析，请求头按 `uploadHeaders | headers | requiredHeaders` 宽松解析。

## 5. AI 对话

- 桌面端：会话与消息保存在 `localStorage`（`cees.chat.conversations`），超过 40 条先 `chat/compact`（同一 `turnId`）再携带近 20 条调用 `chat/invoke`；支持 standard/ultra 模式切换。
- 移动端：闲聊/工作两模式各自独立 `conversationId`（持久于 Hive `settings` 盒），每次携带近 20 条历史调用 `chat/invoke`。
- `chat/stream`（SSE）暂未在客户端启用，后续需要流式体验时接入。

## 6. 遗留假设与待确认

1. **日报周报路径**：使用文档（v0.19.0）未列出该域的具体路径与请求体契约，本地 `openapi.yaml` 尚未同步 0.16.0。客户端按 RESTful 惯例实现为 `/work-reports` 系列（`submit`/`withdraw`/`approve`/`reject`）。若后端实际路径不同，仅需调整：
   - Desktop：`apps/desktop/src/api.ts`「日报与周报」分段
   - Mobile：`apps/mobile/lib/src/core/mobile_api.dart` 同名分段
2. **上传会话响应字段名**：文档未给出确切字段，当前做宽松解析（见第 4 节），联调时如 404/字段不匹配请与后端核对响应结构。
3. **工作台响应结构**：`DashboardOverview` 等按 `projects/tasks/reports/meetings/notifications` 五段宽松读取，UI 对缺失字段显示 `-`。
4. 知识库（无公开 API）与 AI 草稿/额度体系（部分基础）未对接，等待后端开放契约。
