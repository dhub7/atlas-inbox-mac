#!/bin/bash
# Clique do Victor. Fail-open: se a net cair, abre o app que ja esta.
# Nao reinicia o node se tiver envio em curso.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

APP="${HOME}/ATLAS/inbox-mac"
REMOTE="b2:atlas-victor-bruto/YT-MAIN/00_APPS/inbox-mac"

envio_em_curso() {
  node -e '
    fetch("http://127.0.0.1:8088/api/jobs")
      .then((r) => r.json())
      .then((d) => {
        const live = (d.jobs || []).some((j) => j.status === "running" || j.status === "queued");
        process.exit(live ? 1 : 0);
      })
      .catch(() => process.exit(0));
  ' >/dev/null 2>&1
}

update() {
  command -v rclone >/dev/null 2>&1 || return 0
  if envio_em_curso; then
    osascript -e 'display notification "Envio em curso. Atualizo no proximo clique." with title "ATLAS"' >/dev/null 2>&1 || true
    return 0
  fi
  local new old
  new="$(rclone cat "${REMOTE}/version.txt" --timeout 5s --retries 1 2>/dev/null | tr -d '[:space:]')"
  old="$(tr -d '[:space:]' < "${APP}/VERSION" 2>/dev/null || true)"
  if [ -z "${new}" ]; then
    return 0
  fi
  if [ "${new}" = "${old}" ]; then
    return 0
  fi
  osascript -e 'display notification "ATLAS Inbox vai atualizar" with title "ATLAS"' >/dev/null 2>&1 || true
  rclone copy "${REMOTE}/current/" "${APP}/" \
    --checksum --fast-list --retries 2 \
    --exclude ".env" \
    --exclude "data/**" \
    --exclude "bin/**" \
    --exclude ".git/**" \
    >/dev/null 2>&1 || true
  chmod +x "${APP}/update-then-open.sh" "${HOME}/Desktop/ATLAS Inbox.command" 2>/dev/null || true
  launchctl kickstart -k "gui/$(id -u)/com.atlas.inbox" >/dev/null 2>&1 || killall node >/dev/null 2>&1 || true
  sleep 1
}

update

for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  curl -fsS "http://127.0.0.1:8088/health" >/dev/null 2>&1 && break
  sleep 0.4
done

if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  open -na "Google Chrome" --args --app="http://127.0.0.1:8088"
else
  open "http://127.0.0.1:8088"
fi
