$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot '.env'

if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
        $trimmed = $line.Trim()
        if (!$trimmed -or $trimmed.StartsWith('#') -or !$trimmed.Contains('=')) {
            continue
        }
        $parts = $trimmed.Split('=', 2)
        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}

Set-Location $repoRoot

# Bind the port AI_SERVICE_URL points at. The API only ever calls that address,
# so starting uvicorn on a different port silently leaves an older process
# serving the API and code changes never take effect.
$aiServicePort = 8000
if ($env:AI_SERVICE_URL) {
    try {
        $parsed = [Uri]$env:AI_SERVICE_URL
        if ($parsed.Port -gt 0) { $aiServicePort = $parsed.Port }
    } catch {
        Write-Warning "Cannot parse AI_SERVICE_URL=$($env:AI_SERVICE_URL); falling back to port $aiServicePort"
    }
}

$occupied = Get-NetTCPConnection -State Listen -LocalPort $aiServicePort -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($occupied) {
    $owner = Get-Process -Id $occupied.OwningProcess -ErrorAction SilentlyContinue
    $ownerName = if ($owner) { $owner.ProcessName } else { 'unknown' }
    throw "Port $aiServicePort is already in use (PID $($occupied.OwningProcess) $ownerName). " +
        "AI_SERVICE_URL=$($env:AI_SERVICE_URL) points at that port, so stop the running process first, " +
        "otherwise the stale service keeps serving the API."
}

$uv = (Get-Command uv -ErrorAction SilentlyContinue).Source
if (!$uv -and (Test-Path 'C:\Users\sparkle\.local\bin\uv.exe')) {
    $uv = 'C:\Users\sparkle\.local\bin\uv.exe'
}
if (!$uv) { throw 'uv not found; install uv or add it to PATH.' }

Write-Host "Starting ai-service at $($env:AI_SERVICE_URL) (port $aiServicePort)"
& $uv run --project apps/ai-service uvicorn app.main:app --app-dir apps/ai-service --host 0.0.0.0 --port $aiServicePort
