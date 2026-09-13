#!/bin/bash
# Clique do Victor. Fail-open: se a net cair, abre o app que ja esta.
# Nao reinicia o node se tiver envio em curso.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

APP="${HOME}/ATLAS/inbox-mac"
REMOTE="b2:atlas-victor-bruto/YT-MAIN/00_APPS/inbox-mac"

aviso() {
  osascript -e "display dialog \"$1\" buttons {\"OK\"} default button 1 with title \"ATLAS\"" >/dev/null 2>&1 || true
}

envio_em_curso() {
  if pgrep -f "[r]clone copy /" >/dev/null 2>&1; then
    return 0
  fi
  node -e '
    fetch("http://127.0.0.1:8088/api/jobs")
      .then((r) => r.json())
      .then((d) => {
        const live = (d.jobs || []).some((j) => j.status === "running" || j.status === "queued" || j.status === "paused");
        process.exit(live ? 0 : 1);
      })
      .catch(() => process.exit(1));
  ' >/dev/null 2>&1
}

restart_node() {
  launchctl kickstart -k "gui/$(id -u)/com.atlas.inbox" >/dev/null 2>&1 || /usr/bin/killall node >/dev/null 2>&1 || true
  sleep 1
}

disk_version() {
  tr -d '[:space:]' < "${APP}/VERSION" 2>/dev/null || true
}

live_version() {
  curl -fsS "http://127.0.0.1:8088/health" 2>/dev/null | node -e '
    let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
      try { const j=JSON.parse(s); process.stdout.write(String(j.version||"")); }
      catch { /* ignore */ }
    });
  ' 2>/dev/null || true
}

update() {
  command -v rclone >/dev/null 2>&1 || return 0
  if envio_em_curso; then
    aviso "Tem envio no Terminal. A atualização entra no próximo clique, quando terminar."
    return 0
  fi
  local new old
  new="$(rclone cat "${REMOTE}/version.txt" --timeout 5s --retries 1 2>/dev/null | tr -d '[:space:]')"
  old="$(tr -d '[:space:]' < "${APP}/VERSION" 2>/dev/null || true)"
  if [ -z "${new}" ]; then
    aviso "Não consegui falar com o B2 agora. Abrindo o ATLAS que já está no Mac."
    return 0
  fi
  if [ "${new}" = "${old}" ]; then
    aviso "ATLAS já está na versão ${old}."
    return 0
  fi
  aviso "ATLAS vai atualizar agora para ${new}."
  rclone copy "${REMOTE}/current/" "${APP}/" \
    --checksum --fast-list --retries 2 \
    --exclude '.env' \
    --exclude 'data/**' \
    --exclude 'bin/**' \
    --exclude '.git/**' \
    >/dev/null 2>&1 || true
  chmod +x "${APP}/update-then-open.sh" "${APP}/enviar-b2.sh" 2>/dev/null || true
  for n in "ATLAS Inbox.command" "ATLAS Drive.command" "ATLAS Mandar B2.command"; do
    if [ -f "${HOME}/Desktop/${n}" ] && [ -f "${APP}/${n}" ]; then
      cp "${APP}/${n}" "${HOME}/Desktop/${n}"
      chmod +x "${HOME}/Desktop/${n}"
    fi
  done
  restart_node
  aviso "ATLAS atualizado para ${new}."
}

update

# JS novo + Node velho na memoria = API "not found"
if ! envio_em_curso; then
  disk="$(disk_version)"
  live="$(live_version)"
  if [ -n "${disk}" ] && [ "${live}" != "${disk}" ]; then
    aviso "Reiniciando o ATLAS pra casar a versão."
    restart_node
  fi
fi

for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  curl -fsS "http://127.0.0.1:8088/health" >/dev/null 2>&1 && break
  sleep 0.4
done

case "${ATLAS_OPEN:-}" in
  /drive) OPEN="/drive" ;;
  *) OPEN="" ;;
esac

if [ "${ATLAS_SKIP_OPEN:-}" = "1" ]; then
  exit 0
fi

if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  open -na "Google Chrome" --args --app="http://127.0.0.1:8088${OPEN}"
else
  open "http://127.0.0.1:8088${OPEN}"
fi
