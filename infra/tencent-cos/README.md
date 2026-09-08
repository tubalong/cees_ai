# 腾讯云 COS 配置

CEES AI 使用腾讯云 COS 存储用户上传原文件、导出文件及其他二进制对象。Bucket 默认保持私有，不向客户端或 ai-service 分发长期密钥。

基础上传会话已经落地；已实现范围和后续权限、额度、分片及扫描设计见 [文件上传与 COS 设计](../../docs/architecture/file-upload.md)。

## 三环境前缀

| 环境 | 对象前缀 | 策略模板 |
| --- | --- | --- |
| 本地开发 | `cees/local` | `cam-policy.local.example.json` |
| Staging | `cees/staging` | `cam-policy.staging.example.json` |
| Production | `cees/prod` | `cam-policy.prod.example.json` |

三套环境必须使用不同 CAM 凭据，每个凭据只允许访问自己的对象前缀。不能用应用代码中的路径拼接代替 CAM 权限隔离。

## 环境变量

```text
TENCENT_COS_SECRET_ID=change_me
TENCENT_COS_SECRET_KEY=change_me
TENCENT_COS_REGION=ap-chengdu
TENCENT_COS_BUCKET=cees-ai-1403013862
TENCENT_COS_OBJECT_PREFIX=cees/local|cees/staging|cees/prod
TENCENT_COS_SIGNED_URL_TTL_SECONDS=600
TENCENT_COS_UPLOAD_MAX_BYTES=104857600
```

- Bucket 名称通常为 `<bucket-name>-<appid>`。
- SecretId/SecretKey 必须属于专用 CAM 子账号或角色，不得使用腾讯云主账号密钥。
- COS 长期凭据只注入 NestJS API；桌面端、移动端和 ai-service 只使用限时签名 URL 或受控内容。
- `TENCENT_COS_UPLOAD_MAX_BYTES` 是当前环境的单文件技术上限，默认 100 MiB，不能超过代码硬上限 500 MiB。

业务对象键建议采用：

```text
cees/{local|staging|prod}/tenants/{tenantId}/files/{yyyy}/{mm}/{fileId}/source
```

对象键中的租户信息只用于组织和审计，不能替代 API 的租户授权校验。

## 安全建议

- 默认启用私有读写，不配置公共读 Bucket。
- 下载 URL 使用短有效期，示例默认为 600 秒。
- 当前基础上传由 API 签发只绑定单一对象键、PUT 方法和 Content-Type 的短时 URL；分片上传以后再使用受限 STS 临时凭证或分片签名。
- 根据数据等级配置服务端加密、版本控制、生命周期与日志投递。
- COS 操作记录租户、操作者、对象键、请求 ID 和结果，不记录密钥或完整签名 URL。

## 客户端直传 CORS

桌面端 Electron 渲染进程或未来 Web 客户端直接 PUT 到 COS 时，需要在 Bucket 配置 CORS：

- Staging 只允许测试客户端实际使用的 Origin；
- Production 只允许正式客户端实际使用的 Origin，不使用 `*`；
- Method 至少允许 `PUT`；
- Allowed-Headers 至少包含 `Content-Type`；
- Expose-Headers 建议包含 `ETag` 和 `x-cos-request-id`；
- 缓存时间应短于凭据或签名策略的变更窗口。

Flutter 原生请求不依赖浏览器 CORS，但仍使用相同的预签名 URL、对象键和完成校验流程。
