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
  [IO.File]::WriteAllText((Join-Path $here "VERSION"), $Version.Trim() + "`n")
} else {
  $cur = (Get-Content (Join-Path $here "VERSION") -Raw).Trim()
  if ($cur -match '^(\d{4}\.\d{2}\.\d{2})\.(\d+)$') {
    $n = [int]$Matches[2] + 1
    $Version = "$($Matches[1]).$n"
  } else {
    $Version = Get-Date -Format "yyyy.MM.dd.1"
  }
  [IO.File]::WriteAllText((Join-Path $here "VERSION"), $Version + "`n")
}
$Version = (Get-Content (Join-Path $here "VERSION") -Raw).Trim()
Write-Host "VERSION $Version"

$pack = @(
  "VERSION",
  "server.mjs",
  "rclone-job.mjs",
  "scan-dupes.mjs",
  "thumbs.mjs",
  "ops-log.mjs",
  "update-then-open.sh",
  "install-mac.sh",
  "install-drive.sh",
  "enviar-b2.sh",
  "enviar-b2.ps1",
  "b2-resume-upload.py",
  "ATLAS Inbox.command",
  "ATLAS Drive.command",
  "ATLAS Mandar B2.command",
  "env.example",
  "LEIA_DANIEL.md",
  "ESTADO.md",
  "ERICA_TERMINAL.md",
  "COMO_FUNCIONA.md",
  "BOOTSTRAP_DEPOIS.command",
  "README.md",
  "VICTOR_TERMINAL.md",
  "GITHUB.md"
)

if (Test-Path $git) {
  if (-not (Test-Path (Join-Path $here ".git"))) {
    Write-Host "git init (repo so desta pasta)"
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
    Write-Host "sem remote git - so B2 desta vez"
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
if ($check -ne $Version) { throw "version.txt no B2 e local diferem: $check vs $Version" }
Write-Host "publicado $Version - proximo clique do Victor pega"
Write-Host "B2 $remoteB2"
