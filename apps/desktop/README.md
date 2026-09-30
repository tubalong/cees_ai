# apps/desktop — Electron 桌面端

Electron 壳 + React（Vite）渲染层，复用 `packages/ui-kit` 与 `packages/api-client`。

## 目录说明

```text
electron/  # 主进程、preload、桌面能力（文件、通知、深链、自动更新）
src/       # React 渲染层
```

## 开发与构建

Electron 主进程、preload、Vite 渲染入口与 TypeScript 配置已经落地。preload 仅通过 `window.cees` 暴露平台和 Electron 版本信息；业务数据继续通过版本化 API 获取。

开发启动：

```text
cd apps/desktop
npm run dev
```

也可以从仓库根目录执行：

```text
pnpm --filter @cees/desktop dev
```

类型检查与生产构建：

```text
pnpm --filter @cees/desktop build
```

## Windows 正式包

在 Windows 上运行以下命令，依次生成图标、构建桌面端并打包 NSIS 安装器及 ZIP：

```text
pnpm --filter @cees/desktop dist:win
```

图标以 `public/assests/logo.webp` 为源文件，生成的 ICO 用于应用程序及安装器，PNG 用于系统托盘。托盘右键提供打开 CEES、新对话、退出 CEES；关闭窗口会隐藏到托盘，退出菜单才会结束进程。安装包输出到 `release/`。

## Windows 自动更新发布

桌面端通过 `electron-updater` 从 `https://cdn.cees.top/desktop/` 检查更新。Windows 自动更新使用 NSIS 安装器，ZIP 只用于免安装分发，不能只上传 ZIP 来做自动更新。

每次发布必须先递增 `apps/desktop/package.json` 的 `version`，再在 Windows 执行：

```powershell
pnpm --filter @cees/desktop dist:win
pwsh ./scripts/publish-desktop-release.ps1 `
	-CosAlias cees-release `
	-CosConfigPath "$HOME/.config/cees/cos-release.yaml" `
	-SkipBuild
```

发布脚本会上传以下文件到 `https://cdn.cees.top/desktop/`：

- `latest.yml`：必须禁止 CDN 长缓存；
- `CEES-AI-<version>-x64.exe`：签名 NSIS 安装器；
- `CEES-AI-<version>-x64.exe.blockmap`：增量更新差分文件。

发布前确认安装器签名和 CDN 文件可访问：

```powershell
Get-AuthenticodeSignature 'apps/desktop/release/CEES-AI-<version>-x64.exe' | Format-List Status,SignerCertificate,TimeStamperCertificate
Invoke-WebRequest https://cdn.cees.top/desktop/latest.yml
```

已安装用户下次启动时会检查更新；发现新版本后选择下载，下载完成后选择立即重启即可完成更新，不需要卸载旧版本。生产环境必须使用 HTTPS、有效代码签名证书，并确保 `latest.yml` 中引用的安装器文件与 blockmap 已全部上传。

当前 Windows 签名配置使用 `CurrentUser\\My` 中指纹为 `7D2CDB58F3E8FEA8FA60A508E54F703CC591341E` 的代码签名证书。构建机器必须能访问证书的私钥和时间戳服务器；只有 CA 根证书无法签名。如改用 PFX/P12 文件，请在构建环境设置 `CSC_LINK` 和 `CSC_KEY_PASSWORD`，不要把证书或密码提交到仓库，并相应调整证书指纹配置。构建后在 Windows PowerShell 验证安装器签名：

```powershell
Get-AuthenticodeSignature 'apps/desktop/release/CEES-AI-0.1.2-x64.exe' | Format-List Status,SignerCertificate,TimeStamperCertificate
```

发布前还需在真实 Windows 桌面安装并检查安装器、快捷方式、托盘图标和三个菜单动作。`release/` 中现存的同名安装包可能是旧构建产物，必须以本次构建成功及签名验证结果为准。
