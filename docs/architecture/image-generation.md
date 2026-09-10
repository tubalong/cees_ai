# Image Generation

> 状态：MVP 已实现。本文描述 ai-service 的领域无关图片生成能力。

## 1. 目标

ai-service 负责选择支持图片生成的模型并返回图片字节与执行元数据。NestJS 负责能力校验、额度、COS 写入、正式文件登记、资源 ACL、审计和幂等。

## 2. 内部接口

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

## 3. ImageRouter

- 独立于 `LLMRouter`。
- 从 `[image_profiles.*]` 选择第一个启用 profile。
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

- `mock` 返回固定测试字节，仅用于本地联调。
- `openai_compatible` 使用 OpenAI Images API 的 `b64_json` 输出。
- `content_type` 由请求的 `response_format` 映射为 `image/png`、`image/jpeg` 或 `image/webp`。

## 6. 边界

- ai-service 不写 COS。
- ai-service 不创建 FileObject 或正式资源。
- ai-service 不校验租户额度。
- ai-service 不持久化图片。
