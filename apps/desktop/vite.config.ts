import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { PRODUCTION_CSP } from './electron/csp';

/**
 * 打包时把 CSP 注入 index.html 的 <head>。
 *
 * 只在构建阶段生效（`apply: 'build'`）：开发期页面不带 meta，
 * 因为 React Refresh 的 preamble 是内联脚本，而 meta CSP 无法被开发期的响应头放宽
 * （多个 CSP 只会取交集），带 meta 会让 dev 直接白屏。详见 `electron/csp.ts`。
 */
function cspMetaPlugin(): Plugin {
    return {
        name: 'cees-csp-meta',
        apply: 'build',
        transformIndexHtml(html) {
            const meta = `    <meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}" />\n`;
            return html.replace('</head>', `${meta}</head>`);
        },
    };
}

export default defineConfig({ base: './', plugins: [react(), cspMetaPlugin()], server: { port: 5173, strictPort: true } });