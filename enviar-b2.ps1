# Sobe a pasta TRANSFER (ou o caminho passado) pro B2.
# Nunca sync. Nunca --delete. Teste do Daniel no Windows.
param(
  [string]$Src = ""
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $Src) {
  $Src = Join-Path $env:USERPROFILE "ATLAS\TRANSFER"
}

$rclone = Join-Path $here "bin\rclone.exe"
if (-not (Test-Path $rclone)) { $rclone = "rclone" }

if (-not (Test-Path $Src -PathType Container)) {
  Write-Host "Pasta nao existe: $Src"
  Write-Host "Cria $env:USERPROFILE\ATLAS\TRANSFER ou passa -Src"
  exit 1
}

$day = Get-Date -Format "yyyy-MM-dd"
$dest = "b2:atlas-victor-bruto/YT-MAIN/00_INBOX/$day/"
if ($dest -notmatch '^b2:atlas-victor-bruto/YT-MAIN/00_INBOX/\d{4}-\d{2}-\d{2}/$') {
  throw "destino recusado"
}

$files = Get-ChildItem -Path $Src -File -Recurse -Force |
  Where-Object { $_.Name -ne ".DS_Store" -and $_.Name -notlike "._*" }
if (-not $files) {
  Write-Host "Pasta vazia: $Src"
  exit 1
}

Write-Host "De:  $Src"
Write-Host "Pra: $dest"
Write-Host "Arquivos: $($files.Count)"
Write-Host ""

Write-Host "Starlink: se o % cair, e retry. Nao fecha. Nao clica Mandar de novo."
Write-Host ""

& $rclone copy $Src $dest `
  --progress `
  --fast-list `
  --size-only `
  --ignore-existing `
  --transfers 2 `
  --checkers 2 `
  --b2-upload-concurrency 2 `
  --multi-thread-streams 1 `
  --disable-http2 `
  --retries 20 `
  --low-level-retries 10 `
  --retries-sleep 15s `
  --timeout 5m `
  --contimeout 60s `
  --stats 5s `
  --exclude ".DS_Store" `
  --exclude "._*" `
  --exclude ".Trash/**"
if ($LASTEXITCODE -ne 0) { throw "rclone copy falhou" }

Write-Host ""
Write-Host "Pronto. Abre o Drive e olha 00_INBOX/$day/"
