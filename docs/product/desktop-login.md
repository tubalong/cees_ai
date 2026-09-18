# Desktop 登录

## 当前实现

- Desktop 首屏为企业标识、账号加密码登录，不提供短信验证码或二维码登录。
- 登录请求发送到 `POST /api/v1/auth/login`，请求体包含用户输入的租户编码、账号、密码和设备名称。
- 默认 API 基址为 `http://192.168.5.29:3000/api/`，可通过 `VITE_API_BASE_URL` 覆盖。
- 勾选“记住登录状态”时令牌写入 `localStorage`，否则写入 `sessionStorage`。
- 品牌 Logo 路径为 `apps/desktop/public/assests/logo.webp`。
- 应用启动时调用 `/auth/me` 恢复会话；Access Token 失效时通过 `/auth/refresh` 单次轮换并重放请求。
- 退出登录调用 `/auth/logout` 撤销后端 Session，并清理本地令牌。

## 工作区原型

- 左侧导航支持展开和收起，使用线性图标并在折叠时提供悬浮提示。
- 左侧导航分为三层：置顶独立入口（首页、AI 助手、应用中心）、按业务域折叠的父级管理分组、底部固定区（个人中心、退出登录、收起导航）。
- 父级管理分组为协作管理（项目管理、会议管理、工作报告）、组织管理（架构管理、角色权限、分配策略、钉钉管理）、业务管理（人力资源、财务管理、合同台账）、内容管理（生成文档、知识管理）、消息中心（通知中心）；点击分组标题折叠或展开，进入分组内页面时自动展开对应分组。
- 导航区域可纵向滚动，品牌区与底部固定区不随滚动移动；折叠状态下隐藏分组标题，按分组分段展示图标并使用分隔线区分。
- 分组与子项均按当前成员权限过滤，分组内无可见项时整组隐藏。
- 首页提供指标、常用应用、最近文档、待办、AI 助手入口和最近动态。
- AI 助手提供会话列表、消息流、快捷提示和本地原型回复。
- 应用中心提供分类筛选、应用选择、详情与使用入口。
- 架构管理通过 `/tenants/current/members` 展示当前权限范围内的真实成员。
- 知识管理通过 `/documents` 展示当前权限范围内的真实受控文档。

## 超级管理员登录

- 普通登录页中，当企业标识和账号均为空，仅在密码框输入约定触发词 `tubalong` 并按 Enter 时，切换到“超级管理员登录”。
- 触发词仅用于切换界面，会立即从密码框清除，不会发送到任何后端接口。
- 超级管理员登录只显示账号和密码，调用 `POST /platform/auth/login`。
- 平台 Access Token 与 Refresh Token 使用独立存储键，不与租户会话混用。
- 应用启动时通过 `/platform/auth/me` 恢复平台会话，401 时调用 `/platform/auth/refresh` 单次轮换。
- 平台退出调用 `/platform/auth/logout`，平台首页通过 `/platform/tenants` 展示租户、状态、管理员和待激活邀请数量。
- 隐藏入口不构成认证绕过；进入平台控制台仍必须通过后端平台管理员凭证校验。

## 租户开通与成员邀请

- 超级管理员可调用 `POST /platform/tenants` 创建租户，填写企业标识、企业名称、首位管理员姓名和可选账号。
- 创建租户按钮受 `platform.tenant.create` 权限控制；成功后刷新 `/platform/tenants` 列表。
- 创建租户响应中的首位管理员 `invitationToken` 只在当前弹窗展示，支持复制，但不写入 Local Storage、Session Storage 或日志。
- 租户管理员可在架构管理中调用 `/tenants/current/account-suggestions` 生成账号建议。
- 邀请表单通过 `/roles` 加载可分配角色，并调用 `POST /tenants/current/invitations` 创建邀请。
- 邀请管理通过 `GET /tenants/current/invitations` 展示状态；待激活邀请可调用 `DELETE /tenants/current/invitations/{invitationId}` 撤销。
- 创建成员邀请返回的一次性令牌按与首位管理员令牌相同的规则展示和复制，不持久化保存。
- 被邀请成员可在普通登录页进入“使用邀请激活账号”，调用 `POST /auth/activate` 设置密码并激活。
- 激活成功后客户端回填企业标识和成员账号，成员仍需使用新密码执行一次正常登录。
- 租户登录完成后必须调用 `/auth/me` 获取实时权限，再决定是否展示邀请、角色和成员管理操作。

## 后续工作

- 接入完整生成版 `packages/api-client`，移除 Desktop 内的临时请求类型。
- 接入成员邀请、角色分配、受控文档创建与编辑等写接口。
- 将长期会话凭据迁移到 Electron 主进程安全存储，并通过窄 IPC 向渲染进程提供会话能力。