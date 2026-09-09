<#
.SYNOPSIS
Creates a self-contained CEES AI database-server deployment bundle.

.DESCRIPTION
The archive contains the PostgreSQL/Redis Compose files, deployment and management
scripts, one environment file, a deployment runbook, and a bundle manifest. It does
not contain application source code or Git metadata.

Docker images are not downloaded or included by default. Use -IncludeImages to pull
only missing database images into the local Docker daemon and save the required image
references to images/database-images.tar inside the bundle.

By default, the script uses infra/database/.env.<environment> when it exists and falls
back to the corresponding example file. A bundle containing a real environment file
contains secrets and must be transferred securely.

.PARAMETER Environment
Target environment: staging, production, or prod.

.PARAMETER EnvironmentFile
Optional environment-file override. Relative paths are resolved from the repository root.

.PARAMETER IncludeImages
Pulls any missing database images locally and includes an offline Docker image archive.
The default bundle does not invoke Docker and does not contain images.

.PARAMETER OutputDirectory
Archive output directory. Defaults to dist/database-bundles.

.PARAMETER KeepExpandedDirectory
Keeps a copy of the generated cees-db directory next to the tar.gz archive.

.EXAMPLE
pwsh ./scripts/package-database-bundle.ps1 -Environment staging

.EXAMPLE
pwsh ./scripts/package-database-bundle.ps1 -Environment production -IncludeImages
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateSet('staging', 'production', 'prod')]
    [string]$Environment,

    [string]$EnvironmentFile,

    [switch]$IncludeImages,

    [string]$OutputDirectory,

    [switch]$KeepExpandedDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

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

function Test-ContainsPlaceholder {
    param([Parameter(Mandatory)][string]$Path)

    return [System.IO.File]::ReadAllText($Path).Contains('change_me', [StringComparison]::Ordinal)
}

function Get-ManifestSourceLabel {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$RepositoryRoot
    )

    $relativePath = [System.IO.Path]::GetRelativePath($RepositoryRoot, $Path)
    if (-not $relativePath.StartsWith('..')) {
        return $relativePath.Replace('\', '/')
    }

    return $Path.Replace('\', '/')
}

function Get-ComposeImageReferences {
    param([Parameter(Mandatory)][string]$ComposePath)

    $images = [System.Collections.Generic.List[string]]::new()
    $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)

    foreach ($line in [System.IO.File]::ReadAllLines($ComposePath)) {
        if ($line -notmatch '^\s*image:\s*(.+?)\s*$') {
            continue
        }

        $value = ($Matches[1] -split '\s+#', 2)[0].Trim().Trim('"').Trim("'")
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }
        if ($value.Contains('$')) {
            throw "Image reference contains unresolved interpolation and cannot be packaged safely: $value"
        }
        if ($seen.Add($value)) {
            $images.Add($value)
        }
    }

    if ($images.Count -eq 0) {
        throw "No image references were found in $ComposePath"
    }

    return $images.ToArray()
}

function Test-DockerImageAvailable {
    param([Parameter(Mandatory)][string]$Image)

    & docker image inspect $Image *> $null
    return $LASTEXITCODE -eq 0
}

function Assert-SafeCleanupPath {
    param(
        [Parameter(Mandatory)][string]$Target,
        [Parameter(Mandatory)][string]$Parent
    )

    $resolvedTarget = [System.IO.Path]::GetFullPath($Target).TrimEnd('\', '/')
    $resolvedParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\', '/')
    $expectedPrefix = $resolvedParent + [System.IO.Path]::DirectorySeparatorChar

    if (-not $resolvedTarget.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean work directory outside output directory: $resolvedTarget"
    }
    if (-not ([System.IO.Path]::GetFileName($resolvedTarget)).StartsWith('.work-', [StringComparison]::Ordinal)) {
        throw "Refusing to clean unexpected work directory: $resolvedTarget"
    }
}

$scriptDirectory = Split-Path -Parent $PSCommandPath
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDirectory '..'))
$databaseSourceDirectory = Join-Path $repositoryRoot 'infra/database'

if ($Environment -eq 'prod') {
    $Environment = 'production'
}

$environmentFileName = ".env.$Environment"
$environmentRuntimePath = "infra/database/$environmentFileName"
$environmentExamplePath = "infra/database/$environmentFileName.example"
$environmentFileExplicit = $PSBoundParameters.ContainsKey('EnvironmentFile')

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

$resolvedEnvironmentFile = Resolve-InputFile -Path $EnvironmentFile -RepositoryRoot $repositoryRoot -Description 'Database environment file'
$environmentSourceLabel = Get-ManifestSourceLabel -Path $resolvedEnvironmentFile -RepositoryRoot $repositoryRoot
$includesRuntimeConfiguration = $environmentSource -ne 'example'

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repositoryRoot 'dist/database-bundles'
}
elseif (-not [System.IO.Path]::IsPathRooted($OutputDirectory)) {
    $OutputDirectory = Join-Path $repositoryRoot $OutputDirectory
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)

Assert-Command -Name 'git'
Assert-Command -Name 'tar'
if ($IncludeImages) {
    Assert-Command -Name 'docker'
}

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
$bundleRoot = Join-Path $workRoot 'cees-db'

try {
    New-Item -ItemType Directory -Path $bundleRoot -Force | Out-Null

    foreach ($fileName in @(
        'docker-compose.yml',
        'docker-compose.server.yml',
        'deploy-db.sh',
        'manage-db.sh'
    )) {
        $source = Resolve-InputFile -Path (Join-Path $databaseSourceDirectory $fileName) -RepositoryRoot $repositoryRoot -Description 'Database runtime file'
        Copy-NormalizedTextFile -Source $source -Destination (Join-Path $bundleRoot $fileName)
    }

    Copy-NormalizedTextFile -Source $resolvedEnvironmentFile -Destination (Join-Path $bundleRoot $environmentFileName)

    $containsPlaceholders = Test-ContainsPlaceholder -Path (Join-Path $bundleRoot $environmentFileName)
    $bundleMode = if ($containsPlaceholders) { 'template' } else { 'ready' }
    $composePath = Join-Path $databaseSourceDirectory 'docker-compose.yml'
    $imageReferences = @(Get-ComposeImageReferences -ComposePath $composePath)
    $imageArchiveRelativePath = $null

    if ($IncludeImages) {
        foreach ($image in $imageReferences) {
            if (-not (Test-DockerImageAvailable -Image $image)) {
                Write-Host "Pulling missing database image: $image"
                Invoke-CapturedCommand -Command 'docker' -Arguments @('pull', $image) | Out-Null
            }
            else {
                Write-Host "Using locally available database image: $image"
            }
        }

        $imagesDirectory = Join-Path $bundleRoot 'images'
        New-Item -ItemType Directory -Path $imagesDirectory -Force | Out-Null
        $imageArchivePath = Join-Path $imagesDirectory 'database-images.tar'
        $saveArguments = @('image', 'save', '--output', $imageArchivePath) + $imageReferences
        Write-Host 'Saving database images to the bundle...'
        Invoke-CapturedCommand -Command 'docker' -Arguments $saveArguments | Out-Null
        $imageArchiveRelativePath = 'images/database-images.tar'
    }

    $imageMode = if ($IncludeImages) { 'included' } else { 'download-on-server' }
    $deployReadme = @"
# CEES AI $Environment 数据库服务器部署包

生成时间：$createdAtLocal（$timeZoneId）
Git Commit：$gitCommit
配置状态：$bundleMode
镜像模式：$imageMode

## 部署

1. 检查 $environmentFileName，确保不再包含 change_me，并设置权限：

       grep "change_me" $environmentFileName
       chmod 600 $environmentFileName

2. 一键部署：

       bash deploy-db.sh $Environment

部署脚本会检查当前目录及 images/ 子目录中的 .tar、.tar.gz、.tgz 文件：

- 找到离线镜像时先执行 docker image load；离线包缺少的镜像才会联网拉取。
- 没有离线镜像时执行 docker compose pull，然后启动 PostgreSQL 和 Redis。
- 启动阶段使用 --pull never，确保不会发生未记录的隐式拉取。

## 常用运维

    bash manage-db.sh $Environment validate
    bash manage-db.sh $Environment ps
    bash manage-db.sh $Environment logs
    bash manage-db.sh $Environment logs postgres
    bash manage-db.sh $Environment down

down 不删除数据卷。禁止把 down -v 作为日常运维命令。
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
        project = 'cees-ai-database'
        environment = $Environment
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
            environmentSourcePath = $environmentSourceLabel
            containsRuntimeConfiguration = $includesRuntimeConfiguration
            containsPlaceholders = $containsPlaceholders
        }
        images = [ordered]@{
            mode = $imageMode
            archivePath = $imageArchiveRelativePath
            references = $imageReferences
        }
        files = $fileEntries
    }
    Write-Utf8Lf -Path (Join-Path $bundleRoot 'bundle-manifest.json') -Content (($manifest | ConvertTo-Json -Depth 8) + "`n")

    $archiveName = "cees-ai-db-$Environment-$timestamp-$shortCommit.tar.gz"
    $archivePath = Join-Path $OutputDirectory $archiveName
    if (Test-Path -LiteralPath $archivePath) {
        throw "Archive already exists: $archivePath"
    }

    Push-Location $workRoot
    try {
        & tar -czf $archivePath 'cees-db'
        if ($LASTEXITCODE -ne 0) {
            throw "tar failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }

    $archiveListing = (Invoke-CapturedCommand -Command 'tar' -Arguments @('-tzf', $archivePath)).Replace("`r`n", "`n").Replace("`r", "`n")
    foreach ($requiredPath in @(
        "cees-db/$environmentFileName",
        'cees-db/docker-compose.yml',
        'cees-db/docker-compose.server.yml',
        'cees-db/deploy-db.sh',
        'cees-db/manage-db.sh',
        'cees-db/DEPLOY.md',
        'cees-db/bundle-manifest.json'
    )) {
        if ($archiveListing -notmatch "(?m)^$([regex]::Escape($requiredPath))$") {
            throw "Archive verification failed; missing: $requiredPath"
        }
    }
    if ($IncludeImages -and $archiveListing -notmatch '(?m)^cees-db/images/database-images\.tar$') {
        throw 'Archive verification failed; missing: cees-db/images/database-images.tar'
    }

    $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $checksumPath = "$archivePath.sha256"
    Write-Utf8Lf -Path $checksumPath -Content "$archiveHash  $archiveName`n"

    $expandedPath = $null
    if ($KeepExpandedDirectory) {
        $expandedPath = Join-Path $OutputDirectory "cees-db-$Environment-$timestamp-$shortCommit"
        if (Test-Path -LiteralPath $expandedPath) {
            throw "Expanded output already exists: $expandedPath"
        }
        Copy-Item -LiteralPath $bundleRoot -Destination $expandedPath -Recurse
    }

    Write-Host ''
    Write-Host 'CEES AI database bundle created.' -ForegroundColor Green
    Write-Host "  Environment : $Environment"
    Write-Host "  Mode        : $bundleMode"
    Write-Host "  Env source  : $environmentSource ($resolvedEnvironmentFile)"
    Write-Host "  Images      : $imageMode"
    Write-Host "  Git commit  : $gitCommit"
    Write-Host "  Archive     : $archivePath"
    Write-Host "  SHA-256     : $archiveHash"
    Write-Host "  Checksum    : $checksumPath"
    if ($null -ne $expandedPath) {
        Write-Host "  Directory   : $expandedPath"
    }

    if ($containsPlaceholders) {
        Write-Warning "The bundle contains change_me placeholders. Edit $environmentFileName after extraction before deploying."
    }
    if ($includesRuntimeConfiguration) {
        Write-Warning 'The bundle contains a local runtime environment file and may contain secrets. Transfer it securely and delete unnecessary copies.'
    }
}
finally {
    if (Test-Path -LiteralPath $workRoot) {
        Assert-SafeCleanupPath -Target $workRoot -Parent $OutputDirectory
        Remove-Item -LiteralPath $workRoot -Recurse -Force
    }
}
