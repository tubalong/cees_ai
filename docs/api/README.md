# API 与契约约定

- `packages/contracts/openapi/openapi.yaml` 是 NestJS 公开 API 的事实源。
- `packages/contracts/openapi/ai-service.openapi.yaml` 是 NestJS 调用 ai-service 的内部契约。
- 桌面端和移动端不得调用 ai-service 的通用 invoke。
- ai-service 使用 `X-AI-Internal-Token` 请求头作为 OpenAPI `apiKey` 安全方案；该 Token 只授予可信内部服务。
- ai-service 的 FastAPI 文档由正式契约生成：Development 和 Staging 可查看、可调用，Production 禁用。
- TypeScript/Python/OpenAPI 生成物禁止手改，契约变更后必须运行 `contracts:lint`、`contracts:gen` 和 `contracts:check`。
- 新增或改变外部行为时先改契约，再实现服务端和调用端；兼容新增字段必须保持可选并声明默认行为。

文件上传的跨领域设计草案见 [文件上传设计](../architecture/file-upload.md)。其中路径和 Schema 只有写入公开 OpenAPI 并通过评审后，才构成正式 API。
