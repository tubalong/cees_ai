# 腾讯云 COS 配置

CEES AI 使用腾讯云 COS 存储用户上传原文件、导出文件及其他二进制对象。Bucket 默认保持私有，不向客户端或 ai-service 分发长期密钥。

上传会话、文件类型、租户权限、状态和额度的设计见 [文件上传设计草案](../../docs/architecture/file-upload.md)。

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
```

- Bucket 名称通常为 `<bucket-name>-<appid>`。
- SecretId/SecretKey 必须属于专用 CAM 子账号或角色，不得使用腾讯云主账号密钥。
- COS 长期凭据只注入 NestJS API；桌面端、移动端和 ai-service 只使用限时签名 URL 或受控内容。

业务对象键建议采用：

```text
cees/{local|staging|prod}/tenants/{tenantId}/files/{fileId}/source
```

对象键中的租户信息只用于组织和审计，不能替代 API 的租户授权校验。

## 安全建议

- 默认启用私有读写，不配置公共读 Bucket。
- 下载 URL 使用短有效期，示例默认为 600 秒。
- 客户端直传由 API 申请 STS 临时凭证，并限制对象前缀、操作和有效期。
- 根据数据等级配置服务端加密、版本控制、生命周期与日志投递。
- COS 操作记录租户、操作者、对象键、请求 ID 和结果，不记录密钥或完整签名 URL。
