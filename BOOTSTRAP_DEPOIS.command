#!/bin/bash
# Rodar NO MAC so DEPOIS do upload do OZARK acabar.
# Instala o updater. Nao mata envio em curso.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

busy="$(curl -fsS http://127.0.0.1:8088/api/jobs 2>/dev/null || true)"
echo "$busy" | grep -q '"status":"running"' && {
  osascript -e 'display dialog "Ainda tem envio em curso. Espera terminar e clica de novo." buttons {"OK"} default button 1' >/dev/null
  exit 0
}

rclone copy "b2:atlas-victor-bruto/YT-MAIN/00_APPS/inbox-mac/current/" "$HOME/ATLAS/inbox-mac/" \
  --checksum --exclude ".env" --exclude "data/**" --exclude "bin/**" --exclude ".git/**"

cp "$HOME/ATLAS/inbox-mac/ATLAS Inbox.command" "$HOME/Desktop/ATLAS Inbox.command"
chmod +x "$HOME/ATLAS/inbox-mac/update-then-open.sh" "$HOME/Desktop/ATLAS Inbox.command"

osascript -e 'display notification "Updater instalado. Proximo clique atualiza sozinho." with title "ATLAS"'
open -a Finder "$HOME/Desktop"
