# packages/contracts — 全仓唯一跨语言契约

跨语言 HTTP 行为只在本目录定义：

```text
openapi/
├── openapi.yaml                 # NestJS 公开 API
└── ai-service.openapi.yaml      # NestJS -> ai-service 内部 API
```

`ai-service.openapi.yaml` 定义 health、ready、通用 LLM、无状态上下文 Chat 和领域无关文档生成接口；全部内部能力都通过请求头 `X-AI-Internal-Token` 的 `apiKey` 安全方案保护。客户端只能调用 `openapi.yaml` 中由 NestJS 暴露的公开接口，不能直接访问 ai-service。

内部契约 `0.2.0` 为错误响应兼容增加可选 `execution`，只用于把“模型已执行但结果随后被拒绝”的实际 Token 传回 NestJS；省略时表示没有可记录的执行元数据。

## 变更流程

1. 先修改对应 OpenAPI 文件；
2. 执行 `pnpm contracts:lint`；
3. 执行 `pnpm contracts:gen` 更新生成客户端、Pydantic 模型和运行时文档产物；
4. 执行 `pnpm contracts:check` 确认生成物无漂移；
5. 更新调用方、测试和对应架构/API 文档。

生成物包括：

- 公开 TypeScript API 客户端生成目录：`packages/api-client/src/core`、`models`、`services` 和 `index.ts`；
- TypeScript：`packages/ai-service-client/src/generated`；
- Python：`apps/ai-service/app/api/generated/models.py`；
- ai-service Swagger 契约：`apps/ai-service/app/api/generated/openapi.json`。

FastAPI `/docs` 直接展示生成的 OpenAPI JSON；测试会另外根据 Python 路由生成运行时 OpenAPI，并对路径、方法、operationId、标签、认证、响应状态和主要 Schema 字段执行契约漂移检查。

全部客户端与契约产物生成命令：

```text
pnpm contracts:gen
```
生成目录禁止手改。`packages/api-client/src/chat-stream.ts` 是公开 POST SSE 的维护型扩展，不是生成物。契约相关 PR 必须由契约负责人评审。
