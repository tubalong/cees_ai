# apps/desktop — Electron 桌面端

Electron 壳 + React（Vite）渲染层，复用 `packages/ui-kit` 与 `packages/api-client`。

## 目录说明

```text
electron/  # 主进程、preload、桌面能力（文件、通知、深链、自动更新）
src/       # React 渲染层
```

## 待初始化

骨架阶段尚未生成：`index.html`、`vite.config.ts`、`electron/main.ts`、`electron/preload.ts` 与 tsconfig。
依赖按需通过 `pnpm --filter @cees/desktop add ...` 补充后启动：

```text
pnpm --filter @cees/desktop dev
```
