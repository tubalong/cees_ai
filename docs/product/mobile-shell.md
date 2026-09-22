# Mobile 主界面

## 当前实现

- 根页面使用持久化 `IndexedStack` 管理 AI 助理、组织、工作台和我的四个主 Tab，切换时保留页面状态。
- 底部导航采用悬浮胶囊布局；选中项使用蓝紫渐变并同时显示线性图标与文字。
- AI 助理首页支持“工作”和“闲聊”两种模式，使用独立配色和对话内容。
- 两种模式均对接 `POST /chat/invoke`（0.15.0）：会话标识持久于 Hive `settings` 盒（`chat.conversationId.<mode>`），每次携带近 20 条本地历史；回答写入本地会话，服务端只记录 Token 用量。
- 底部保留 Excel/PPT/Word/报销工具入口（工作模式）。
- 组织页按登录成员权限展示「成员 / 部门 / 角色 / 邀请」四个标签，已对接 NestJS 公开 API：
	- 成员：分页查询成员、按姓名/账号搜索、查看状态（正常/待激活/禁用），并支持编辑展示名、启用/禁用、调整部门、分配角色、修改账号、重置凭证（展示一次性令牌）和移除成员。
	- 部门：部门树展开、创建/编辑/删除（仅空部门）、查看部门成员与成员数。
	- 角色：角色列表、创建/编辑/删除自定义角色、整体替换角色权限（权限目录多选）。
	- 邀请：邀请列表、创建成员邀请（含账号建议与角色选择）、撤销未使用邀请并展示一次性激活令牌。
- 工作台页（替换原消息原型页）按权限展示「概览 / 项目 / 会议 / 报告 / 通知」五个标签，已对接 NestJS 公开 API（详见 [协作域客户端对接](collaboration-domains.md)）：
	- 概览：`GET /dashboard/overview`、`GET /dashboard/todos`、`GET /dashboard/upcoming-meetings`。
	- 项目：项目列表/创建、项目详情（状态机命令、成员、任务列表）；任务详情支持状态流转与评论。
	- 会议：会议列表/创建、详情（邀请应答、参会人、状态流转、纪要查看）。
	- 报告：日报/周报列表、创建草稿（周报开始日期前端校验周一）、提交、撤回、删除、审核。
	- 通知：通知列表、未读数、仅看未读、单条/全部已读。
- 我的页面展示真实人员身份（展示名、账号、部门、角色）、当前企业，并支持编辑展示名、修改密码、切换语言和退出登录。
- 多语言（i18n）已接入：简体中文、繁体中文、英文、日文四语言，通过 `core/l10n.dart` 的 `AppLocalizations` + Riverpod `languageProvider` 实现，语言偏好持久化到 Hive `settings` 盒；切换后 `MaterialApp` 依据 `locale` 重新加载文案。

## 平台适配

- 采用 `ThemeData(platform: TargetPlatform.iOS)` 作为移动端基础主题，保证 iPhone 端保留系统风格感和触控反馈。
- 关键页面统一使用 `SafeArea` 与 `MediaQuery.padding.bottom`，避免底部导航、键盘和刘海区域遮挡动作区。
- 目前的底部导航、登录页和聊天页都已兼容紧凑屏幕（iPhone SE / 12 Mini 级宽度），左右边距自动收紧，底部距保留安全区。
- 尺寸常量集中在 `lib/src/shared/layout.dart`（紧凑屏阈值 `kCompactWidth`、矮屏阈值 `kCompactHeight`、导航高度、底部安全区下沉、触控目标、气泡宽度、页面边距），页面不得再写死底部留白与阈值魔数：
  - 悬浮导航之上的列表/页面底部留白 → `contentBottomInset(context)`；
  - 弹窗（`showModalBottomSheet` / `DraggableScrollableSheet`）内容底部 → `sheetBottomInset(context)`，让出 Home Indicator 或键盘高度；
  - 键盘内的输入区/表单 → `keyboardBottomInset(context)`（登录页与成员部门选择、项目/会议表单均已改用它）；
  - 紧凑屏判定 → `isCompactWidth(context)`，矮屏（含键盘弹起后的可视高度）→ `isCompactHeight(context)`，需要收紧密度时统一用 `isCompactViewport(context)`，页面不得自行写 `width < 360` / `height < 700` 一类阈值；悬浮底部导航（`mobile_shell.dart`）自身的左右边距同样取 `pagePadding(context)`，紧凑屏判定复用 `isCompactWidth(context)`，不得回写 `12 / 18`。
- 触控目标不低于 44x44pt：组织页四个等宽标签、工作台横向标签条均为 44pt 高；紧凑屏下标签字号下调一级并允许省略，防止多语言标签（Members / Departments 等）溢出。
- AI 助手已与桌面端同步：两端共用服务端工具与会话接口，因此「聊天式业务操作」在移动端同样可用。
  - 写操作确认卡片（`awaiting_confirmation`）：位于输入区上方，展示服务端返回的参数快照预览与「确认执行 / 取消」按钮（44pt 高），
    确认后立即转为终态文案；卡片是会话内瞬态，不写入本地缓存。
  - 目标草稿由服务端持有，客户端只提交 `draftId`（`v1/assistant/action-drafts/{id}/confirm|cancel`），参数不可能被前端篡改。
- 后续新增移动端页面必须在最窄屏宽度、横屏和键盘弹起状态下复查，不得依赖仅适配大屏布局。

## 接口边界

- 移动端只有租户域登录，不提供平台超级管理员登录与平台管理能力。
- 组织、工作台与个人资料已接入 NestJS 公开 API（成员、部门、角色、邀请、个人资料、改密、成员账号/凭证/角色/状态维护、项目/任务/会议/报告/通知/看板、AI 对话）；即时消息与企业认证仍为交互原型。
- 后续客户端只能调用 NestJS 公开 API，不直接调用 AI Service 或读取业务数据库。
- 闲聊和工作模式属于客户端交互状态；涉及企业数据和正式业务写入时仍必须由 NestJS 建立可信身份、租户和权限上下文。
- 权限判断以 `GET /auth/me` 返回的实时权限编码为准，前端按 `member.read`、`member.update`、`member.account.update`、`member.credential.reset`、`member.remove`、`department.*`、`role.*`、`member.invite` 等控制入口显隐，最终鉴权由 NestJS 决定。