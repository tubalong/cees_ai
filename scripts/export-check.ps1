$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    $base = 'http://localhost:3000/api/v1'
    $login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{ tenantCode = 'cees'; account = 'admin'; password = 'change_me'; deviceName = 'Export Test' } | ConvertTo-Json)
    $token = if ($login.data) { $login.data.accessToken } else { $login.accessToken }
    $h = @{ 'Authorization' = "Bearer $token" }
    Write-Host "LOGIN_OK"

    $list = Invoke-RestMethod -Method Get -Uri "$base/documents?limit=50" -Headers $h
    $items = if ($list.data) { $list.data.items } else { $list.items }
    Write-Host ("DOC_COUNT=" + @($items).Count)
    foreach ($d in $items) {
        $fmt = $d.fileMimeType
        Write-Host ("- {0} | title='{1}' | mime={2}" -f $d.id, $d.title, $fmt)
    }

    $target = $items | Where-Object { $_.fileMimeType -like '*presentationml*' } | Select-Object -First 1
    if (-not $target) { $target = $items | Select-Object -First 1 }
    if (-not $target) { Write-Host 'RESULT=NO_DOCUMENTS'; return }
    Write-Host ("TARGET=" + $target.id + " title='" + $target.title + "'")

    $outDir = 'e:\CEES AI\code\cees_ai\tmp-export-check'
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null

    foreach ($fmt in @('', 'pdf', 'pptx')) {
        $url = if ($fmt -eq '') { "$base/documents/$($target.id)/export" } else { "$base/documents/$($target.id)/export/$fmt" }
        $label = if ($fmt -eq '') { 'docx' } else { $fmt }
        try {
            $resp = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $url -Headers $h
            $bytes = $resp.Content
            if ($bytes -is [string]) { $bytes = [System.Text.Encoding]::UTF8.GetBytes($bytes) }
            $ct = $resp.Headers['Content-Type']
            $cd = $resp.Headers['Content-Disposition']
            $head = ($bytes[0..7] | ForEach-Object { $_.ToString('X2') }) -join ' '
            $file = Join-Path $outDir ("export-$label.bin")
            [System.IO.File]::WriteAllBytes($file, $bytes)
            Write-Host ("EXPORT $label => len=$($bytes.Length) contentType=$ct headhex=$head")
            Write-Host ("   disposition=$cd")
        }
        catch {
            Write-Host ("EXPORT $label => FAILED: " + $_.Exception.Message)
            if ($_.ErrorDetails) { Write-Host ("   details=" + $_.ErrorDetails.Message) }
        }
    }
    Write-Host "RESULT=SUCCESS"
}
catch {
    Write-Host "RESULT=FAILURE"
    Write-Host ("ERROR=" + $_.Exception.Message)
    if ($_.ErrorDetails) { Write-Host ("DETAILS=" + $_.ErrorDetails.Message) }
}
