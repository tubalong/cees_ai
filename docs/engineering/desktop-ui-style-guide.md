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

2. **CSS 变量**（`workspace.css` 的 `:root`）：

   ```css
   :root {
       --workspace-bg: #f4f6f9;   /* 页面/工作区背景 */
       --surface: #ffffff;         /* 卡片/面板表面 */
       --line: #e8ebf1;            /* 分隔线/描边 */
       --text: #202432;            /* 主文字 */
       --muted: #858c9b;           /* 次要文字 */
       --primary: #565cf6;         /* 品牌主色 */
       --primary-soft: #eef0ff;    /* 主色浅底 */
   }
   ```

   自定义 CSS 中**必须使用变量**（`var(--primary)`），不要直接写 `#565cf6` 等十六进制，便于后续统一换肤。

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
| 危险色（删除、关闭 hover） | `#f0564a` |
| 警告色（逾期、警示） | `#f97316` |

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
- 新增图标优先在现有两库中选，不新增第三个图标库。

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
