# packages/api-client — 公开 API TypeScript 客户端

面向桌面端及未来 Web 客户端的 NestJS 公开 API 客户端。公开契约位于 `packages/contracts/openapi/openapi.yaml`。

- `src/core`、`src/models`、`src/services` 和 `src/index.ts` 为生成物，**禁止手改**；
- 契约变更后重新生成并提交；
- 根目录执行 `pnpm contracts:gen` 重新生成；
- `pnpm contracts:check` 会校验本目录与正式 OpenAPI 契约没有漂移。

生成器配置由 `packages/contracts` 维护。桌面端或其他 TypeScript 调用方应依赖本包，不得手写平行接口类型；ai-service 内部契约和客户端由 `packages/ai-service-client` 独立管理。

会话与轮次调用使用生成的 `ConversationService`。`POST /conversations/{id}/turns` 与事件重放是 SSE 接口，调用方需自行携带 `Idempotency-Key` 请求头并用 fetch 增量读取事件流，不能自动重连重复提交 POST（会产生 Token 成本）。
