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
python3 "$HOME/ATLAS/inbox-mac/b2-resume-upload.py" --pick-test --fresh 2>&1 | tee "$LOG"
echo
echo "Fim. Se apareceu FECHOU, o arquivo esta no Drive."
read -r _
