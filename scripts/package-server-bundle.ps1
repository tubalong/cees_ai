<#
.SYNOPSIS
Creates the minimal CEES AI server deployment directory and a Linux-friendly tar.gz archive.

.DESCRIPTION
The archive contains only the runtime deployment unit required on the application server:
Compose files, deployment scripts, one environment file, one AI model configuration, a deployment
runbook, and a bundle manifest. Application source code, Dockerfiles, Git metadata, node_modules,
and COS credentials are not included.

By default, the script automatically uses .env.<environment> and an existing
models.<environment>.toml when available, and falls back to the matching example files only when
the real files are absent. -EnvironmentFile and -ModelConfigFile override automatic selection.
A bundle containing real runtime configuration contains secrets and must be transferred securely.

.PARAMETER Environment
Target environment: staging, production, or prod.

.PARAMETER EnvironmentFile
Optional .env file override. Relative paths are resolved from the repository root. When omitted,
the script uses .env.<environment> if it exists, otherwise the matching example file.

.PARAMETER ModelConfigFile
Optional models.*.toml override. Relative paths are resolved from the repository root. When omitted,
the script searches the standard runtime locations before falling back to the matching example file.

.PARAMETER OutputDirectory
Archive output directory. Defaults to dist/server-bundles.

.PARAMETER KeepExpandedDirectory
Keeps a copy of the generated server directory next to the tar.gz archive.

.EXAMPLE
pwsh ./scripts/package-server-bundle.ps1 -Environment staging

.EXAMPLE
pwsh ./scripts/package-server-bundle.ps1 `
  -Environment staging `
  -EnvironmentFile .env.staging `
  -ModelConfigFile apps/ai-service/config/models.staging.toml

.EXAMPLE
pwsh ./scripts/package-server-bundle.ps1 `
  -Environment production `
  -EnvironmentFile .env.production `
  -ModelConfigFile apps/ai-service/config/models.production.toml
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateSet('staging', 'production', 'prod')]
    [string]$Environment,

    [string]$EnvironmentFile,

    [string]$ModelConfigFile,

    [string]$OutputDirectory,

    [switch]$KeepExpandedDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Command {
    param([Parameter(Mandatory)][string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command is unavailable: $Name"
    }
}

function Invoke-CapturedCommand {
    param(
        [Parameter(Mandatory)][string]$Command,
        [Parameter()][string[]]$Arguments = @()
    )

    $output = & $Command @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        $message = ($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
        throw "Command failed with exit code ${exitCode}: $Command $($Arguments -join ' ')$([Environment]::NewLine)$message"
    }

    return (($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine).Trim()
}

function Resolve-InputFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$Description
    )

    $candidate = $Path
    if (-not [System.IO.Path]::IsPathRooted($candidate)) {
        $candidate = Join-Path $RepositoryRoot $candidate
    }
    $candidate = [System.IO.Path]::GetFullPath($candidate)

    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "$Description does not exist: $candidate"
    }

    return $candidate
}

function Write-Utf8Lf {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Content
    )

    $normalized = $Content.Replace("`r`n", "`n").Replace("`r", "`n")
    [System.IO.File]::WriteAllText($Path, $normalized, [System.Text.UTF8Encoding]::new($false))
}

function Copy-NormalizedTextFile {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$Destination
    )

    Write-Utf8Lf -Path $Destination -Content ([System.IO.File]::ReadAllText($Source))
}

function Set-EnvironmentValue {
    param(
        [Parameter(Mandatory)][string]$Content,
        [Parameter(Mandatory)][string]$Key,
        [Parameter(Mandatory)][string]$Value
    )

    $lines = @($Content.Replace("`r`n", "`n").Replace("`r", "`n") -split "`n")
    $result = [System.Collections.Generic.List[string]]::new()
    $found = $false

    foreach ($line in $lines) {
        if ($line -match "^$([regex]::Escape($Key))=") {
            if (-not $found) {
                $result.Add("$Key=$Value")
                $found = $true
            }
            continue
        }
        $result.Add($line)
    }

    if (-not $found) {
        $result.Add("$Key=$Value")
    }

    return (($result -join "`n").TrimEnd("`n") + "`n")
}

function Test-ContainsPlaceholder {
    param([Parameter(Mandatory)][string]$Path)

    return [System.IO.File]::ReadAllText($Path).Contains('change_me')
}

function Get-ManifestSourceLabel {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$RepositoryRoot
    )

    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    $resolvedRoot = [System.IO.Path]::GetFullPath($RepositoryRoot).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    ) + [System.IO.Path]::DirectorySeparatorChar

    if ($resolvedPath.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        return [System.IO.Path]::GetRelativePath($RepositoryRoot, $resolvedPath).Replace('\', '/')
    }

    return '<external>/' + [System.IO.Path]::GetFileName($resolvedPath)
}

function Assert-SafeCleanupPath {
    param(
        [Parameter(Mandatory)][string]$Target,
        [Parameter(Mandatory)][string]$Parent
    )

    $resolvedTarget = [System.IO.Path]::GetFullPath($Target)
    $resolvedParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    ) + [System.IO.Path]::DirectorySeparatorChar

    if (-not $resolvedTarget.StartsWith($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean path outside output directory: $resolvedTarget"
    }
    if (-not ([System.IO.Path]::GetFileName($resolvedTarget)).StartsWith('.work-', [System.StringComparison]::Ordinal)) {
        throw "Refusing to clean unexpected work directory: $resolvedTarget"
    }
}

$scriptDirectory = Split-Path -Parent $PSCommandPath
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDirectory '..'))

if ($Environment -eq 'prod') {
    $Environment = 'production'
}

if ($Environment -eq 'staging') {
    $environmentFileName = '.env.staging'
    $environmentRuntimePath = '.env.staging'
    $environmentExamplePath = '.env.staging.example'
    $modelFileName = 'models.staging.toml'
    $modelRuntimeCandidates = @(
        'apps/ai-service/config/models.staging.toml',
        'config/models.staging.toml',
        'models.staging.toml'
    )
    $modelExamplePath = 'apps/ai-service/config/models.staging.example.toml'
    $composeOverrideName = 'docker-compose.staging.yml'
    $deployArgument = 'staging'
    $cosChannel = 'staging'
}
else {
    $environmentFileName = '.env.production'
    $environmentRuntimePath = '.env.production'
    $environmentExamplePath = '.env.production.example'
    $modelFileName = 'models.production.toml'
    $modelRuntimeCandidates = @(
        'apps/ai-service/config/models.production.toml',
        'config/models.production.toml',
        'models.production.toml'
    )
    $modelExamplePath = 'apps/ai-service/config/models.production.example.toml'
    $composeOverrideName = 'docker-compose.prod.yml'
    $deployArgument = 'production'
    $cosChannel = 'prod'
}

$environmentFileExplicit = $PSBoundParameters.ContainsKey('EnvironmentFile')
$modelConfigFileExplicit = $PSBoundParameters.ContainsKey('ModelConfigFile')

if ($environmentFileExplicit) {
    $environmentSource = 'explicit'
}
elseif (Test-Path -LiteralPath (Join-Path $repositoryRoot $environmentRuntimePath) -PathType Leaf) {
    $EnvironmentFile = $environmentRuntimePath
    $environmentSource = 'local-runtime'
}
else {
    $EnvironmentFile = $environmentExamplePath
    $environmentSource = 'example'
}

if ($modelConfigFileExplicit) {
    $modelConfigSource = 'explicit'
}
else {
    $ModelConfigFile = $null
    foreach ($candidate in $modelRuntimeCandidates) {
        if (Test-Path -LiteralPath (Join-Path $repositoryRoot $candidate) -PathType Leaf) {
            $ModelConfigFile = $candidate
            break
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($ModelConfigFile)) {
        $modelConfigSource = 'local-runtime'
    }
    else {
        $ModelConfigFile = $modelExamplePath
        $modelConfigSource = 'example'
    }
}

$includesRuntimeConfiguration = $environmentSource -ne 'example' -or $modelConfigSource -ne 'example'
$resolvedEnvironmentFile = Resolve-InputFile -Path $EnvironmentFile -RepositoryRoot $repositoryRoot -Description 'Environment file'
$resolvedModelConfigFile = Resolve-InputFile -Path $ModelConfigFile -RepositoryRoot $repositoryRoot -Description 'Model configuration file'
$environmentSourceLabel = Get-ManifestSourceLabel -Path $resolvedEnvironmentFile -RepositoryRoot $repositoryRoot
$modelConfigSourceLabel = Get-ManifestSourceLabel -Path $resolvedModelConfigFile -RepositoryRoot $repositoryRoot

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repositoryRoot 'dist/server-bundles'
}
elseif (-not [System.IO.Path]::IsPathRooted($OutputDirectory)) {
    $OutputDirectory = Join-Path $repositoryRoot $OutputDirectory
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)

Assert-Command -Name 'git'
Assert-Command -Name 'tar'

$gitCommit = Invoke-CapturedCommand -Command 'git' -Arguments @('-C', $repositoryRoot, 'rev-parse', 'HEAD')
$shortCommit = Invoke-CapturedCommand -Command 'git' -Arguments @('-C', $repositoryRoot, 'rev-parse', '--short=12', 'HEAD')
$gitStatus = Invoke-CapturedCommand -Command 'git' -Arguments @('-C', $repositoryRoot, 'status', '--porcelain', '--untracked-files=normal')
$isDirty = -not [string]::IsNullOrWhiteSpace($gitStatus)
$createdAt = [DateTimeOffset]::Now
$createdAtLocal = $createdAt.ToString('o')
$createdAtUtc = $createdAt.UtcDateTime.ToString('o')
$timeZoneId = [TimeZoneInfo]::Local.Id
$timestamp = $createdAt.ToString('yyyyMMddTHHmmss')

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$workRoot = Join-Path $OutputDirectory ('.work-' + [Guid]::NewGuid().ToString('N'))
$bundleRoot = Join-Path $workRoot $Environment
$infraDirectory = Join-Path $bundleRoot 'infra'
$configDirectory = Join-Path $bundleRoot 'config'

try {
    New-Item -ItemType Directory -Path $infraDirectory, $configDirectory -Force | Out-Null

    $runtimeFiles = @(
        @{ Source = 'infra/deploy-cos-release.sh'; Destination = 'infra/deploy-cos-release.sh' },
        @{ Source = 'infra/manage-app.sh'; Destination = 'infra/manage-app.sh' },
        @{ Source = 'infra/docker-compose.deploy.yml'; Destination = 'infra/docker-compose.deploy.yml' },
        @{ Source = "infra/$composeOverrideName"; Destination = "infra/$composeOverrideName" }
    )

    foreach ($file in $runtimeFiles) {
        $source = Resolve-InputFile -Path $file.Source -RepositoryRoot $repositoryRoot -Description 'Runtime deployment file'
        $destination = Join-Path $bundleRoot $file.Destination
        Copy-NormalizedTextFile -Source $source -Destination $destination
    }

    $runtimeModelPath = "../config/$modelFileName"
    $environmentContent = [System.IO.File]::ReadAllText($resolvedEnvironmentFile)
    $environmentContent = Set-EnvironmentValue -Content $environmentContent -Key 'AI_MODEL_CONFIG_HOST_PATH' -Value $runtimeModelPath
    Write-Utf8Lf -Path (Join-Path $bundleRoot $environmentFileName) -Content $environmentContent
    Copy-NormalizedTextFile -Source $resolvedModelConfigFile -Destination (Join-Path $configDirectory $modelFileName)

    $containsPlaceholders = (Test-ContainsPlaceholder -Path (Join-Path $bundleRoot $environmentFileName)) -or
        (Test-ContainsPlaceholder -Path (Join-Path $configDirectory $modelFileName))
    $bundleMode = if ($containsPlaceholders) { 'template' } else { 'ready' }

    $docsAccess = if ($Environment -eq 'staging') {
        @"
## Staging AI 文档

ai-service 默认映射到宿主机 8000 端口：

    http://<应用服务器地址>:8000/docs

可通过 $environmentFileName 中的 AI_SERVICE_PORT 修改。对外开放时必须限制来源 IP。
"@
    }
    else {
        'Production 不映射 ai-service 宿主机端口。'
    }

    $deployReadme = @"
# CEES AI $Environment 服务器部署包

生成时间：$createdAtLocal（$timeZoneId）
Git Commit：$gitCommit
配置状态：$bundleMode

## 目录用途

此目录包含应用服务器运行所需的最小部署单元，不包含应用源码、Dockerfile、Git 仓库或 COSCLI 凭据。

## 首次部署

### 1. 检查运行配置

检查并填写 $environmentFileName 与 config/$modelFileName，确保不再包含 change_me：

    grep -R "change_me" $environmentFileName config/$modelFileName

### 2. 安装 COSCLI（Linux AMD64）

    curl -fL https://cosbrowser.cloud.tencent.com/software/coscli/coscli-linux-amd64 -o /tmp/coscli
    install -m 0755 /tmp/coscli /usr/local/bin/coscli
    coscli --version

### 3. 配置 COSCLI

    coscli config init --disable-log
    chmod 600 "$HOME/.cos.yaml"

Bucket Name 填 cees-ai-1403013862，Endpoint 填 cos.ap-chengdu.myqcloud.com，Alias 填 cees-release。

### 4. 部署

    bash infra/deploy-cos-release.sh $deployArgument latest

$docsAccess

## 指定发布版本

bash infra/deploy-cos-release.sh $deployArgument <release-id>

Production 必须使用已经在 Staging 验证通过的明确 release-id，不应直接部署 latest。

## 常用运维

bash infra/manage-app.sh $deployArgument validate
bash infra/manage-app.sh $deployArgument ps
bash infra/manage-app.sh $deployArgument logs

详细说明见仓库 infra/README.md。
"@
    Write-Utf8Lf -Path (Join-Path $bundleRoot 'DEPLOY.md') -Content $deployReadme

    $fileEntries = @()
    foreach ($file in Get-ChildItem -LiteralPath $bundleRoot -Recurse -File | Sort-Object FullName) {
        $relativePath = [System.IO.Path]::GetRelativePath($bundleRoot, $file.FullName).Replace('\', '/')
        $fileEntries += [ordered]@{
            path = $relativePath
            sizeBytes = [long]$file.Length
            sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }

    $manifest = [ordered]@{
        schemaVersion = 1
        project = 'cees-ai'
        environment = $Environment
        cosChannel = $cosChannel
        createdAtLocal = $createdAtLocal
        createdAtUtc = $createdAtUtc
        timeZone = $timeZoneId
        git = [ordered]@{
            commit = $gitCommit
            shortCommit = $shortCommit
            dirty = $isDirty
        }
        configuration = [ordered]@{
            mode = $bundleMode
            environmentSource = $environmentSource
            modelConfigSource = $modelConfigSource
            environmentSourcePath = $environmentSourceLabel
            modelConfigSourcePath = $modelConfigSourceLabel
            containsRuntimeConfiguration = $includesRuntimeConfiguration
            containsPlaceholders = $containsPlaceholders
        }
        files = $fileEntries
    }
    Write-Utf8Lf -Path (Join-Path $bundleRoot 'bundle-manifest.json') -Content (($manifest | ConvertTo-Json -Depth 8) + "`n")

    $archiveName = "cees-ai-$Environment-server-$timestamp-$shortCommit.tar.gz"
    $archivePath = Join-Path $OutputDirectory $archiveName
    if (Test-Path -LiteralPath $archivePath) {
        throw "Archive already exists: $archivePath"
    }

    Push-Location $workRoot
    try {
        & tar -czf $archivePath $Environment
        if ($LASTEXITCODE -ne 0) {
            throw "tar failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }

    $archiveListing = (Invoke-CapturedCommand -Command 'tar' -Arguments @('-tzf', $archivePath)).Replace("`r`n", "`n").Replace("`r", "`n")
    foreach ($requiredPath in @(
        "$Environment/$environmentFileName",
        "$Environment/config/$modelFileName",
        "$Environment/infra/deploy-cos-release.sh",
        "$Environment/infra/manage-app.sh",
        "$Environment/infra/docker-compose.deploy.yml",
        "$Environment/infra/$composeOverrideName",
        "$Environment/DEPLOY.md",
        "$Environment/bundle-manifest.json"
    )) {
        if ($archiveListing -notmatch "(?m)^$([regex]::Escape($requiredPath))$") {
            throw "Archive verification failed; missing: $requiredPath"
        }
    }

    $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $checksumPath = "$archivePath.sha256"
    Write-Utf8Lf -Path $checksumPath -Content "$archiveHash  $archiveName`n"

    $expandedPath = $null
    if ($KeepExpandedDirectory) {
        $expandedPath = Join-Path $OutputDirectory "$Environment-$timestamp-$shortCommit"
        if (Test-Path -LiteralPath $expandedPath) {
            throw "Expanded output already exists: $expandedPath"
        }
        Copy-Item -LiteralPath $bundleRoot -Destination $expandedPath -Recurse
    }

    Write-Host ''
    Write-Host 'CEES AI server bundle created.' -ForegroundColor Green
    Write-Host "  Environment : $Environment"
    Write-Host "  Mode        : $bundleMode"
    Write-Host "  Env source  : $environmentSource ($resolvedEnvironmentFile)"
    Write-Host "  Model source: $modelConfigSource ($resolvedModelConfigFile)"
    Write-Host "  Git commit  : $gitCommit"
    Write-Host "  Archive     : $archivePath"
    Write-Host "  SHA-256     : $archiveHash"
    Write-Host "  Checksum    : $checksumPath"
    if ($null -ne $expandedPath) {
        Write-Host "  Directory   : $expandedPath"
    }

    if ($containsPlaceholders) {
        Write-Warning "The bundle contains change_me placeholders. Edit $environmentFileName and config/$modelFileName after extraction before deploying."
    }
    if ($includesRuntimeConfiguration) {
        Write-Warning 'The bundle contains local runtime configuration and may contain secrets. Transfer it securely and delete unnecessary local/server copies.'
    }
}
finally {
    if (Test-Path -LiteralPath $workRoot) {
        Assert-SafeCleanupPath -Target $workRoot -Parent $OutputDirectory
        Remove-Item -LiteralPath $workRoot -Recurse -Force
    }
}
