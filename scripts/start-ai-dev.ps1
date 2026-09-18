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
& 'C:\Users\sparkle\.local\bin\uv.exe' run --project apps/ai-service uvicorn app.main:app --app-dir apps/ai-service --host 0.0.0.0 --port 8001