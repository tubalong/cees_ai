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

Chat 接口由同一契约生成：invokeChat 返回完整 Assistant 消息，streamChat 返回 ChatStreamEvent，compactChat 返回调用方需要保存并在后续请求中重放的摘要。调用方必须传入完整可用历史或 conversation_summary + recent messages，并处理 started/status/content_delta/usage/completed/error。

内部契约 `0.2.0` 起，`ErrorResponse.execution` 可在模型已执行但 Chat 结果随后被拒绝时出现；NestJS 应记录其中的实际 Token，字段缺失或为 `null` 时不得虚构一次模型调用。

文档接口由同一契约生成：`composeDocument` 返回可审阅的 `DocumentSpec`，`renderDocumentDocx` 和 `generateDocumentDocx` 返回 `Blob | File`。NestJS 应在调用前完成租户、权限和材料过滤，并负责将返回字节登记为正式文件；该 SDK 不负责业务写入。

`generation_mode: 'quality'` 会让 `composeDocument` 额外返回 `plan` 与 `planning_execution`，调用方应分别统计规划和最终组合的模型消耗；`fast` 模式保持单次调用，两字段为空。
