# packages/contracts — 全仓唯一跨语言契约

跨语言 HTTP 行为只在本目录定义：

```text
openapi/
├── openapi.yaml                 # NestJS 公开 API
└── ai-service.openapi.yaml      # NestJS -> ai-service 内部 API
```

`ai-service.openapi.yaml` 当前只定义 health、ready 和受内部 Token 保护的通用 LLM invoke，不包含具体业务接口。

## 变更流程

1. 先修改对应 OpenAPI 文件；
2. 执行 `pnpm contracts:lint`；
3. 执行 `pnpm contracts:gen` 更新生成客户端和 Pydantic 模型；
4. 执行 `pnpm contracts:check` 确认生成物无漂移；
5. 更新调用方、测试和对应架构/API 文档。

生成物包括：

- TypeScript：`packages/ai-service-client/src/generated`；
- Python：`apps/ai-service/app/api/generated/models.py`。

生成目录禁止手改。契约相关 PR 必须由契约负责人评审。
