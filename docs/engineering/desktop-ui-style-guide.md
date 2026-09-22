# 桌面端 UI 样式规范（CEES AI Desktop）

> 适用范围：`apps/desktop` 客户端。
> 本文约束后续前端功能开发的目录组织、主题使用、样式写法和图标选型，保证 UI 一致、可维护。

## 1. 目录结构

`src/` 按「职责分层 + 功能归组」组织：

```
src/
├── main.tsx                  # 应用入口（Provider、主题、全局 CSS 引入）
├── vite-env.d.ts             # 全局类型声明
├── app/                      # 应用壳：入口页面、主布局、全局 Provider
│   ├── App.tsx               # 根组件 + 登录页
│   ├── Workspace.tsx         # 工作台主布局（侧边导航 + 内容区）
│   ├── preferences.tsx       # 主题/字号偏好 Provider
│   ├── login.css
│   ├── workspace.css
│   └── preferences.css
├── core/                     # 跨功能基础设施（不直接渲染页面）
│   ├── api.ts                # API 客户端
│   ├── i18n.tsx              # 国际化 Hook / Provider
│   └── i18n-dictionaries.ts  # 翻译字典
├── styles/                   # 全局 / 共享样式
│   ├── styles.css            # 全局基础样式（reset、根字体）
│   └── shared.css            # 共享业务样式（通用面板、表格、表单）
└── features/                 # 功能模块（后续新功能统一放这里）
    ├── projects/             # 每个功能一个子目录
    │   └── ProjectManagement.tsx
    ├── meetings/
    │   ├── MeetingManagement.tsx
    │   └── meeting.css
    ├── reports/
    ├── notifications/
    ├── organization/
    ├── roles/
    ├── profile/
    └── platform/
```

约定：

- **新功能一律放 `src/features/<feature>/`**，一个功能一个子目录。
- 功能目录内：`Xxx.tsx`（页面组件）+ `xxx.css`（该功能专属样式），二者同名。
- `core/` 只放跨功能的纯逻辑（API、i18n 等），不放页面组件。
- `app/` 只放应用壳（入口、主布局、全局 Provider）。
- 被多个功能复用的业务样式放 `styles/shared.css`，不要互相 import 别人的 `xxx.css`。

## 2. 主题系统

主题通过两层统一：

1. **Ant Design 设计令牌**（`main.tsx` 的 `ConfigProvider`）：

   ```tsx
   <ConfigProvider theme={{
       algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
       token: {
           colorPrimary: '#565cf6',
           borderRadius: 6,
           fontFamily: '"Manrope", "Noto Sans SC", sans-serif',
           fontSize: 13 | 14 | 16, // small | normal | large
       },
   }}>
   ```

   组件颜色、圆角、字号应优先由 Ant Design 令牌驱动，不要写死。

2. **CSS 变量**（`styles.css` 的 `:root`，唯一来源）：

   ```css
   :root {
       --workspace-bg: #f4f6f9;   /* 页面/工作区背景 */
       --surface: #ffffff;         /* 卡片/面板表面 */
       --surface-soft: #f8f9fb;    /* 浅底表面 */
       --line: #e8ebf1;            /* 分隔线/描边 */
       --text: #202432;            /* 主文字 */
       --muted: #858c9b;           /* 次要文字 */
       --primary: #565cf6;         /* 品牌主色 */
       --primary-rgb: 86, 92, 246; /* 主色 RGB（透明阴影用 rgba(var(--primary-rgb), …)） */
       --primary-soft: #eef0ff;    /* 主色浅底 */
   }

   :root[data-theme='dark'] { /* 暗色覆盖，仅覆盖语义令牌，--primary 保持不变 */ }
   ```

   - 所有颜色令牌**只在 `styles.css` 定义**，`workspace.css` / `preferences.css` 不得重复定义。
   - 历史遗留的 `--app-*`（`--app-text` / `--app-surface` / `--app-border` / `--app-muted` / `--app-background` / `--app-surface-soft`）已改为语义令牌的**别名**；新代码统一使用语义令牌（`--text` / `--surface` / `--line` / `--muted` 等）。
   - 自定义 CSS 中**必须使用变量**（`var(--primary)`），不要直接写 `#565cf6` 等十六进制，便于后续统一换肤。

## 3. 颜色规范

| 用途 | 变量 / 值 |
| --- | --- |
| 品牌主色 | `var(--primary)` `#565cf6` |
| 主色浅底（选中态、hover 底） | `var(--primary-soft)` `#eef0ff` |
| 页面背景 | `var(--workspace-bg)` `#f4f6f9` |
| 面板/卡片表面 | `var(--surface)` `#ffffff` |
| 主文字 | `var(--text)` `#202432` |
| 次要文字/占位 | `var(--muted)` `#858c9b` |
| 分隔线/描边 | `var(--line)` `#e8ebf1` |
| 危险色（删除、错误文本、高优先级预警） | `var(--danger)` `#f0564a` |
| 危险态浅底 / 描边 / 文字 | `var(--danger-soft)` / `var(--danger-line)` / `var(--danger-ink)` |
| 警告色（逾期、待处理提醒） | `var(--warning)` `#f97316` |
| 警告态浅底 / 描边 / 文字 | `var(--warning-soft)` / `var(--warning-line)` / `var(--warning-ink)` |

状态色族（`--danger*` / `--warning*`）与语义令牌一样**只在 `styles.css` 定义一次**，
并在 `:root[data-theme='dark']` 下整体换算（暗色下改为提高前景亮度 + 暗底，
否则浅底状态卡会在深色工作区里突兀发白）。功能页不得写死 `#d4380d`、`#e5484d`、
`#f2d4b8` 一类色值，也不得自行复制一份暗色覆盖。

语义色调（图标/卡片角标用，成对「文字色 + 浅底」）：

| tone | 文字色 | 浅底 |
| --- | --- | --- |
| indigo（默认/品牌） | `#565cf6` | `#eef0ff` |
| violet | `#854cf4` | `#f3edff` |
| green | `#00a876` | `#e8f8f2` |
| orange | `#f97316` | `#fff0e7` |
| blue | `#3377ff` | `#eaf1ff` |
| mint | `#11a66a` | `#e9f8f1` |
| sky | `#4e7bf2` | `#edf3ff` |
| amber | `#e98b16` | `#fff4e2` |

## 4. 字体与排版

- 字体栈：`"Manrope", "Noto Sans SC", sans-serif`（拉丁 + 中文）。
- 基准字号：14px（`preferences` 可切换 13/16）。
- 页面标题：`h1` 24px；区块标题 `h3`/`.section-title` 16px；正文 12–14px；辅助说明 10–11px。
- 行高：正文 `1.5–1.55`。

## 5. 圆角与阴影

- 统一圆角：`6px`（Ant Design 令牌 `borderRadius: 6`）；输入框/编辑器可用 `12–14px`，胶囊按钮用 `999px`。
- 阴影仅在 hover/浮层/主要操作按钮使用，示例：`0 5px 14px color-mix(in srgb, var(--primary) 22%, transparent)`。
- 面板卡片默认**无阴影**，用 `1px solid var(--line)` 描边区分层次。

## 6. 间距

- 页面内边距：`26px 28px 32px`（`.workspace-page`）。
- 卡片内边距：`16px 18px`。
- 元素间距（gap）：小 6–8px，常规 10–14px，区块 18–24px。
- 优先用 flex/grid 的 `gap`，少用 `margin` 制造间距。

## 7. 组件与样式约定

- **优先用 Ant Design 组件**（`Button`、`Input`、`Select`、`Modal`、`Form`、`Table`、`Empty`、`Spin`、`Tag`、`Dropdown`、`Tooltip` 等），不要重复造轮子。
- 自定义样式通过给 Ant Design 组件加 `className` 后，在对应 `xxx.css` 里用 `.xxx .ant-xxx` 覆盖，**不要写全局 `!important`**（确有必要除外，见下方说明）。
- 面板/卡片统一用 `.surface-panel`（`border + radius + surface 背景`）或功能内自己的 panel class，保持视觉一致。
- 数据加载态统一用 `<Spin />` 包裹在 `.data-loading`；空态统一用 `<Empty />`。
- 危险操作（删除）统一 `danger` 按钮 + `Modal.confirm` 二次确认。

## 8. 图标库使用约定

项目同时使用两套图标，按场景区分，**不要混用**：

| 库 | 用途 | 示例 |
| --- | --- | --- |
| `@ant-design/icons` | 业务/系统类图标：导航、菜单、功能入口、状态 | `HomeOutlined`、`ProjectOutlined`、`CalendarOutlined`、`SettingOutlined` |
| `lucide-react` | 聊天/操作类图标：轻量动作、工具按钮 | `Send`、`Download`、`Eye`、`Pencil`、`Trash2`、`Upload`、`Globe2`、`BookOpen` |

规则：

- 侧边导航、功能入口、表格状态 → 用 `@ant-design/icons`（`*Outlined`）。
- 聊天工具栏、资源操作（下载/查看/删除）、轻量动作 → 用 `lucide-react`。
- lucide 图标统一 `size={15}` 或 `size={16}`，用 `stroke-width: 1.8` 保持粗细一致。
- 新增图标优先在现有两库中选，不新增第三个图标库。唯一例外是「展开/收起」这类纯装饰性指示箭头：允许内联 `<svg>` 手绘细线 chevron（13px、`stroke-width: 1.8`、`stroke-linecap: round`），因为 antd 的实心三角在小字号下发粗显笨重。
- 折叠指示箭头的方向约定：**未展开指向右（`>`），展开后指向下（`v`）**。实现上只用一份「指向右」的图形，展开时 `transform: rotate(90deg)` 顺时针旋转，不要为两种状态各写一个图标（避免切换时产生跳变）。

## 9. 命名规范

- **文件名**：组件 `PascalCase.tsx`；样式 `kebab-case.css`（与组件同名）。
- **CSS 类名**：`kebab-case`，层级用 `.parent .child` 表示，不用 BEM 下划线。
- 功能模块的根类名带功能前缀，例如 `project-`、`meeting-`、`role-`、`chat-`，避免跨模块重名。
- CSS 变量命名：`--语义`（`--primary`、`--muted`、`--line`），不按颜色值命名。

## 10. 响应式

- 主布局最小宽度 `1080px`（Electron 窗口 `minWidth: 1100`）。
- 断点示例：`@media (max-width: 1280px)` 下收紧侧栏、网格列数。
- 聊天文档预览面板在窄屏从「第三列」降级为「右侧抽屉」（`position: fixed`），保持聊天区可用宽度。
- 新增功能要考虑在 `1280px` 宽度下的可用性，避免布局溢出。

## 11. 快速检查清单

- [ ] 组件放对目录（`features/<feature>/` 或 `app/`）。
- [ ] 颜色用了 CSS 变量 / Ant Design 令牌，没写死十六进制。
- [ ] 图标选对了库（业务 → antd，操作 → lucide）。
- [ ] 空态 / 加载态用了 `Empty` / `Spin`。
- [ ] 删除等危险操作有二次确认。
- [ ] 类名 kebab-case 且带功能前缀。

## 12. Mac / iPhone 适配要求（新增强制项）

所有新功能在设计与开发阶段都必须考虑 `macOS` 与 `iPhone` 交付状态，不允许只在 Windows / Android 视口下“看起来正常”。

### 12.1 Mac 适配要求

- 桌面端应用必须对 `process.platform === 'darwin'` 做平台分支，使用 `titleBarStyle: 'hiddenInset'`、`trafficLightPosition`、并按 Mac 版窗口风格调整留白。
- Mac 窗口最小宽度不得小于 `1040px`，内容区 padding 取 `18px` 级别，避免 Windows 版过宽的留白感。
- 组件圆角与卡片边距需要在 `:root[data-platform='mac']` 下微调，保持「更轻、更圆润、适合 Retina 界面」的视觉密度。
  - 平台标记由 `PreferencesProvider` 写入 `document.documentElement`（即 `:root`），因此选择器必须用 `:root[data-platform='mac']`；写成 `body[data-platform='mac']` 永远不会命中。
  - 跨页面通用的圆角与标题级别收敛统一放在 `styles/styles.css`（覆盖 `.ant-card` / `.ant-modal-content` / `.ant-drawer-content` / `.ant-table` 与 `.workspace-page-header`），功能页 `xxx.css` 只需处理自己的特殊布局。
- Mac 交互必须兼容 `Cmd` 系列快捷键；若设计了快捷键，优先使用 `metaKey` / `event.metaKey`，不要把 `Ctrl` 绑定成唯一入口。
- 新增功能必须在大显示器、正常窗口和较窄窗口下验证布局不发生溢出，且导航区/侧边栏/对话区均可用。

### 12.2 iPhone 适配要求

- 移动端所有页面必须使用 `SafeArea` + `MediaQuery.padding.bottom`，避免底部导航遮挡内容。底部按钮区需保留够用的触控目标（至少 44x44pt）。
- 紧凑屏幕（`width <= 390`）应启用更小的左右边距（12–18px），字体按 iPhone 默认阅读尺度缩放，避免被 24px 级大间距挤压。
- 复杂列表、表单、弹窗与附件选择器必须支持单列布局，并在键盘弹出时用 `MediaQuery.viewInsets.bottom` 调整底部留白。
- 任何 `SizedBox(height: 88)`、固定底部间距、悬浮栏或横向滚动控件，都应改为基于平台/屏幕尺寸计算，不能将通用布局写死成桌面尺寸。

### 12.3 适配检查清单

- [ ] 运行前检查当前功能在 macOS / iPhone 的最小窗口或最窄屏状态是否可用。
- [ ] 识别并处理 `darwin` / `iOS` 分支；目标平台的边距、圆角、键盘适配、底部安全区均已处理。
- [ ] 新增交互或快捷键不会只适配 Windows / Ctrl 组合键。
- [ ] 相关文档、验收说明已同步更新。

### 12.4 已落地的判定规则（逐页复查时按此对照）

**macOS**

- 根级整屏布局（登录页、平台管理台）不在 `.workspace-content` 内，拿不到那边的拖拽区内边距，必须自行让开窗口顶部 34px：
  - `platform.css` 的 `.platform-topbar` 用 `calc(72px + var(--platform-drag-height))` 增高并同步 `padding-top`；
  - `login.css` 的 `.login-intro` / 语言切换按钮按 `--platform-safe-top` 下移。
- 高度不能用 `100vh` 的场合：凡渲染在 `.workspace-content` 内部的元素，`100vh` 会比可用高度多出「容器内边距」，macOS 再多 34px，改用 `min-height: 100%`。
- 三分栏/固定列宽页面统一用 `height: calc(100vh - var(--page-viewport-offset))`，不要写死 `120px`；窄窗口（`<=1180px`）下由媒体查询收紧列宽。
- macOS 全屏时系统会隐藏交通灯，主进程通过 `cees:window-fullscreen-changed` 推送状态，`styles.css` 的 `:root[data-platform='mac'][data-fullscreen='true']` 把 `--platform-drag-height` / `--platform-safe-top` 归零。新增布局只需复用这两个令牌即可自动收回留白，**不要为全屏另写一份分支**。
- 右键菜单、应用菜单（`appMenu` / `editMenu` / 窗口菜单）与 `⌘` 系列快捷键由 `electron/main.ts` 统一提供，渲染层不要自行覆写全局按键。
- 为 Mac 最小窗口（`1040px`）预留窄窗口分支：凡使用 `grid-template-columns` 固定列宽、或多列并排的列表行（如邀请列表、任务行、部门树），
  必须提供 `@media (max-width: 1180px)` 收敛方案（改为等分两列、允许标题省略、收紧缩进），不得让操作按钮被挤出可视区。
- 逐页视觉复查的补充约定：
  - 页面级一级标题必须复用 `.workspace-page-header`，自建标题栏（`.hr-header` / `.connector-marketplace-header` / `.platform-heading` / `.finance-heading` / `.legal-heading`）需在 `styles/styles.css` 登记，避免 Mac 下字号比其它页重一级；
  - 各功能页 `xxx.css` 的颜色必须使用语义令牌（`var(--line)` / `var(--text)` / `var(--muted)`），组织页等历史页面已从十六进制硬编码迁回令牌，不得再新增硬编码色值；状态提示统一使用 `var(--danger*)` / `var(--warning*)` 令牌族，已迁移页面包括平台管理台（`platform.css` / `platform-tenant.css`）、个人中心（`profile.css`）、财务管理（`finance.css`）、知识管理（`knowledge.css`）、钉钉连接器（`dingtalk.css`）、角色化首页（`dashboard.css`）与连接器市场（`connectors.css`：连接态用 `var(--success)` / `var(--success-line)`，安装/连接失败提示用 `var(--danger)`）；
  - 固定左列的两栏/多栏页必须在 `@media (max-width: 1180px)` 收紧：当前已登记 `workspace.css`、`project.css`、`role.css`、`assignment.css`、`knowledge.css`、`finance.css`、`connectors.css`、`dashboard.css`、`department.css`、`invitation.css`、`profile.css`、`shared.css`、`dingtalk.css`（`.dingtalk-role-assignment`）、`legal.css`、`platform.css`、`platform-tenant.css` 与 `login.css`（登录页英雄区：双列最小宽度合计 960px，在 1040px 窗口下必须收紧标题字号与列宽），新增同类页面必须在本清单「加一」，否则在 Mac 最小窗口（1040px）下右侧内容会被挤出可视区；
  - 被多个功能页共用的业务样式（`styles/shared.css`）只在共享层做一次平台密度收敛（任务行、附件行、评论项、元信息网格），各功能页无需重复声明；其悬浮描边取 `var(--primary)`、半透明阴影取 `rgba(var(--primary-rgb), …)`、元信息网格底色取 `var(--surface-soft)`，不得回写 `#3478ff` 一类十六进制。

**iPhone**

- 任何底部悬浮导航之上的内容，底部留白必须取 `contentBottomInset(context)`；弹窗内取 `sheetBottomInset(context)`；输入区取 `keyboardBottomInset(context)` / `MediaQuery.viewInsets.bottom`。禁止写死 `88 / 96 / 104` 一类数值。
- 页面左右边距使用 `pagePadding(context)`（紧凑屏 14、常规 18），紧凑屏判定阈值统一为 `kCompactWidth = 390`。
- 触控目标不得低于 44x44pt：标签页、筛选 chip、图标按钮都应至少 44pt 高。
- 等宽多标签在紧凑屏上必须允许省略（`maxLines: 1` + `TextOverflow.ellipsis`）并在紧凑屏下调一级字号，防止多语言标签溢出。

## 13. 路由约定

- 使用 `react-router-dom` 的**声明式** `<Routes>/<Route>`，不要用 `if (pathname === '...')` 过程式分派。
- 工作台路由统一在 `app/Workspace.tsx` 的 `CurrentPage` 里注册；登录页 / 平台工作台在 `app/App.tsx` 顶层按认证状态分支。
- 现有路由：`/`（首页）、`/assistant`、`/projects`、`/meetings`、`/reports`、`/applications`、`/architecture`、`/roles`、`/knowledge`、`/notifications`、`/profile`、`/browser`。
- 新增页面：在 `features/<feature>/` 建组件，并在 `CurrentPage` 加一条 `<Route path="/xxx" element={<Xxx ... />} />`。
- 页面级数据查询内聚到对应页面组件内（如 `HomePage` 内部查 dashboard），不要在路由层统一触发无关查询。
