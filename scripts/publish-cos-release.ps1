<#
.SYNOPSIS
Builds CEES AI Linux container images, packages them, and publishes the release to COS.

.DESCRIPTION
The script builds the API and AI service images for a target Linux platform, exports both
images into one Docker archive, compresses the archive with gzip by default, writes release
metadata and a SHA-256 checksum, and uploads the immutable release files to:

  releases/<staging|prod>/<release-id>/

After all immutable files are uploaded, it updates:

  releases/<staging|prod>/latest.json

COS credentials are read by COSCLI from its configuration file. Secrets are never accepted as
script parameters and are not written into release artifacts.

.PARAMETER Environment
The COS release channel. Allowed values are staging and prod.

.PARAMETER CosAlias
The COSCLI bucket alias configured for cees-ai-1403013862. Defaults to cees-release.

.PARAMETER CosConfigPath
Optional dedicated COSCLI configuration path. When omitted, COSCLI uses $HOME/.cos.yaml.

.PARAMETER CosPrefix
Root object prefix. Defaults to releases.

.PARAMETER Platform
Target container platform. Defaults to linux/amd64. Use linux/arm64 for an aarch64 server.

.PARAMETER UseChinaImageMirror
Routes Docker Hub and GHCR base-image pulls through the DaoCloud public image mirror. This
only changes image sources; it does not configure a proxy or change package lockfiles.

.PARAMETER NodeBaseImage
Optional Node base image override. Defaults to node:24-alpine.

.PARAMETER PythonBaseImage
Optional Python base image override. Defaults to python:3.14-slim.

.PARAMETER UvBaseImage
Optional uv base image override. Defaults to ghcr.io/astral-sh/uv:0.12.7.

.PARAMETER ReleaseId
Optional immutable release identifier and Docker image tag. By default, the script generates
<system-local timestamp>-<12-character Git SHA>. Dirty staging builds receive a -dirty suffix.

.PARAMETER OutputRoot
Local release output root. Defaults to dist/releases. Each run clears and writes only the selected
environment subdirectory; local production output uses production while the COS channel remains prod.

.PARAMETER AllowDirty
Allows a dirty working tree for staging only. Production releases always require a clean tree.

.PARAMETER SkipUpload
Builds and packages locally without calling COSCLI.

.PARAMETER NoCompression
Uploads the raw Docker tar archive instead of creating a gzip archive.

.PARAMETER KeepTar
Keeps the raw tar archive after gzip compression.

.PARAMETER UpdateLatest
Controls whether releases/<environment>/latest.json is updated. Defaults to true.

.EXAMPLE
pwsh ./scripts/publish-cos-release.ps1 -Environment staging -CosAlias cees-release

.EXAMPLE
pwsh ./scripts/publish-cos-release.ps1 -Environment prod `
  -CosAlias cees-release `
  -CosConfigPath "$HOME/.config/cees/cos-release.yaml"

.EXAMPLE
pwsh ./scripts/publish-cos-release.ps1 -Environment staging -AllowDirty -UseChinaImageMirror

.EXAMPLE
pwsh ./scripts/publish-cos-release.ps1 -Environment staging -AllowDirty -SkipUpload
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateSet('staging', 'prod')]
    [string]$Environment,

    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')]
    [string]$CosAlias = 'cees-release',

    [string]$CosConfigPath,

    [string]$CosPrefix = 'releases',

    [ValidateSet('linux/amd64', 'linux/arm64')]
    [string]$Platform = 'linux/amd64',

    [switch]$UseChinaImageMirror,

    [string]$NodeBaseImage = 'node:24-alpine',

    [string]$PythonBaseImage = 'python:3.14-slim',

    [string]$UvBaseImage = 'ghcr.io/astral-sh/uv:0.12.7',

    [string]$ReleaseId,

    [string]$OutputRoot,

    [switch]$AllowDirty,

    [switch]$SkipUpload,

    [switch]$NoCompression,

    [switch]$KeepTar,

    [bool]$UpdateLatest = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Command {
    param([Parameter(Mandatory)][string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command is unavailable: $Name"
    }
}

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory)][string]$Command,
        [Parameter()][string[]]$Arguments = @(),
        [switch]$CaptureOutput
    )

    if ($CaptureOutput) {
        $output = & $Command @Arguments 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            $renderedArguments = $Arguments -join ' '
            $renderedOutput = ($output | ForEach-Object { $_.ToString() }) -join "`n"
            throw "Command failed with exit code ${exitCode}: $Command $renderedArguments$([Environment]::NewLine)$renderedOutput"
        }

        return (($output | ForEach-Object { $_.ToString() }) -join "`n").Trim()
    }

    & $Command @Arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        $renderedArguments = $Arguments -join ' '
        throw "Command failed with exit code ${exitCode}: $Command $renderedArguments"
    }
}

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Content
    )

    $encoding = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Compress-GzipFile {
    param(
        [Parameter(Mandatory)][string]$SourcePath,
        [Parameter(Mandatory)][string]$DestinationPath
    )

    $sourceStream = $null
    $destinationStream = $null
    $gzipStream = $null

    try {
        $sourceStream = [System.IO.File]::OpenRead($SourcePath)
        $destinationStream = [System.IO.File]::Create($DestinationPath)
        $gzipStream = [System.IO.Compression.GZipStream]::new(
            $destinationStream,
            [System.IO.Compression.CompressionLevel]::Optimal,
            $false
        )
        $sourceStream.CopyTo($gzipStream, 1MB)
    }
    finally {
        if ($null -ne $gzipStream) {
            $gzipStream.Dispose()
        }
        if ($null -ne $destinationStream) {
            $destinationStream.Dispose()
        }
        if ($null -ne $sourceStream) {
            $sourceStream.Dispose()
        }
    }
}

function Get-DockerImageInfo {
    param([Parameter(Mandatory)][string]$Reference)

    $inspectJson = Invoke-NativeCommand -Command 'docker' -Arguments @(
        'image', 'inspect', $Reference
    ) -CaptureOutput
    $inspectResults = @($inspectJson | ConvertFrom-Json)

    if ($inspectResults.Count -ne 1) {
        throw "Expected exactly one Docker image for reference: $Reference"
    }

    return $inspectResults[0]
}

function Invoke-CosUpload {
    param(
        [Parameter(Mandatory)][string]$LocalPath,
        [Parameter(Mandatory)][string]$ObjectKey,
        [Parameter(Mandatory)][string]$ContentType,
        [Parameter(Mandatory)][string]$LogDirectory,
        [switch]$ForbidOverwrite
    )

    $destination = "cos://$CosAlias/$ObjectKey"
    $arguments = @(
        'cp',
        $LocalPath,
        $destination,
        '--part-size', '64',
        '--thread-num', '6',
        '--err-retry-num', '10',
        '--err-retry-interval', '3',
        '--log-path', $LogDirectory,
        '--process-log-path', $LogDirectory,
        '--fail-output-path', $LogDirectory,
        '--meta', "Content-Type:$ContentType#Cache-Control:no-cache"
    )

    if ($ForbidOverwrite) {
        $arguments += '--forbid-overwrite'
    }

    if (-not [string]::IsNullOrWhiteSpace($CosConfigPath)) {
        $arguments += @('--config-path', $CosConfigPath)
    }

    Write-Host "Uploading $([System.IO.Path]::GetFileName($LocalPath)) -> $destination"
    Invoke-NativeCommand -Command 'coscli' -Arguments $arguments
}

function Reset-EnvironmentOutputDirectory {
    param(
        [Parameter(Mandatory)][string]$OutputRoot,
        [Parameter(Mandatory)][string]$Environment
    )

    New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null

    $resolvedRoot = [System.IO.Path]::GetFullPath($OutputRoot).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $resolvedTarget = [System.IO.Path]::GetFullPath((Join-Path $resolvedRoot $Environment)).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $expectedPrefix = $resolvedRoot + [System.IO.Path]::DirectorySeparatorChar

    if (-not $resolvedTarget.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to reset environment output outside output root: $resolvedTarget"
    }
    if (-not [System.IO.Path]::GetFileName($resolvedTarget).Equals($Environment, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to reset unexpected environment output directory: $resolvedTarget"
    }

    if (Test-Path -LiteralPath $resolvedTarget) {
        $targetItem = Get-Item -LiteralPath $resolvedTarget -Force
        if (-not $targetItem.PSIsContainer) {
            throw "Environment output path is not a directory: $resolvedTarget"
        }
        if (($targetItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Refusing to reset environment output through a reparse point: $resolvedTarget"
        }
        Write-Host "Clearing previous environment output: $resolvedTarget"
        Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
    }

    New-Item -ItemType Directory -Path $resolvedTarget -Force | Out-Null
    return $resolvedTarget
}

$scriptDirectory = Split-Path -Parent $PSCommandPath
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDirectory '..'))

$CosPrefix = $CosPrefix.Trim().Trim('/')
if ([string]::IsNullOrWhiteSpace($CosPrefix)) {
    throw 'CosPrefix cannot be empty.'
}
if ($CosPrefix.Contains('\') -or $CosPrefix.Split('/') -contains '..') {
    throw 'CosPrefix must be a safe COS object prefix using forward slashes.'
}

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $repositoryRoot 'dist/releases'
}
elseif (-not [System.IO.Path]::IsPathRooted($OutputRoot)) {
    $OutputRoot = Join-Path $repositoryRoot $OutputRoot
}
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
$localEnvironment = if ($Environment -eq 'prod') { 'production' } else { 'staging' }

if (-not [string]::IsNullOrWhiteSpace($CosConfigPath)) {
    $CosConfigPath = [System.IO.Path]::GetFullPath($CosConfigPath)
    if (-not $SkipUpload -and -not (Test-Path -LiteralPath $CosConfigPath -PathType Leaf)) {
        throw "COSCLI configuration file does not exist: $CosConfigPath"
    }
}

if ($UseChinaImageMirror) {
    if (-not $PSBoundParameters.ContainsKey('NodeBaseImage')) {
        $NodeBaseImage = 'm.daocloud.io/docker.io/library/node:24-alpine'
    }
    if (-not $PSBoundParameters.ContainsKey('PythonBaseImage')) {
        $PythonBaseImage = 'm.daocloud.io/docker.io/library/python:3.14-slim'
    }
    if (-not $PSBoundParameters.ContainsKey('UvBaseImage')) {
        $UvBaseImage = 'm.daocloud.io/ghcr.io/astral-sh/uv:0.12.7'
    }
}

$baseImages = [ordered]@{
    node = $NodeBaseImage
    python = $PythonBaseImage
    uv = $UvBaseImage
}
foreach ($entry in $baseImages.GetEnumerator()) {
    if ([string]::IsNullOrWhiteSpace($entry.Value) -or $entry.Value -match '\s') {
        throw "Invalid $($entry.Key) base image reference: $($entry.Value)"
    }
}

Assert-Command -Name 'git'
Assert-Command -Name 'docker'
if (-not $SkipUpload) {
    Assert-Command -Name 'coscli'
}

Push-Location $repositoryRoot
try {
    $gitCommit = Invoke-NativeCommand -Command 'git' -Arguments @(
        '-C', $repositoryRoot, 'rev-parse', 'HEAD'
    ) -CaptureOutput
    $shortCommit = Invoke-NativeCommand -Command 'git' -Arguments @(
        '-C', $repositoryRoot, 'rev-parse', '--short=12', 'HEAD'
    ) -CaptureOutput
    $gitBranch = Invoke-NativeCommand -Command 'git' -Arguments @(
        '-C', $repositoryRoot, 'rev-parse', '--abbrev-ref', 'HEAD'
    ) -CaptureOutput
    $gitStatus = Invoke-NativeCommand -Command 'git' -Arguments @(
        '-C', $repositoryRoot, 'status', '--porcelain', '--untracked-files=normal'
    ) -CaptureOutput
    $isDirty = -not [string]::IsNullOrWhiteSpace($gitStatus)

    if ($isDirty -and $Environment -eq 'prod') {
        throw 'Production releases require a clean Git working tree. Commit or discard local changes first.'
    }
    if ($isDirty -and -not $AllowDirty) {
        throw 'The Git working tree is dirty. Commit the changes or use -AllowDirty for a staging release.'
    }

    if ([string]::IsNullOrWhiteSpace($ReleaseId)) {
        $timestamp = [DateTimeOffset]::Now.ToString('yyyyMMddTHHmmss')
        $ReleaseId = "$timestamp-$shortCommit"
        if ($isDirty) {
            $ReleaseId += '-dirty'
        }
    }

    if ($ReleaseId.Length -gt 128 -or $ReleaseId -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') {
        throw 'ReleaseId must also be a valid Docker tag: 1-128 letters, digits, underscores, periods, or hyphens.'
    }

    Write-Host "Checking Docker and Buildx..."
    $null = Invoke-NativeCommand -Command 'docker' -Arguments @(
        'version', '--format', '{{.Server.Os}}/{{.Server.Arch}}'
    ) -CaptureOutput
    $null = Invoke-NativeCommand -Command 'docker' -Arguments @(
        'buildx', 'version'
    ) -CaptureOutput

    $environmentOutputDirectory = Reset-EnvironmentOutputDirectory -OutputRoot $OutputRoot -Environment $localEnvironment
    $releaseDirectory = Join-Path $environmentOutputDirectory $ReleaseId
    if (Test-Path -LiteralPath $releaseDirectory) {
        throw "Release output already exists: $releaseDirectory"
    }
    New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null

    $cosLogDirectory = Join-Path $releaseDirectory 'coscli-output'
    New-Item -ItemType Directory -Path $cosLogDirectory -Force | Out-Null

    $apiImage = "cees-api:$ReleaseId"
    $aiServiceImage = "cees-ai-service:$ReleaseId"

    Write-Host "Building $apiImage for $Platform..."
    Write-Host "  Node base image: $NodeBaseImage"
    Invoke-NativeCommand -Command 'docker' -Arguments @(
        'buildx', 'build',
        '--platform', $Platform,
        '--build-arg', "NODE_BASE_IMAGE=$NodeBaseImage",
        '--file', (Join-Path $repositoryRoot 'apps/api/Dockerfile'),
        '--tag', $apiImage,
        '--load',
        $repositoryRoot
    )

    Write-Host "Building $aiServiceImage for $Platform..."
    Write-Host "  Python base image: $PythonBaseImage"
    Write-Host "  uv base image: $UvBaseImage"
    Invoke-NativeCommand -Command 'docker' -Arguments @(
        'buildx', 'build',
        '--platform', $Platform,
        '--build-arg', "PYTHON_BASE_IMAGE=$PythonBaseImage",
        '--build-arg', "UV_BASE_IMAGE=$UvBaseImage",
        '--file', (Join-Path $repositoryRoot 'apps/ai-service/Dockerfile'),
        '--tag', $aiServiceImage,
        '--load',
        (Join-Path $repositoryRoot 'apps/ai-service')
    )

    $apiImageInfo = Get-DockerImageInfo -Reference $apiImage
    $aiServiceImageInfo = Get-DockerImageInfo -Reference $aiServiceImage

    Write-Host 'Validating image runtime artifacts...'
    Invoke-NativeCommand -Command 'docker' -Arguments @(
        'run', '--rm',
        '--entrypoint', 'node',
        $apiImage,
        '-e',
        "const fs=require('node:fs'); fs.accessSync('/workspace/apps/api/dist/main.js'); require('argon2'); require('@prisma/client'); const {createTencentCosClient}=require('/workspace/apps/api/dist/storage/storage.module.js'); createTencentCosClient({secretId:'test',secretKey:'test'});"
    )
    Invoke-NativeCommand -Command 'docker' -Arguments @(
        'run', '--rm',
        '--entrypoint', 'python',
        $aiServiceImage,
        '-c',
        'import app.main'
    )

    $platformSlug = $Platform.Replace('/', '-')
    $archiveBaseName = "cees-images-$Environment-$ReleaseId-$platformSlug.tar"
    $tarPath = Join-Path $releaseDirectory $archiveBaseName

    Write-Host "Exporting Docker images to $tarPath..."
    Invoke-NativeCommand -Command 'docker' -Arguments @(
        'image', 'save',
        '--output', $tarPath,
        $apiImage,
        $aiServiceImage
    )

    if ($NoCompression) {
        $artifactPath = $tarPath
        $compression = 'none'
    }
    else {
        $artifactPath = "$tarPath.gz"
        Write-Host "Compressing Docker archive to $artifactPath..."
        Compress-GzipFile -SourcePath $tarPath -DestinationPath $artifactPath
        $compression = 'gzip'

        if (-not $KeepTar) {
            Remove-Item -LiteralPath $tarPath
        }
    }

    $artifactFile = Get-Item -LiteralPath $artifactPath
    $artifactHash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $completedAt = [DateTimeOffset]::Now
    $createdAtLocal = $completedAt.ToString('o')
    $createdAtUtc = $completedAt.UtcDateTime.ToString('o')
    $timeZoneId = [TimeZoneInfo]::Local.Id
    $remoteReleasePrefix = "$CosPrefix/$Environment/$ReleaseId"
    $remoteArtifactKey = "$remoteReleasePrefix/$($artifactFile.Name)"
    $remoteChecksumKey = "$remoteReleasePrefix/SHA256SUMS"
    $remoteEnvironmentKey = "$remoteReleasePrefix/release.env"
    $remoteManifestKey = "$remoteReleasePrefix/manifest.json"
    $remoteLatestKey = "$CosPrefix/$Environment/latest.json"

    $checksumPath = Join-Path $releaseDirectory 'SHA256SUMS'
    Write-Utf8NoBom -Path $checksumPath -Content "$artifactHash  $($artifactFile.Name)`n"

    $releaseEnvironmentPath = Join-Path $releaseDirectory 'release.env'
    $releaseEnvironment = @(
        "CEES_RELEASE_ID=$ReleaseId",
        "IMAGE_TAG=$ReleaseId",
        'API_IMAGE=cees-api',
        'AI_SERVICE_IMAGE=cees-ai-service',
        "CEES_RELEASE_ARTIFACT=$remoteArtifactKey",
        "CEES_RELEASE_SHA256=$artifactHash"
    ) -join "`n"
    Write-Utf8NoBom -Path $releaseEnvironmentPath -Content "$releaseEnvironment`n"

    $manifest = [ordered]@{
        schemaVersion = 1
        project = 'cees-ai'
        environment = $Environment
        releaseId = $ReleaseId
        createdAtLocal = $createdAtLocal
        createdAtUtc = $createdAtUtc
        timeZone = $timeZoneId
        platform = $Platform
        build = [ordered]@{
            chinaImageMirror = [bool]$UseChinaImageMirror
            baseImages = $baseImages
        }
        git = [ordered]@{
            commit = $gitCommit
            shortCommit = $shortCommit
            branch = $gitBranch
            dirty = $isDirty
        }
        images = @(
            [ordered]@{
                service = 'api'
                reference = $apiImage
                id = $apiImageInfo.Id
                created = $apiImageInfo.Created
                sizeBytes = [long]$apiImageInfo.Size
            },
            [ordered]@{
                service = 'ai-service'
                reference = $aiServiceImage
                id = $aiServiceImageInfo.Id
                created = $aiServiceImageInfo.Created
                sizeBytes = [long]$aiServiceImageInfo.Size
            }
        )
        artifact = [ordered]@{
            fileName = $artifactFile.Name
            sizeBytes = [long]$artifactFile.Length
            sha256 = $artifactHash
            compression = $compression
            cosKey = $remoteArtifactKey
        }
        cos = [ordered]@{
            alias = $CosAlias
            releasePrefix = $remoteReleasePrefix
            checksumKey = $remoteChecksumKey
            environmentKey = $remoteEnvironmentKey
            manifestKey = $remoteManifestKey
            latestKey = $(if ($UpdateLatest) { $remoteLatestKey } else { $null })
        }
    }

    $manifestPath = Join-Path $releaseDirectory 'manifest.json'
    Write-Utf8NoBom -Path $manifestPath -Content (($manifest | ConvertTo-Json -Depth 8) + "`n")

    $latestPath = Join-Path $releaseDirectory 'latest.json'
    if ($UpdateLatest) {
        $latest = [ordered]@{
            schemaVersion = 1
            project = 'cees-ai'
            environment = $Environment
            releaseId = $ReleaseId
            createdAtLocal = $createdAtLocal
            createdAtUtc = $createdAtUtc
            timeZone = $timeZoneId
            manifestKey = $remoteManifestKey
            artifactKey = $remoteArtifactKey
            sha256 = $artifactHash
        }
        Write-Utf8NoBom -Path $latestPath -Content (($latest | ConvertTo-Json -Depth 4) + "`n")
    }

    if (-not $SkipUpload) {
        $artifactContentType = if ($compression -eq 'gzip') { 'application/gzip' } else { 'application/x-tar' }

        Invoke-CosUpload -LocalPath $artifactPath -ObjectKey $remoteArtifactKey `
            -ContentType $artifactContentType -LogDirectory $cosLogDirectory -ForbidOverwrite
        Invoke-CosUpload -LocalPath $checksumPath -ObjectKey $remoteChecksumKey `
            -ContentType 'text/plain; charset=utf-8' -LogDirectory $cosLogDirectory -ForbidOverwrite
        Invoke-CosUpload -LocalPath $releaseEnvironmentPath -ObjectKey $remoteEnvironmentKey `
            -ContentType 'text/plain; charset=utf-8' -LogDirectory $cosLogDirectory -ForbidOverwrite

        # manifest.json is uploaded last and acts as the immutable release-complete marker.
        Invoke-CosUpload -LocalPath $manifestPath -ObjectKey $remoteManifestKey `
            -ContentType 'application/json' -LogDirectory $cosLogDirectory -ForbidOverwrite

        if ($UpdateLatest) {
            # latest.json is intentionally mutable and is updated only after the release is complete.
            Invoke-CosUpload -LocalPath $latestPath -ObjectKey $remoteLatestKey `
                -ContentType 'application/json' -LogDirectory $cosLogDirectory
        }
    }

    Write-Host ''
    Write-Host 'CEES AI release completed.' -ForegroundColor Green
    Write-Host "  Environment : $Environment"
    Write-Host "  Release ID  : $ReleaseId"
    Write-Host "  Git commit  : $gitCommit"
    Write-Host "  Platform    : $Platform"
    Write-Host "  Artifact    : $artifactPath"
    Write-Host "  SHA-256     : $artifactHash"
    Write-Host "  COS prefix  : cos://$CosAlias/$remoteReleasePrefix/"
    if ($SkipUpload) {
        Write-Host '  Upload      : skipped'
    }
    elseif ($UpdateLatest) {
        Write-Host "  Latest      : cos://$CosAlias/$remoteLatestKey"
    }
}
finally {
    Pop-Location
}
