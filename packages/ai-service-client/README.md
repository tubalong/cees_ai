# @cees/ai-service-client

由 `packages/contracts/openapi/ai-service.openapi.yaml` 生成的 TypeScript SDK，供 NestJS 内部 AI 编排模块使用。

- `src/generated` 禁止手改；
- `src/runtime-config.ts` 和包构建配置用于注入部署期 base URL；
- 修改契约后在仓库根执行 `pnpm contracts:gen`；
- 构建命令：`pnpm --filter @cees/ai-service-client build`。

该包不是桌面端或移动端公共客户端。

`streamLlm` 使用生成客户端的 SSE reader，并将每个 JSON `data` 解析为 `StreamEvent` 判别联合：

```ts
const result = await streamLlm({ client, body });

for await (const event of result.stream) {
  if (event.type === 'content_delta') process.stdout.write(event.text);
  if (event.type === 'error') throw new Error(event.error.code);
}
```

调用方应使用 `AbortSignal` 取消不再需要的流，并根据业务超时设置 `sseMaxRetryAttempts`；流开始后的 `error` 是正常 SSE 事件，不是非 2xx HTTP 响应。

文档接口由同一契约生成：`composeDocument` 返回可审阅的 `DocumentSpec`，`renderDocumentDocx` 和 `generateDocumentDocx` 返回 `Blob | File`。NestJS 应在调用前完成租户、权限和材料过滤，并负责将返回字节登记为正式文件；该 SDK 不负责业务写入。
