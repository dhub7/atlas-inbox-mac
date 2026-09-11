# Publica o Inbox: git (se existir remote) + pacote no Backblaze.
# Uso: .\publicar.ps1
#      .\publicar.ps1 -Version 2026.09.11.2
param(
  [string]$Version = ""
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

$rclone = Join-Path $here "bin\rclone.exe"
if (-not (Test-Path $rclone)) {
  $rclone = "rclone"
}
$git = "C:\Program Files\Git\cmd\git.exe"
$remoteB2 = "b2:atlas-victor-bruto/YT-MAIN/00_APPS/inbox-mac"

if ($Version) {
  $Version.Trim() | Set-Content -Path (Join-Path $here "VERSION") -Encoding ascii -NoNewline
  Add-Content -Path (Join-Path $here "VERSION") -Value ""
} else {
  $cur = (Get-Content (Join-Path $here "VERSION") -Raw).Trim()
  if ($cur -match '^(\d{4}\.\d{2}\.\d{2})\.(\d+)$') {
    $n = [int]$Matches[2] + 1
    $Version = "$($Matches[1]).$n"
  } else {
    $Version = Get-Date -Format "yyyy.MM.dd.1"
  }
  $Version | Set-Content -Path (Join-Path $here "VERSION") -Encoding ascii -NoNewline
  Add-Content -Path (Join-Path $here "VERSION") -Value ""
}
$Version = (Get-Content (Join-Path $here "VERSION") -Raw).Trim()
Write-Host "VERSION $Version"

$pack = @(
  "VERSION",
  "server.mjs",
  "rclone-job.mjs",
  "scan-dupes.mjs",
  "thumbs.mjs",
  "update-then-open.sh",
  "install-mac.sh",
  "ATLAS Inbox.command",
  "env.example",
  "LEIA_DANIEL.md",
  "ESTADO.md"
)

if (Test-Path $git) {
  if (-not (Test-Path (Join-Path $here ".git"))) {
    Write-Host "git init (repo só desta pasta)"
    & $git init -b main | Out-Null
  }
  & $git add -A
  $st = & $git status --porcelain
  if ($st) {
    & $git commit -m "inbox-mac $Version"
  }
  $origin = & $git remote 2>$null
  if ($origin -match "origin") {
    & $git push -u origin HEAD
  } else {
    Write-Host "sem remote git — só B2 desta vez (gh não está neste PC)"
  }
}

$dest = "$remoteB2/current"
foreach ($rel in $pack) {
  $src = Join-Path $here $rel
  if (-not (Test-Path $src)) { throw "falta $rel" }
  & $rclone copy $src $dest --checksum --fast-list --retries 3
  if ($LASTEXITCODE -ne 0) { throw "rclone copy falhou: $rel" }
}
& $rclone copy (Join-Path $here "public") "$dest/public" --checksum --fast-list --retries 3
if ($LASTEXITCODE -ne 0) { throw "rclone copy public falhou" }

$verFile = Join-Path $env:TEMP "atlas-inbox-version.txt"
[IO.File]::WriteAllText($verFile, $Version + "`n")
& $rclone copyto $verFile "$remoteB2/version.txt"
if ($LASTEXITCODE -ne 0) { throw "rclone version.txt falhou" }

$check = (& $rclone cat "$remoteB2/version.txt").Trim()
if ($check -ne $Version) { throw "version.txt no B2 e local diferem: '$check' vs '$Version'" }
Write-Host "publicado $Version — próximo clique do Victor pega"
Write-Host "B2 $remoteB2"
