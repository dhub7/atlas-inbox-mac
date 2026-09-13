#!/bin/bash
# Sobe a pasta TRANSFER (ou o caminho passado) pro B2.
# Nunca sync. Nunca --delete.
# Pequenos (<500M): 4 em paralelo. Gordos (>=500M): um a um.
# Vigia: 0 B/s ~45s → reinicia a mesma fase (ignore-existing).
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"

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
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 não está instalado. Roda bash install-drive.sh"
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
  echo "Pasta por pasta. Pequenos: rclone 4 paralelo. Gordos: B2 resume de partes 32MB (não recomeça o arquivo)."
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
  line="$(grep -E 'MiB /|GiB /|TiB /' "${LOG}" 2>/dev/null | tail -1 || true)"
  [ -n "${line}" ] || return 1
  echo "${line}" | grep -qE ', 100%' && return 1
  echo "${line}" | grep -qE ',[[:space:]]*0 B/s|,[[:space:]]*0 Byte/s'
}

kill_rclone() {
  local rpid="$1"
  kill "${rpid}" 2>/dev/null || true
  sleep 2
  kill -9 "${rpid}" 2>/dev/null || true
  wait "${rpid}" 2>/dev/null || true
  rm -f "${PIDFILE}"
}

run_copy() {
  local tfer="$1"
  local ucon="$2"
  shift 2
  set +e
  rclone copy "${COPY_SRC:-$SRC}" "${COPY_DEST:-$DEST}" \
    --progress \
    --fast-list \
    --size-only \
    --ignore-existing \
    --order-by size,ascending \
    --transfers "${tfer}" \
    --checkers 4 \
    --b2-upload-concurrency "${ucon}" \
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
    --exclude ".Trash/**" \
    "$@" > >(tee -a "$LOG") 2>&1 &
  local rpid=$!
  echo "${rpid}" > "${PIDFILE}"
  local stall=0
  while kill -0 "${rpid}" 2>/dev/null; do
    sleep 15
    if stats_zero; then
      stall=$((stall + 1))
      echo "vigia: 0 B/s (${stall}/3) tfer=${tfer}" | tee -a "$LOG"
    else
      stall=0
    fi
    if [ "${stall}" -ge 3 ]; then
      echo "vigia: ~45s a 0 B/s — reinicio a mesma fase" | tee -a "$LOG"
      kill_rclone "${rpid}"
      return 99
    fi
  done
  wait "${rpid}"
  local rc=$?
  rm -f "${PIDFILE}"
  return "${rc}"
}

run_phase() {
  local nome="$1"
  local tfer="$2"
  local ucon="$3"
  shift 3
  local n=0
  local MAX=40
  local rc=1
  echo "=== ${nome} ===" | tee -a "$LOG"
  while [ "${n}" -lt "${MAX}" ]; do
    n=$((n + 1))
    echo "--- ${nome} tentativa ${n}/${MAX} $(date -u +%Y-%m-%dT%H:%M:%SZ) ---" | tee -a "$LOG"
    run_copy "${tfer}" "${ucon}" "$@"
    rc=$?
    if [ "${rc}" -eq 0 ]; then
      echo "${nome} ok." | tee -a "$LOG"
      return 0
    fi
    echo "${nome} rc=${rc}. Espero 8s e repito (não remanda o que fechou)." | tee -a "$LOG"
    sleep 8
  done
  return "${rc}"
}

run_gordos_phase() {
  local nome="$1"
  local n=0
  local MAX=40
  local rc=1
  local prefix="${COPY_DEST#b2:atlas-victor-bruto/}"
  echo "=== ${nome}/gordos (resume B2 32MB) ===" | tee -a "$LOG"
  while [ "${n}" -lt "${MAX}" ]; do
    n=$((n + 1))
    echo "--- ${nome}/gordos tentativa ${n}/${MAX} $(date -u +%Y-%m-%dT%H:%M:%SZ) ---" | tee -a "$LOG"
    python3 "$HERE/b2-resume-upload.py" \
      --src "$COPY_SRC" \
      --b2-prefix "$prefix" \
      --min-bytes 524288000 \
      --max-depth 1 2>&1 | tee -a "$LOG"
    rc="${PIPESTATUS[0]}"
    if [ "${rc}" -eq 0 ]; then
      echo "${nome}/gordos ok." | tee -a "$LOG"
      return 0
    fi
    echo "${nome}/gordos rc=${rc}. Espero 8s (retoma partes)." | tee -a "$LOG"
    sleep 8
  done
  return "${rc}"
}

set +e
rc=0
while IFS= read -r dir; do
  files="$(find "$dir" -maxdepth 1 -type f ! -name '.DS_Store' ! -name '._*' | wc -l | tr -d ' ')"
  if [ "${files}" = "0" ]; then
    continue
  fi
  if [ "$dir" = "$SRC" ]; then
    COPY_SRC="$SRC"
    COPY_DEST="$DEST"
    nome="."
  else
    rel="${dir#${SRC}/}"
    COPY_SRC="$dir"
    COPY_DEST="${DEST}${rel}/"
    nome="$rel"
  fi
  echo ">>> pasta ${nome}  arquivos=${files}" | tee -a "$LOG"
  run_phase "${nome}/pequenos" 4 4 --max-size 500M --max-depth 1
  r1=$?
  run_gordos_phase "${nome}"
  r2=$?
  if [ "${r1}" -ne 0 ]; then
    rc="${r1}"
  elif [ "${r2}" -ne 0 ] && [ "${rc}" -eq 0 ]; then
    rc="${r2}"
  fi
done < <(find "$SRC" -type d ! -path '*/.Trash*' | sort)
set -e

echo "fim=$(date -u +%Y-%m-%dT%H:%M:%SZ) rc=${rc}" | tee -a "$LOG"
ship_log

if [ "${rc}" -ne 0 ]; then
  echo
  echo "Falhou (código ${rc}). Log no B2 (enviar-live.log)."
  exit "${rc}"
fi

echo
echo "Pronto. Abre ATLAS Drive e olha 00_INBOX/${DAY}/"
