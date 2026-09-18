# 桌面端状态管理约定（CEES AI Desktop）

> 适用范围：`apps/desktop` 客户端。
> 本文约定前端状态的分层归属，保证状态可预测、可维护。变更本文前需与前端壳层 owner 确认。

## 1. 分层总览

| 层级 | 状态类型 | 工具 | 示例 |
| --- | --- | --- | --- |
| 服务端数据 | 来自 API 的异步数据（缓存 / 失效 / 重取） | `@tanstack/react-query` | 会话列表、成员列表、文档列表、dashboard 指标 |
| 全局 UI 偏好 | 跨组件、需持久化的用户偏好 | React Context + `localStorage` | 主题（themeMode）、字号（fontSize）、语言（language） |
| 局部 UI 状态 | 组件生命周期内的瞬时状态 | `useState` / `useReducer` | 弹窗开关、表单值、选中项、输入框内容 |

## 2. 服务端数据（React Query）

- 所有 API 读取统一走 `@tanstack/react-query` 的 `useQuery` / `useMutation`，不手写 `useEffect` 里 `fetch`。
- `queryKey` 语义化命名，格式 `['<domain>-<resource>']`，例如 `['dashboard-overview']`、`['tenant-members']`、`['documents']`、`['notifications-unread']`。
- 依赖权限的查询用 `enabled` 开关，如 `enabled: hasPermission('dashboard.read')`。
- 轮询用 `refetchInterval`（如 dashboard `120_000`、未读数 `60_000`）。
- 查询尽量**内聚到使用它的页面组件内**（如 dashboard 查询在 `HomePage`），避免在路由层全局触发无关查询。

## 3. 全局 UI 偏好（Context + localStorage）

- 主题 / 字号由 `app/preferences.tsx` 的 `PreferencesProvider` + `usePreferences` 提供，持久化到 `localStorage`（key 前缀 `cees.preferences.*`）。
- 语言由 `core/i18n.tsx` 的 `I18nProvider` + `useI18n` 提供。
- 新增全局偏好遵循同一模式：Context + 明确的 localStorage key，派生值用 `useMemo`。

## 4. 局部 UI 状态（useState）

- 表单、弹窗、选中项等局部状态用组件内 `useState`，不下沉到全局 store。
- 需要在组件间共享的复杂客户端状态，优先通过 props / Context 传递；只有确有必要时才引入 store。

## 5. 不使用全局客户端 store

- 当前不引入 `zustand` / `redux` 等全局客户端状态库（`zustand` 依赖已移除）。
- 若未来出现「多组件共享、高频更新、且与后端数据无关」的复杂客户端状态，再评估引入，并在本文同步更新约定。

## 6. 已落地的 Provider 树

```tsx
<PreferencesProvider>          {/* 主题 / 字号偏好 */}
  <I18nProvider>               {/* 语言 */}
    <ConfigProvider>           {/* antd 主题，读取 usePreferences */}
      <QueryClientProvider>    {/* React Query */}
        <HashRouter>           {/* 路由 */}
          <App />
        </HashRouter>
      </QueryClientProvider>
    </ConfigProvider>
  </I18nProvider>
</PreferencesProvider>
```
