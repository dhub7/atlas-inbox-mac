#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
echo "ATLAS teste: um arquivo grande, fatias 8 MB, do zero."
echo "Pode fechar o Mandar B2. Deixa ESTA janela aberta ate FECHOU."
echo
pkill -f "enviar-b2.sh" 2>/dev/null || true
pkill -f "b2-resume-upload.py" 2>/dev/null || true
sleep 1
mkdir -p "$HOME/ATLAS/inbox-mac/data/logs"
LOG="$HOME/ATLAS/inbox-mac/data/logs/teste-gordo.log"
LIVE="b2:atlas-victor-bruto/YT-MAIN/00_APPS/inbox-mac/ops/enviar-live.log"
(
  while true; do
    sleep 20
    rclone copyto "$LOG" "$LIVE" --retries 1 --timeout 15s >/dev/null 2>&1 || true
  done
) &
SHIP=$!
python3 "$HOME/ATLAS/inbox-mac/b2-resume-upload.py" --pick-test --fresh 2>&1 | tee "$LOG"
kill "$SHIP" 2>/dev/null || true
rclone copyto "$LOG" "$LIVE" --retries 1 --timeout 15s >/dev/null 2>&1 || true
echo
echo "Fim. Se apareceu FECHOU, o arquivo esta no Drive."
read -r _
