[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
$aiServiceDir = Join-Path $root 'apps/ai-service'
$composeBase = Join-Path $root 'infra/database/docker-compose.yml'
$composeDev = Join-Path $root 'infra/docker-compose.dev.yml'

function Import-DotEnv([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Missing environment file: $path. Copy .env.example to .env first."
    }

    foreach ($line in Get-Content -LiteralPath $path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#') -or $trimmed -notmatch '=') {
            continue
        }

        $separator = $trimmed.IndexOf('=')
        $key = $trimmed.Substring(0, $separator).Trim()
        $value = $trimmed.Substring($separator + 1).Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        [Environment]::SetEnvironmentVariable($key, $value, 'Process')
    }
}

function Invoke-Step([string]$label, [scriptblock]$action) {
    Write-Host "`n==> $label"
    & $action
    if ($LASTEXITCODE -ne 0) {
        throw "Step failed with exit code ${LASTEXITCODE}: $label"
    }
}

Set-Location -LiteralPath $root
Import-DotEnv $envFile

if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $apiPort = 3000
    if ($env:API_PORT) {
        $apiPort = [int]$env:API_PORT
    }
    $apiListener = Get-NetTCPConnection -LocalPort $apiPort -State Listen -ErrorAction SilentlyContinue
    if ($apiListener) {
        throw "API port $apiPort is already in use. Stop the local API before running local:deploy so Prisma Client can be regenerated."
    }
}

Invoke-Step 'Sync ai-service Python dependencies' {
    Push-Location -LiteralPath $aiServiceDir
    try {
        uv sync --locked
    }
    finally {
        Pop-Location
    }
}

Invoke-Step 'Start local PostgreSQL and Redis' {
    docker compose --env-file $envFile -f $composeBase -f $composeDev up -d --wait --remove-orphans
}

Invoke-Step 'Generate Prisma Client' {
    corepack pnpm --filter @cees/api run prisma:generate
}

Invoke-Step 'Apply Prisma migrations' {
    corepack pnpm --filter @cees/api exec prisma migrate deploy
}

Invoke-Step 'Create cees_ai_vectors database if missing' {
    $postgresContainer = docker compose --env-file $envFile -f $composeBase -f $composeDev ps -q postgres
    if ($LASTEXITCODE -ne 0 -or -not $postgresContainer) {
        throw 'PostgreSQL container is not running.'
    }
    $sql = "SELECT 'CREATE DATABASE cees_ai_vectors' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'cees_ai_vectors')\gexec"
    $sql | docker exec -i $postgresContainer psql -U $env:POSTGRES_USER -d postgres -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not create cees_ai_vectors.'
    }
}

Invoke-Step 'Seed local tenant, users, roles, permissions, and platform administrator' {
    corepack pnpm --filter @cees/api run prisma:seed
}

Write-Host "`nLocal deployment is ready."
Write-Host 'Start the API with: corepack pnpm --filter @cees/api dev'
