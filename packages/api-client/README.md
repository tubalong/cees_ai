# packages/api-client — 公开 API TypeScript 客户端

面向桌面端及未来 Web 客户端的 NestJS 公开 API 客户端。公开契约位于 `packages/contracts/openapi/openapi.yaml`。

- 本目录为生成物，**禁止手改**；
- 契约变更后重新生成并提交；
- 根目录执行 `pnpm contracts:gen` 重新生成；
- `pnpm contracts:check` 会校验本目录与正式 OpenAPI 契约没有漂移。

生成器配置由 `packages/contracts` 维护。桌面端或其他 TypeScript 调用方应依赖本包，不得手写平行接口类型；ai-service 内部契约和客户端由 `packages/ai-service-client` 独立管理。
