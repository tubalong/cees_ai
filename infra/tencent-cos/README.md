# 腾讯云 COS 配置参考

本文档只说明 COS 权限、COSCLI 和对象布局。完整的本地发布、服务器目录打包、上传解压和部署顺序见 [CEES AI 部署手册](../README.md)。

## 1. Bucket 与对象前缀

当前配置：

```text
Region: ap-chengdu
Bucket: cees-ai-1403013862
```

业务对象与应用发布包必须使用不同前缀：

| 用途 | 前缀 | 凭据 |
| --- | --- | --- |
| 本地业务文件 | `cees/local/*` | 本地 API 专用凭据 |
| Staging 业务文件 | `cees/staging/*` | Staging API 专用凭据 |
| Production 业务文件 | `cees/production/*` | Production API 专用凭据 |
| Staging 镜像发布 | `releases/staging/*` | 发布子用户 |
| Production 镜像发布 | `releases/production/*` | 发布子用户 |

业务 API 的三个环境必须使用不同 CAM 凭据。发布子用户可以同时访问 `releases/staging` 和 `releases/production`，但不得访问 `cees/*` 业务对象。

业务 API 使用 [通用 CAM 策略模板](cam-policy.example.json)。为每个环境分别复制一份，将资源中的 `<environment>` 替换为 `local`、`staging` 或 `production`；不能把三个环境前缀同时放入同一份实际策略。

## 2. 发布子用户权限

发布子用户建议命名为：

```text
cees-release-bot
```

只启用编程访问，不启用控制台登录，不加入具有 COS 全权限的用户组。将 [cam-policy.release.example.json](cam-policy.release.example.json) 创建为自定义 CAM 策略并关联给该子用户。

策略只允许：

- Bucket 探测；
- 对 `releases/staging/*` 和 `releases/production/*` 进行受限列举；
- 上传、下载和 HEAD 对象；
- 分块上传、查询分块、完成和取消分块上传。

策略不允许：

- 访问 `cees/local`、`cees/staging`、`cees/production`；
- 删除完整发布对象；
- 修改 Bucket、ACL、CORS、生命周期或其他配置。

`condition.cos:prefix` 中的 `/` 使用 URL 编码，因此下面是正确写法：

```json
{
  "condition": {
    "string_like": {
      "cos:prefix": [
        "releases%2Fstaging%2F*",
        "releases%2Fproduction%2F*"
      ]
    }
  }
}
```

注意：实际 JSON 中是 `string_like` 和 `*`，不能写成 `string\_like` 或 `\*`。`resource` 中仍使用普通 `/`。

## 3. 开发电脑配置 COSCLI

Windows 使用独立配置文件：

```powershell
New-Item -ItemType Directory -Force "$HOME/.config/cees" | Out-Null
New-Item -ItemType File -Force "$HOME/.config/cees/cos-release.yaml" | Out-Null
coscli config init --disable-log
```

COSCLI `v1.0.8` 的交互配置中填写：

```text
配置文件路径：C:\Users\<用户名>\.config\cees\cos-release.yaml
Mode：直接回车
Secret ID：发布子用户 SecretId
Secret Key：发布子用户 SecretKey
Session Token：直接回车
DisableEncryption：直接回车，使用 false
DisableAutoFetchBucketType：直接回车，使用 false
CloseAutoSwitchHost：直接回车，使用 false
Bucket Name：cees-ai-1403013862
Bucket Endpoint：cos.ap-chengdu.myqcloud.com
Bucket Alias：cees-release
```

不要把配置文件提交到 Git，也不要复制或截图 `coscli config show` 输出，因为当前版本可能显示完整 SecretId/SecretKey。

## 4. 本地发布镜像包

发布脚本：

```text
scripts/publish-cos-release.ps1
```

Staging：

```powershell
pwsh ./scripts/publish-cos-release.ps1 `
  -Environment staging `
  -UseChinaImageMirror `
  -CosAlias cees-release `
  -CosConfigPath "$HOME/.config/cees/cos-release.yaml"
```

存在未提交修改时，只有 Staging 可以显式增加：

```powershell
-AllowDirty
```

Production 必须是干净工作区：

```powershell
pwsh ./scripts/publish-cos-release.ps1 `
  -Environment production `
  -ReleaseId <staging-release-id> `
  -UseChinaImageMirror `
  -CosAlias cees-release `
  -CosConfigPath "$HOME/.config/cees/cos-release.yaml"
```

`-UseChinaImageMirror` 只替换基础镜像来源，不配置 HTTP proxy，也不修改 `pnpm-lock.yaml` 或 `uv.lock`。

默认 `release-id` 中的时间使用发布电脑操作系统的当前时区，格式为 `yyyyMMddTHHmmss`，不带 UTC `Z` 后缀；manifest 仍同时记录本地时间、UTC 时间和系统时区 ID。

## 5. 发布对象结构

```text
releases/{staging|production}/
├── latest.json
└── <release-id>/
    ├── cees-images-<environment>-<release-id>-<platform>.tar.gz
    ├── SHA256SUMS
    ├── release.env
    └── manifest.json
```

上传顺序：

1. 镜像压缩包；
2. `SHA256SUMS`；
3. `release.env`；
4. `manifest.json`，作为完整发布标记；
5. `latest.json`，最后更新。

不可变发布文件使用 COSCLI `--forbid-overwrite`。`latest.json` 是可变指针；Production 部署仍应使用明确 `release-id`。

## 6. 应用服务器配置 COSCLI

Linux AMD64 安装：

```bash
curl -fL \
  https://cosbrowser.cloud.tencent.com/software/coscli/coscli-linux-amd64 \
  -o /tmp/coscli
install -m 0755 /tmp/coscli /usr/local/bin/coscli
coscli --version
```

在服务器当前部署用户下重新初始化，不依赖 Windows 上生成的配置文件：

```bash
coscli config init --disable-log
chmod 600 "$HOME/.cos.yaml"
```

配置相同的 Bucket、Endpoint 和别名 `cees-release`。服务器部署命令和完整前置检查见 [部署手册](../README.md#4-第一次部署-staging)。

## 7. 业务 API 的 COS 配置

业务运行环境变量：

```text
TENCENT_COS_SECRET_ID=change_me
TENCENT_COS_SECRET_KEY=change_me
TENCENT_COS_REGION=ap-chengdu
TENCENT_COS_BUCKET=cees-ai-1403013862
TENCENT_COS_OBJECT_PREFIX=cees/local|cees/staging|cees/production
TENCENT_COS_SIGNED_URL_TTL_SECONDS=600
TENCENT_COS_UPLOAD_MAX_BYTES=104857600
```

- SecretId/SecretKey 必须属于专用 CAM 子用户或角色，不使用主账号密钥。
- COS 长期凭据只注入 NestJS API；桌面端、移动端和 ai-service 不持有长期密钥。
- `TENCENT_COS_UPLOAD_MAX_BYTES` 默认 100 MiB，不能超过代码硬上限 500 MiB。
- 发布子用户凭据不得作为业务 API 的 `TENCENT_COS_SECRET_*`。

业务对象键建议：

```text
cees/{local|staging|production}/tenants/{tenantId}/files/{yyyy}/{mm}/{fileId}/source
```

对象键中的租户信息只用于组织和审计，不能替代 API 的租户授权校验。

## 8. 客户端直传 CORS

桌面端 Electron 渲染进程或未来 Web 客户端直接 PUT 到 COS 时：

- Staging 只允许测试客户端实际 Origin；
- Production 只允许正式客户端实际 Origin，不使用 `*`；
- Method 至少允许 `PUT`；
- Allowed-Headers 至少包含 `Content-Type`；
- Expose-Headers 建议包含 `ETag` 和 `x-cos-request-id`；
- 缓存时间应短于签名或权限策略变更窗口。

Flutter 原生请求不依赖浏览器 CORS，但仍使用相同的预签名 URL、对象键和完成校验流程。

## 9. 安全要求

- Bucket 默认私有读写，不配置公共读。
- 下载 URL 使用短有效期。
- 根据数据等级配置服务端加密、版本控制、生命周期和日志投递。
- COS 操作日志记录请求 ID 和结果，不记录 Secret 或完整签名 URL。
- 服务器 COSCLI 配置、真实 `.env` 和真实模型配置权限设为 `600`。
