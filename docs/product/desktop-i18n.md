# Desktop 客户端多语言支持

> 状态：已落地
> 适用范围：`apps/desktop`
> 支持语言：简体中文（默认）、繁体中文、English、日本語

## 1. 功能概述

Desktop 客户端全部界面文案支持四种语言实时切换：

- 登录页（企业登录、超级管理员登录、邀请激活）
- 工作台（首页、AI 助手、应用中心、组织与部门、角色权限、知识管理、个人中心）
- 平台超级管理员控制台（租户列表、租户详情、管理员维护）
- 成员邀请管理、部门管理弹窗与一次性凭证弹窗
- antd 组件内置文案（日期选择、分页、空状态等）
- 日期与时间格式（`Intl.DateTimeFormat` 跟随界面语言）

## 2. 实现方式

| 部分 | 位置 | 说明 |
| --- | --- | --- |
| Provider 与 Hook | `apps/desktop/src/i18n.tsx` | `I18nProvider`、`useI18n`、`t()`、`LanguageSwitcher`、`useDateFormatter` |
| 翻译字典 | `apps/desktop/src/i18n-dictionaries.ts` | 以简体中文原文为 key 的三语字典（`zh-TW` / `en-US` / `ja-JP`） |
| antd 组件 locale | `apps/desktop/src/main.tsx` | `ConfigProvider` 按语言切换 `zh_CN` / `zh_TW` / `en_US` / `ja_JP` |

约定：

- `zh-CN` 为源语言，字典中不维护 `zh-CN` 条目，`t()` 直接返回 key；
- 含变量的文案使用 `{name}` 占位符，调用 `t('欢迎回来，{name}', { name })`；
- 语言偏好持久化在 `localStorage` 的 `cees.preferences.language`，重启客户端后保留；
- 切换语言时同步更新 `document.documentElement.lang`；
- 日期统一通过 `useDateFormatter()` 格式化，不再硬编码 `zh-CN` locale。

## 3. 语言切换入口

- 登录页右上角语言选择器；
- 个人中心 → 界面个性化 → 界面语言。

## 4. 边界与暂缓项

- 后端返回的错误消息（`error.message`）由服务端生成，当前以服务端语言直接展示，未在客户端翻译；后续契约提供稳定错误码后可映射为本地化文案。
- `api.ts` 中的兜底错误消息（如"请求失败，请稍后重试"）暂未本地化。
- 模块级常量（应用中心应用列表、数据范围选项、权限分组名）以中文 key 存储，渲染时经 `t()` 翻译。
- 移动端（Flutter）多语言暂不在本设计范围内。
