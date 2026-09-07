# packages/api-client — 公开 API TypeScript 客户端

面向桌面端及未来 Web 客户端的 NestJS 公开 API 客户端。公开契约位于 `packages/contracts/openapi/openapi.yaml`。

- 本目录为生成物，**禁止手改**；
- 契约变更后重新生成并提交；
- 根目录执行 `pnpm contracts:generate` 重新生成。
当前公开契约仍只有健康检查，完整公开客户端生成配置尚未接入；在接入生成器前不得继续手写扩展业务方法。ai-service 内部契约和客户端已由 `packages/ai-service-client` 独立管理。
