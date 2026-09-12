#!/bin/bash
# Sobe a pasta TRANSFER (ou o caminho passado) pro B2.
# Nunca sync. Nunca --delete.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

if [ "$#" -gt 1 ]; then
  echo "Só um caminho. Sem flags extra."
  exit 1
fi

SRC="${1:-$HOME/ATLAS/TRANSFER}"
DAY="$(date +%Y-%m-%d)"
DEST="b2:atlas-victor-bruto/YT-MAIN/00_INBOX/${DAY}/"

case "$DEST" in
  b2:atlas-victor-bruto/YT-MAIN/00_INBOX/20[0-9][0-9]-[0-1][0-9]-[0-3][0-9]/) ;;
  *)
    echo "destino recusado"
    exit 1
    ;;
esac

if [ ! -d "$SRC" ]; then
  echo "Pasta não existe: $SRC"
  echo "Cria ~/ATLAS/TRANSFER ou passa o caminho:"
  echo "  bash ~/ATLAS/inbox-mac/enviar-b2.sh /caminho/da/pasta"
  exit 1
fi

if ! command -v rclone >/dev/null 2>&1; then
  echo "rclone não está instalado. Roda bash install-drive.sh"
  exit 1
fi

count="$(find "$SRC" -type f ! -name '.DS_Store' ! -name '._*' | wc -l | tr -d ' ')"
if [ "$count" = "0" ]; then
  echo "Pasta vazia: $SRC"
  echo "Copia os arquivos pra cá e clica de novo."
  exit 1
fi

LOGDIR="${HOME}/ATLAS/inbox-mac/data/logs"
mkdir -p "$LOGDIR"
HOST="$(hostname -s 2>/dev/null || hostname | tr -d '[:space:]')"
LOG="${LOGDIR}/enviar-${HOST}-$(date +%Y%m%d-%H%M%S).log"

{
  echo "De:  $SRC"
  echo "Pra: $DEST"
  echo "Arquivos: $count"
  echo "Starlink: se o % cair, é retry. Não fecha. Não clica Mandar de novo."
  echo
} | tee "$LOG"

set +e
rclone copy "$SRC" "$DEST" \
  --progress \
  --fast-list \
  --size-only \
  --ignore-existing \
  --transfers 2 \
  --checkers 2 \
  --b2-upload-concurrency 2 \
  --multi-thread-streams 1 \
  --disable-http2 \
  --retries 20 \
  --low-level-retries 10 \
  --retries-sleep 15s \
  --timeout 5m \
  --contimeout 60s \
  --stats 5s \
  --exclude ".DS_Store" \
  --exclude "._*" \
  --exclude ".Trash/**" 2>&1 | tee -a "$LOG"
rc="${PIPESTATUS[0]}"
set -e

rclone copyto "$LOG" "b2:atlas-victor-bruto/YT-MAIN/00_APPS/inbox-mac/ops/$(basename "$LOG")" \
  --retries 2 --timeout 30s >/dev/null 2>&1 || true

if [ "${rc}" -ne 0 ]; then
  echo
  echo "Falhou (código ${rc}). Log foi pro B2."
  exit "${rc}"
fi

echo
echo "Pronto. Abre ATLAS Drive e olha 00_INBOX/${DAY}/"
