# Sobe o Drive (inbox-mac) pro Hetzner CX33. Nao mexe no Mac da Erica.
# Uso: .\publicar-hetzner.ps1
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$inbox = Join-Path (Split-Path $here -Parent) "inbox"
$key = Join-Path $env:USERPROFILE ".ssh\atlas_hetzner"
$hostName = "root@62.238.99.33"
$ssh = @("-i", $key, "-o", "StrictHostKeyChecking=accept-new")

if (-not (Test-Path $key)) { throw "falta $key" }

$files = @(
  "server.mjs",
  "rclone-job.mjs",
  "thumbs.mjs",
  "scan-dupes.mjs",
  "ops-log.mjs",
  "VERSION"
)
foreach ($f in $files) {
  $src = Join-Path $here $f
  if (-not (Test-Path $src)) { throw "falta $f" }
  & scp @ssh $src "${hostName}:/opt/atlas/inbox/$f"
  if ($LASTEXITCODE -ne 0) { throw "scp falhou: $f" }
}

$pub = Join-Path $here "public"
& scp @ssh -r $pub "${hostName}:/opt/atlas/inbox/"
if ($LASTEXITCODE -ne 0) { throw "scp public falhou" }

$svc = Join-Path $inbox "atlas-inbox.service"
& scp @ssh $svc "${hostName}:/opt/atlas/inbox/atlas-inbox.service"
if ($LASTEXITCODE -ne 0) { throw "scp service falhou" }

& ssh @ssh $hostName "mkdir -p /opt/atlas/inbox/data /opt/atlas/inbox/public; cp /opt/atlas/inbox/atlas-inbox.service /etc/systemd/system/atlas-inbox.service; systemctl daemon-reload; systemctl restart atlas-inbox; sleep 1; curl -sS http://127.0.0.1:8088/health; echo; echo URL=http://62.238.99.33:8088/drive?k=`$(grep '^INBOX_TOKEN=' /opt/atlas/inbox/.env | cut -d= -f2-)"
if ($LASTEXITCODE -ne 0) { throw "restart falhou" }
