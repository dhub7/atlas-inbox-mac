#!/bin/bash
# Sobe a pasta TRANSFER (ou o caminho passado) pro B2.
# Nunca sync. Nunca --delete.
# Vigia: 0 B/s por ~2 min → mata o rclone e recomeça (ignore-existing).
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
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="${LOGDIR}/enviar-${HOST}-${STAMP}.log"
PIDFILE="${LOGDIR}/rclone.pid"
OPS="b2:atlas-victor-bruto/YT-MAIN/00_APPS/inbox-mac/ops"
LIVE="${OPS}/enviar-live.log"
ARCH="${OPS}/$(basename "$LOG")"

{
  echo "host=${HOST}"
  echo "De:  $SRC"
  echo "Pra: $DEST"
  echo "Arquivos: $count"
  echo "inicio=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Starlink: 3 arquivos / 4 partes. 0 B/s por 2 min = o Mandar reinicia sozinho."
  echo "Não fecha. Não clica Mandar de novo."
  echo
} | tee "$LOG"

ship_log() {
  rclone copyto "$LOG" "$LIVE" --retries 1 --low-level-retries 1 --timeout 15s --contimeout 8s >/dev/null 2>&1 || true
  rclone copyto "$LOG" "$ARCH" --retries 1 --low-level-retries 1 --timeout 15s --contimeout 8s >/dev/null 2>&1 || true
}

ship_log
(
  while true; do
    sleep 20
    ship_log
  done
) &
SHIP_PID=$!

cleanup() {
  kill "${SHIP_PID}" 2>/dev/null || true
  if [ -f "${PIDFILE}" ]; then
    kill "$(cat "${PIDFILE}")" 2>/dev/null || true
    rm -f "${PIDFILE}"
  fi
  ship_log
}
trap cleanup EXIT

echo "Log ao vivo no B2: YT-MAIN/00_APPS/inbox-mac/ops/enviar-live.log"
echo

stats_zero() {
  local line
  line="$(grep 'Transferred:' "${LOG}" 2>/dev/null | tail -1 || true)"
  [ -n "${line}" ] || return 1
  echo "${line}" | grep -qE ', 100%' && return 1
  echo "${line}" | grep -qE 'Transferred:.*,[[:space:]]*0 B/s|Transferred:.*,[[:space:]]*0 Byte/s'
}

run_copy() {
  set +e
  rclone copy "$SRC" "$DEST" \
    --progress \
    --fast-list \
    --size-only \
    --ignore-existing \
    --order-by size,descending \
    --transfers 3 \
    --checkers 2 \
    --b2-upload-concurrency 4 \
    --b2-chunk-size 32M \
    --b2-upload-cutoff 64M \
    --multi-thread-streams 1 \
    --disable-http2 \
    --retries 20 \
    --low-level-retries 10 \
    --retries-sleep 15s \
    --timeout 5m \
    --contimeout 60s \
    --stats 15s \
    --stats-one-line \
    --exclude ".DS_Store" \
    --exclude "._*" \
    --exclude ".Trash/**" > >(tee -a "$LOG") 2>&1 &
  local rpid=$!
  echo "${rpid}" > "${PIDFILE}"
  local stall=0
  while kill -0 "${rpid}" 2>/dev/null; do
    sleep 15
    if stats_zero; then
      stall=$((stall + 1))
      echo "vigia: 0 B/s (${stall}/8)" | tee -a "$LOG"
    else
      stall=0
    fi
    if [ "${stall}" -ge 8 ]; then
      echo "vigia: 2 min a 0 B/s — reinicio o rclone (não remanda o que já fechou)" | tee -a "$LOG"
      kill "${rpid}" 2>/dev/null || true
      sleep 2
      kill -9 "${rpid}" 2>/dev/null || true
      wait "${rpid}" 2>/dev/null || true
      rm -f "${PIDFILE}"
      return 99
    fi
  done
  wait "${rpid}"
  local rc=$?
  rm -f "${PIDFILE}"
  return "${rc}"
}

MAX=40
n=0
rc=1
set +e
while [ "${n}" -lt "${MAX}" ]; do
  n=$((n + 1))
  echo "--- tentativa ${n}/${MAX} $(date -u +%Y-%m-%dT%H:%M:%SZ) ---" | tee -a "$LOG"
  run_copy
  rc=$?
  if [ "${rc}" -eq 0 ]; then
    break
  fi
  if [ "${rc}" -eq 99 ]; then
    echo "rede zumbi. Espero 8s e subo de novo." | tee -a "$LOG"
    sleep 8
    continue
  fi
  echo "rclone saiu ${rc}. Espero 15s e subo de novo." | tee -a "$LOG"
  sleep 15
done
set -e

echo "fim=$(date -u +%Y-%m-%dT%H:%M:%SZ) rc=${rc} tentativas=${n}" | tee -a "$LOG"
ship_log

if [ "${rc}" -ne 0 ]; then
  echo
  echo "Falhou (código ${rc}) depois de ${n} tentativas. Log no B2 (enviar-live.log)."
  exit "${rc}"
fi

echo
echo "Pronto. Abre ATLAS Drive e olha 00_INBOX/${DAY}/"
