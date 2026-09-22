/**
 * 内容安全策略（CSP）的唯一定义处。
 *
 * 三个消费方必须保持一致：
 *   1. `electron/security.ts` —— 开发期由主进程以响应头下发（dev 变体）；
 *   2. `vite.config.ts` —— **打包时**注入 index.html 的 meta（严格变体）；
 *   3. `docs/engineering/desktop-security-hardening.md` —— 文档说明。
 *
 * 为什么必须分成两个变体：
 * `@vitejs/plugin-react` 会把 React Refresh 的 preamble 作为**内联模块脚本**注入
 * index.html。而多个 CSP 之间只会取交集，**永远无法被放宽**——因此一旦在 index.html
 * 内置了禁止 inline 的 meta，开发期的响应头再怎样放宽都没用，dev 会直接白屏
 * （`@vitejs/plugin-react can't detect preamble`）。
 *
 * 结论：meta 只在打包产物里存在（见 vite.config.ts 的 apply: 'build'），
 * 开发期只保留响应头，两者各自适用自己那套策略。
 */

/**
 * 生成策略字符串。
 *
 * @param options.allowInlineScript 是否放行 inline 脚本。仅开发期需要（React Refresh preamble）。
 */
export function buildCsp(options: { allowInlineScript: boolean }): string {
    return [
        "default-src 'self'",
        options.allowInlineScript ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
        // Ant Design 与 Vite 都会注入 <style>，样式必须放行 inline；
        // fonts.googleapis.com 是 styles.css 里 @import 的字体样式表来源。
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: blob: https: http:",
        // 字体文件实际由 fonts.gstatic.com 提供。
        "font-src 'self' data: https://fonts.gstatic.com",
        // 业务 API 地址可配置：桌面端可能是内网 http 或网关 https，连接来源不做更细的收窄；
        // dev 下还需要 ws: 用于 Vite HMR。
        "connect-src 'self' http: https: ws: wss:",
        // 浏览器页签（webview）需要加载任意 http(s) 站点。
        "frame-src 'self' https: http:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
        // 不声明 frame-ancestors：该指令经 meta 传递时会被浏览器忽略并报错，
        // 防嵌套由 Electron 单窗口架构本身保证。
    ].join('; ');
}

/** 打包产物使用的严格策略；由 vite.config.ts 注入 index.html。 */
export const PRODUCTION_CSP = buildCsp({ allowInlineScript: false });

/** 开发期响应头使用的策略；只比生产多放行 inline 脚本。 */
export const DEV_CSP = buildCsp({ allowInlineScript: true });
