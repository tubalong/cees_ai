# packages/contracts — 全仓唯一跨语言契约

跨语言 HTTP 行为只在本目录定义：

```text
openapi/
├── openapi.yaml                 # NestJS 公开 API
└── ai-service.openapi.yaml      # NestJS -> ai-service 内部 API
```

`ai-service.openapi.yaml` 当前只定义 health、ready 和受内部 Token 保护的通用 LLM invoke，不包含具体业务接口。内部 Token 在契约中以请求头 `X-AI-Internal-Token` 的 `apiKey` 安全方案表示。

## 变更流程

1. 先修改对应 OpenAPI 文件；
2. 执行 `pnpm contracts:lint`；
3. 执行 `pnpm contracts:gen` 更新生成客户端、Pydantic 模型和运行时文档产物；
4. 执行 `pnpm contracts:check` 确认生成物无漂移；
5. 更新调用方、测试和对应架构/API 文档。

生成物包括：

- 公开 TypeScript API 客户端：`packages/api-client/src`；
- TypeScript：`packages/ai-service-client/src/generated`；
- Python：`apps/ai-service/app/api/generated/models.py`；
- ai-service Swagger 契约：`apps/ai-service/app/api/generated/openapi.json`。

FastAPI `/docs` 直接展示生成的 OpenAPI JSON；测试会另外根据 Python 路由生成运行时 OpenAPI，并对路径、方法、operationId、标签、认证、响应状态和主要 Schema 字段执行契约漂移检查。

全部客户端与契约产物生成命令：

```text
pnpm contracts:gen
```
生成目录禁止手改。契约相关 PR 必须由契约负责人评审。
