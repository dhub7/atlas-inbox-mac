# Sobe o Inbox neste PC Windows (teste do Daniel). Victor usa o Mac.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

$envFile = Join-Path $here ".env"
if (-not (Test-Path $envFile)) {
  $token = -join ((1..16) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
  @"
PORT=8088
INBOX_TOKEN=$token
B2_BUCKET=atlas-victor-bruto
PUBLIC_ORIGIN=http://127.0.0.1:8088
RCLONE_REMOTE=b2
BIND=127.0.0.1
"@ | Set-Content -Path $envFile -Encoding ascii
  Write-Host "Criei .env com token $token"
}

Write-Host "Inbox local: http://127.0.0.1:8088"
node server.mjs
