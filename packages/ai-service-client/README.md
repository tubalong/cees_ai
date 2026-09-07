# @workbench/ai-service-client

由 `packages/contracts/openapi/ai-service.openapi.yaml` 生成的 TypeScript SDK，供 NestJS 内部 AI 编排模块使用。

- `src/generated` 禁止手改；
- `src/runtime-config.ts` 和包构建配置用于注入部署期 base URL；
- 修改契约后在仓库根执行 `pnpm contracts:gen`；
- 构建命令：`pnpm --filter @workbench/ai-service-client build`。

该包不是桌面端或移动端公共客户端。
