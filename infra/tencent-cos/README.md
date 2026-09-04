# 腾讯云 COS 配置

CEES AI 使用腾讯云 COS 存储知识库原文件、导出文件及其他二进制对象。Bucket 默认保持私有，不向客户端或 AI 服务分发长期密钥。

上传会话、文件类型、租户权限、状态和额度的完整设计见 [文件上传设计草案](../../docs/architecture/file-upload.md)。本文只维护腾讯云资源与部署配置。

## 生产环境变量

```text
TENCENT_COS_SECRET_ID=change_me
TENCENT_COS_SECRET_KEY=change_me
TENCENT_COS_REGION=ap-chengdu
TENCENT_COS_BUCKET=cees-ai-1403013862
TENCENT_COS_OBJECT_PREFIX=cees/prod
TENCENT_COS_SIGNED_URL_TTL_SECONDS=600
```

- Bucket 名称通常为 `<bucket-name>-<appid>`。
- 本地值来自仓库根 `.env`；生产值必须来自平台 Secrets。
- `SecretId`/`SecretKey` 必须属于专用 CAM 子账号或角色，不得使用腾讯云主账号密钥。
- 只把 COS 凭据注入 `apps/api`。桌面端、移动端和 AI 服务仅使用 NestJS 下发的限时签名 URL 或受控文件内容。

## 权限

- [cam-policy.prod.example.json](cam-policy.prod.example.json) 是生产策略模板，只允许访问 `cees/prod/*`。
- [cam-policy.nonprod.example.json](cam-policy.nonprod.example.json) 是开发/测试策略模板，只允许访问 `cees/test/*`。

两份策略的操作集合有意保持一致，因为生产与非生产应用都需要相同的上传、下载、删除和分片操作；真正的隔离点是 `resource` 中互不重叠的对象前缀。两份策略必须绑定不同 CAM 凭据，不能为了减少文件数量而合并授权范围。使用时仍应根据实际功能继续收窄操作集合。

业务对象键建议采用以下结构：

```text
cees/{test|prod}/tenants/{tenantId}/files/{fileId}/source
```

对象键中的租户信息只用于组织和审计，不能替代 API 的租户授权校验。

## 环境隔离

- development 与 test 使用 `cees/test` 对象前缀。
- production 使用 `cees/prod` 对象前缀。
- 非生产和生产必须使用不同 CAM 凭据，并分别限制到对应前缀；不能只依赖应用代码拼接路径。
- 自动化测试应在 `cees/test/runs/{testRunId}` 下创建对象，避免清理时影响开发文件。
- 同一 Bucket 的 CORS、版本控制等 Bucket 级配置由两套环境共享；生命周期规则应按对象前缀区分。

## 安全建议

- 默认启用私有读写，不配置公共读 Bucket。
- 下载 URL 设置短有效期；默认示例为 600 秒。
- 客户端直传应由 API 申请 STS 临时凭证，并限制对象前缀、操作和有效期。
- 根据数据等级配置服务端加密、版本控制、生命周期与日志投递。
- COS 操作应记录租户、操作者、对象键、请求 ID 与结果，不记录密钥或完整签名 URL。
