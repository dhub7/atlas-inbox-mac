# Puxa logs do B2 e abre issue no GitHub (sanitizados).
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
$rclone = Join-Path $here "bin\rclone.exe"
$gh = Join-Path $here "bin\gh.exe"
$dest = Join-Path $here "data\ops-from-b2"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
& $rclone copy "b2:atlas-victor-bruto/YT-MAIN/00_APPS/inbox-mac/ops/" $dest --retries 3
$files = Get-ChildItem $dest -File | Where-Object { $_.Extension -in ".jsonl", ".log" }
if (-not $files) { Write-Host "nenhum log no B2 ainda"; exit 0 }
$body = New-Object System.Text.StringBuilder
[void]$body.AppendLine("Logs Inbox (redacted).")
foreach ($f in $files | Sort-Object LastWriteTime -Descending | Select-Object -First 5) {
  [void]$body.AppendLine("")
  [void]$body.AppendLine("## $($f.Name)")
  [void]$body.AppendLine('```')
  $tail = Get-Content $f.FullName -Tail 80
  [void]$body.AppendLine(($tail -join "`n"))
  [void]$body.AppendLine('```')
}
$tmp = Join-Path $env:TEMP "atlas-ops-issue.md"
[IO.File]::WriteAllText($tmp, $body.ToString())
& $gh issue create --repo dhub7/atlas-inbox-mac --title "ops log $(Get-Date -Format s)" --body-file $tmp
Write-Host "issue criada. logs em $dest"
