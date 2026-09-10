# packages/api-client — 公开 API TypeScript 客户端

面向桌面端及未来 Web 客户端的 NestJS 公开 API 客户端。公开契约位于 `packages/contracts/openapi/openapi.yaml`。

- `src/core`、`src/models`、`src/services` 和 `src/index.ts` 为生成物，**禁止手改**；
- `src/chat-stream.ts` 是为 POST SSE 保留的手写扩展入口，不属于生成目录；
- 契约变更后重新生成并提交；
- 根目录执行 `pnpm contracts:gen` 重新生成；
- `pnpm contracts:check` 会校验本目录与正式 OpenAPI 契约没有漂移。

生成器配置由 `packages/contracts` 维护。桌面端或其他 TypeScript 调用方应依赖本包，不得手写平行接口类型；ai-service 内部契约和客户端由 `packages/ai-service-client` 独立管理。

普通 Chat 调用使用生成的 `ChatService.chatInvoke` 和 `ChatService.chatCompact`。当前生成器不能增量读取 POST SSE，流式对话使用：

```ts
import { OpenAPI } from '@cees/api-client';
import { streamChatEvents } from '@cees/api-client/chat-stream';

OpenAPI.TOKEN = accessToken;

for await (const event of streamChatEvents({ requestBody, signal })) {
  // started/status/content_delta/usage/completed/error
}
```

`streamChatEvents` 不自动重连，以免网络中断后重复提交会产生 Token 成本的 Chat POST 请求。
