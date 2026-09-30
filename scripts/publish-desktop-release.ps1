<#
.SYNOPSIS
Build and publish the Windows desktop auto-update artifacts to COS.

.EXAMPLE
pwsh ./scripts/publish-desktop-release.ps1 `
  -CosAlias cees-release `
  -CosConfigPath "$HOME/.config/cees/cos-release.yaml"
#>

[CmdletBinding()]
param(
    [string]$DesktopDirectory = (Join-Path $PSScriptRoot '..\apps\desktop'),
    [string]$CosAlias = 'cees-release',
    [string]$CosConfigPath,
    [string]$CosPrefix = 'desktop',
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$desktopPath = [System.IO.Path]::GetFullPath($DesktopDirectory)
$releasePath = Join-Path $desktopPath 'release'
if (-not $SkipBuild) {
    pnpm --dir $desktopPath dist:win
    if ($LASTEXITCODE -ne 0) { throw 'Windows desktop build failed' }
}

$latestFile = Join-Path $releasePath 'latest.yml'
if (-not (Test-Path -LiteralPath $latestFile -PathType Leaf)) {
    throw "Missing $latestFile. electron-builder must generate latest.yml for auto-update."
}
$latestText = Get-Content -LiteralPath $latestFile -Raw
$versionMatch = [regex]::Match($latestText, '(?m)^version:\s*(\S+)\s*$')
$pathMatch = [regex]::Match($latestText, '(?m)^path:\s*(\S+)\s*$')
$urlMatch = [regex]::Match($latestText, '(?m)^\s*- url:\s*(\S+)\s*$')
$version = $versionMatch.Groups[1].Value
if ([string]::IsNullOrWhiteSpace($version)) { throw 'latest.yml does not contain a version' }
$installerName = $pathMatch.Groups[1].Value
$blockmapName = $urlMatch.Groups[1].Value
if ([string]::IsNullOrWhiteSpace($installerName) -or [string]::IsNullOrWhiteSpace($blockmapName)) {
    throw 'latest.yml does not contain the NSIS installer and blockmap names'
}

$artifacts = @(
    (Join-Path $releasePath $installerName),
    (Join-Path $releasePath $blockmapName)
) | Select-Object -Unique
foreach ($artifact in $artifacts) {
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
        throw "Missing update artifact: $artifact"
    }
}

$coscli = Get-Command coscli -ErrorAction SilentlyContinue
if (-not $coscli) { throw 'coscli is not installed or not available on PATH' }
$logPath = Join-Path $releasePath 'publish-logs'
New-Item -ItemType Directory -Force -Path $logPath | Out-Null

function Publish-File {
    param([string]$LocalPath, [string]$ObjectName, [string]$ContentType, [string]$CacheControl)
    $destination = "cos://$CosAlias/$CosPrefix/$ObjectName"
    $arguments = @('cp', $LocalPath, $destination, '--part-size', '64', '--thread-num', '6', '--err-retry-num', '10', '--err-retry-interval', '3', '--log-path', $logPath, '--process-log-path', $logPath, '--fail-output-path', $logPath, '--meta', "Content-Type:$ContentType#Cache-Control:$CacheControl")
    if ($CosConfigPath) { $arguments += @('--config-path', [System.IO.Path]::GetFullPath($CosConfigPath)) }
    & $coscli.Source @arguments
    if ($LASTEXITCODE -ne 0) { throw "COS upload failed: $ObjectName" }
}

$latestName = Split-Path -Leaf $latestFile
Publish-File $latestFile $latestName 'text/yaml; charset=utf-8' 'no-cache, no-store, must-revalidate'
foreach ($artifact in $artifacts) {
    $name = Split-Path -Leaf $artifact
    $contentType = if ($name.EndsWith('.exe')) { 'application/vnd.microsoft.portable-executable' } elseif ($name.EndsWith('.blockmap')) { 'application/octet-stream' } else { 'application/zip' }
    Publish-File $artifact $name $contentType 'public, max-age=31536000, immutable'
}

Write-Host "Desktop release $version published to https://cdn.cees.top/$CosPrefix/"
Write-Host 'Uploaded latest.yml and the versioned NSIS installer/blockmap.'
