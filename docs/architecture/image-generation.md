# Image Generation

> 状态：MVP 已实现。本文描述 ai-service 的领域无关图片生成能力；NestJS 侧的正式资源落地链路（generate_image 工具 → COS 落盘 → FileObject/Resource/ManagedImage/AIActionDraft/审计）已随 AI 助手工具循环落地（2026-09-11），见 [AI 助手工具循环](assistant-tool-loop.md)。

## 1. 目标

ai-service 负责选择支持图片生成的模型并返回图片字节与执行元数据。NestJS 负责能力校验、额度、COS 写入、正式文件登记、资源 ACL、审计和幂等。

## 2. 内部接口

### 2.1 图片生成

`POST /internal/v1/images/generate`

请求：

- `request_id`
- `tenant_id`
- `user_id`
- `prompt`
- `size`
- `quality`
- `response_format`

响应：

- `request_id`
- `content_type`
- `data_base64`
- `execution`

### 2.2 图片编辑

`POST /internal/v1/images/edit`

请求：

- `request_id`
- `tenant_id`
- `user_id`
- `prompt`
- `source_image_base64`
- `size`
- `quality`
- `response_format`
- `input_fidelity`

`input_fidelity=high` 用于色调、光线、色彩等需要尽量保留原图内容的微调；`low` 允许模型更自由地改变构图和内容。`source_image_base64` 解码后不得超过 10 MiB。

响应复用 `ImageGenerateResponse`：返回编辑后的 `content_type`、`data_base64` 和 `execution`。

## 3. ImageRouter

- 独立于 `LLMRouter`。
- 从 `[image_profiles.*]` 选择第一个启用 profile。
- 生成与编辑分别调用 Provider 的 `generate` 与 `edit` 方法。
- 图片 profile 支持 `mock` 与 `openai_compatible`。
- 瞬时失败可回退到下一候选；永久失败不跨模型重试。

## 4. 配置

`models.toml`：

```toml
[image_profiles.mock]
enabled = true
provider = "mock"
model = "mock-image-v1"
```

生产环境示例应配置：

```toml
[image_profiles.primary]
enabled = true
provider = "openai_compatible"
model = "change_me"
base_url = "https://change_me/v1"
api_key_env = "IMAGE_GEN_API_KEY"
```

环境变量：

```text
IMAGE_GEN_API_KEY=change_me
```

## 5. Provider 行为

- `mock` 返回固定测试字节，仅用于本地联调；编辑返回不同的固定测试字节。
- `openai_compatible` 生成使用 OpenAI Images API 的 `b64_json` 输出。
- `openai_compatible` 编辑使用 OpenAI Images API 的 `images.edit`，输入为 base64 解码后的源图片字节。
- `content_type` 由请求的 `response_format` 映射为 `image/png`、`image/jpeg` 或 `image/webp`。

## 6. 边界

- ai-service 不写 COS。
- ai-service 不创建 FileObject 或正式资源。
- ai-service 不校验租户额度。
- ai-service 不持久化图片。
- 编辑接口只处理 base64 源图，不接收 URL 或 multipart 文件上传。

## 7. NestJS 侧落地说明（2026-09-11）

- 公开入口是 `generate_image` 工具执行器（`apps/api/src/assistant/tools/executors/generate-image.tool.ts`），经 ToolRegistry/ToolPolicy 批准后调用 `ImageService.generateImage`，无独立公开 HTTP 接口；
- `ImageService`（`apps/api/src/image`，仿 document 模块模式）：ai-service 出图（Base64）→ 服务端 `StorageProvider.putObject` 上传 COS → 同一事务内写 FileObject（`purpose=GENERATED_IMAGE`）、Resource(IMAGE)、ManagedImage、AIActionDraft（`status=EXECUTED`，作为动作流水）、AuditLog（`IMAGE_GENERATED`）→ 短期下载 URL 返回给 ToolResult；
- 幂等以 `tool_call_id` 为边界：重复执行直接回放已落库资源（新短期 URL），不重复生成与上传；
- 图片访问通过既有 `GET /images/{imageId}` 资源接口完成，权限沿用 `image.read`。
