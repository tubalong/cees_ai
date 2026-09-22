# 桌面端安全加固（CSP / IPC / 导航 / webview / 令牌存储）

> 主设计文档。关联：
> - [桌面端 UI 样式规范](desktop-ui-style-guide.md)
> - [AI 助手业务写操作](../product/assistant-business-tools.md)（使用 IPC 与本机能力的业务场景）
> - [钉钉 MCP 连接器](../product/dingtalk-mcp-connector.md)（当前唯一的本机连接器）
>
> 代码落点：`apps/desktop/electron/security.ts`、`apps/desktop/electron/secure-store.ts`、
> `apps/desktop/electron/main.ts`、`apps/desktop/electron/preload.ts`、
> `apps/desktop/src/core/api.ts`、`apps/desktop/index.html`。

## 1. 威胁模型

桌面端同时承担两类职责，一旦渲染层被注入脚本，损失不只是「页面被改」：

1. 它是企业业务界面，持有长期有效的会话令牌；
2. 它通过 `contextBridge` 暴露了 IPC，其中包括可读写本地文件系统的连接器能力
   （DWS 命令执行、未来的本机清理工具）。

因此攻击路径是：**不可信内容（AI 回答、文档、网页）→ 注入脚本 → 读取令牌 / 调用 IPC**。
下面五道闸门分别切断这条链路上的不同环节。

## 2. 五道闸门

### 2.1 内容安全策略（CSP）

CSP 的**唯一定义处**是 `apps/desktop/electron/csp.ts`（`buildCsp()` 生成，导出 `PRODUCTION_CSP` 与 `DEV_CSP`）。
两份策略共事一份主体，唯一差异是 `script-src` 是否放行 inline：

```
default-src 'self';
script-src  'self'                          # 生产；dev 额外加 'unsafe-inline'
style-src   'self' 'unsafe-inline' https://fonts.googleapis.com;
img-src     'self' data: blob: https: http:;
font-src    'self' data: https://fonts.gstatic.com;
connect-src 'self' http: https: ws: wss:;
frame-src   'self' https: http:;
object-src 'none'; base-uri 'self'; form-action 'none'
```

下发方式有两条，**运行形态决定用哪一条**：

| 运行形态 | 下发方式 | 策略变体 |
| --- | --- | --- |
| 开发期（Vite dev server） | 主进程 `session.webRequest.onHeadersReceived` 响应头 | `DEV_CSP` |
| 打包后（`file://`） | 构建时由 `vite.config.ts` 的 `cspMetaPlugin` 注入 `index.html` 的 `<meta>` | `PRODUCTION_CSP`（严格） |

> - `file://` 请求不经过 webRequest，因此**响应头方案在打包形态下完全失效**，meta 是必需的；
> - `index.html` 源码里**故意不写 meta**：`@vitejs/plugin-react` 会把 React Refresh 的 preamble
>   作为内联脚本注入，而多个 CSP 只能取交集、永远无法被放宽——一旦源码内置禁止 inline 的 meta，
>   开发期无论响应头怎么放行都会白屏（`@vitejs/plugin-react can't detect preamble`）。
>   这个坑实际发生过一次，修复方式是改成构建时注入（`apply: 'build'`）。

几个刻意的取舍：

- 生产 `script-src` 不放行 `eval`：已确认 `xlsx`、`react-markdown`、Ant Design 等依赖不依赖 `eval`
  （对 `xlsx.mjs` 做过检索）。
- `style-src` 必须放行 `inline`：Ant Design 与 Vite 都以 `<style>` 注入样式。
- `style-src` / `font-src` 放行 Google Fonts：`styles.css` 通过 `@import` 加载 Manrope / Noto Sans SC。
- `connect-src` 放行 `http:` / `https:` / `ws:`：业务 API 地址由打包配置决定（内网 http 或网关 https），
  不做更细的收窄，否则会在不同部署环境下静默失效；`ws:` 同时服务 Vite HMR。
- **不声明 `frame-ancestors`**：该指令通过 meta 传递时会被浏览器忽略并打印错误，
  防嵌套由 Electron 单窗口架构本身保证。

### 2.2 IPC 来源校验

`installIpcSenderGuard()` 包裹一次 `ipcMain.handle`，使**所有**通道（含后续新增）自动带上
`assertTrustedSender()`：

- 开发期只信任 Vite dev server 的源；
- 打包后只信任 `dist/index.html`（含 HashRouter 的 `#/...` 前缀）；
- 子框架（被注入的 iframe）的 `senderFrame` 不是主文档 → 拒绝。

集中包裹优于逐处调用：漏加一个是这类防御最常见的真实缺陷。

### 2.3 导航锁定

- `will-navigate` / `will-redirect`：非应用来源一律 `preventDefault`，外链交系统浏览器（`shell.openExternal`）；
- `setWindowOpenHandler` 原本就 deny + 外开，保持不变；
- 应用内路由走 HashRouter（只改 hash）不触发 `will-navigate`，因此不会误伤。

### 2.4 webview 策略

`will-attach-webview` 强制：

- 删除 `preload`；
- `nodeIntegration = false`、`contextIsolation = true`、`sandbox = true`；
- 只允许 `http(s)` 来源。

浏览器页签（`/browser`）需要访问任意站点，所以 `webviewTag` 保留为 `true`，
但被打开的第三方页面拿不到任何本地能力。

### 2.5 令牌移出 Web Storage

原先令牌存在 `localStorage` / `sessionStorage`：**明文**，任何同源脚本都能一次性读走长期有效的
刷新令牌。现在：

- 新增 `SecureTokenStore`（主进程），用 Electron `safeStorage` 加密后落盘到 `userData/session.secure`，
  文件权限 `0600`（Windows DPAPI / macOS Keychain / Linux libsecret）；
- 渲染层通过 `window.cees.secureStore`（IPC）读写，**不再把令牌写入 Web Storage**；
- 启动时先 `hydrateSecureSession()` 解密到内存镜像，再渲染应用，
  保证首屏会话校验拿得到令牌；
- 「记住我」语义保留：不勾选时令牌只驻内存，关闭应用即需重新登录；
- 首次启动会清理旧的 Web Storage 令牌，避免明文残留。

浏览器预览环境（直开 Vite）没有 `secureStore`，自动回退到原有 Web Storage 行为，不影响调试。

## 3. 验证方式与证据

1. **构建期**：`apps/desktop` 的 `tsc -b`（渲染层）与 `tsc -p electron/tsconfig.json`（主进程）均通过。
2. **CSP 行为验证**（关键）：分两端验证。
   - **打包形态**：用浏览器打开 `file:///…/apps/desktop/dist/index.html`，收集控制台输出。
     首轮发现三条违规（`frame-ancestors` 经 meta 无效、Google Fonts 样式表被 `style-src` 拦截、
     React Refresh 内联脚本被 `script-src` 拦截）→ 按 §2.1 修正后复验**不再有 CSP 违规**，页面完整渲染。
   - **开发形态**：确认 dev server 返回的 HTML **不含 CSP meta**（由主进程响应头下发），
     且 `tsc -p electron/tsconfig.json` 通过。
3. **IPC 校验**：`assertTrustedSender` 逻辑由「来源前缀匹配 + 非打包/打包分支」决定，
   随桌面端构建一起类型检查。

> 之所以用浏览器打开打包产物来验证：它应用的是同一条 meta CSP，
> 且控制台会直接报出违规指令，比在 Electron 里目视检查可靠。

## 4. 已知残余风险与后续项

| 项 | 现状 | 建议 |
| --- | --- | --- |
| `safeStorage` 不可用（无 keyring 的 Linux） | 退化为明文落盘，仅在日志告警 | 生产环境提供 keyring；或在不可用时拒绝「记住我」 |
| Google Fonts 为外部依赖 | CSP 已放行 | 离线/内网环境建议自托管字体，`font-src 'self'` 即可 |
| 自动更新 | 仍为 TODO（原注释保留） | 上线前接入签名更新源与灰度策略 |
| webview 内容 | 允许任意 http(s) 站点 | 若后续需要更严格策略，可改为域名白名单 |
| 本机工具（清理 C 盘等） | **未实现** | 必须走窄工具 + 本地 Broker + 清单 hash 确认，禁止开放通用命令执行 |
