# apps/desktop — Electron 桌面端

Electron 壳 + React（Vite）渲染层，复用 `packages/ui-kit` 与 `packages/api-client`。

## 目录说明

```text
electron/  # 主进程、preload、桌面能力（文件、通知、深链、自动更新）
src/       # React 渲染层
```

## 开发与构建

Electron 主进程、preload、Vite 渲染入口与 TypeScript 配置已经落地。preload 仅通过 `window.cees` 暴露平台和 Electron 版本信息；业务数据继续通过版本化 API 获取。

开发启动：

```text
pnpm --filter @cees/desktop dev
```

类型检查与生产构建：

```text
pnpm --filter @cees/desktop build
```
