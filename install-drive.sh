#!/bin/bash
# ATLAS Drive no Mac da Erica. Idempotente. Inbox fica stand-by.
set -euo pipefail

echo "ATLAS Drive — instalação no Mac da Erica"
echo "Senha do Mac pode ser pedida. Enquanto digita, não aparece letra. Enter no fim."
echo

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Instalando ferramentas de linha de comando da Apple (pode demorar)..."
  xcode-select --install || true
  echo "Se abriu uma janela da Apple: clica Instalar, espera acabar, roda este script de novo."
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Instalando Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    grep -q 'brew shellenv' "$HOME/.zprofile" 2>/dev/null || echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
  fi
fi

eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || true

echo "Instalando rclone, node e ffmpeg..."
brew install rclone node ffmpeg

if ! rclone version >/dev/null 2>&1; then
  echo "rclone não entrou no PATH. Fecha o Terminal, abre de novo, roda o script outra vez."
  exit 1
fi

dummy_key() {
  case "${1:-}" in
    ""|"_"|"…"|"..."|"xxx"|"XXX"|"change-me") return 0 ;;
  esac
  return 1
}

if dummy_key "${B2_KEY_ID:-}" || dummy_key "${B2_APPLICATION_KEY:-}"; then
  if rclone listremotes 2>/dev/null | grep -q '^b2:'; then
    echo "Remote b2 já existe. Vou testar."
  else
    echo "Falta a chave Backblaze de verdade (não é _ nem …)."
    echo "No privado, o Daniel manda as duas linhas. Aí cola:"
    echo "  export B2_KEY_ID='cola_o_account'"
    echo "  export B2_APPLICATION_KEY='cola_a_key'"
    echo "  bash install-drive.sh"
    exit 1
  fi
elif rclone listremotes 2>/dev/null | grep -q '^b2:'; then
  echo "Remote b2 já existia. Recriando com a chave nova."
  rclone config delete b2 >/dev/null 2>&1 || true
  rclone config create b2 b2 account "$B2_KEY_ID" key "$B2_APPLICATION_KEY"
else
  rclone config create b2 b2 account "$B2_KEY_ID" key "$B2_APPLICATION_KEY"
fi

echo "Testando o arquivo na nuvem..."
if ! rclone lsd b2:atlas-victor-bruto; then
  echo
  echo "Chave Backblaze recusada (401). Apaguei o remote quebrado."
  rclone config delete b2 >/dev/null 2>&1 || true
  echo "Cola as chaves reais no privado e roda de novo:"
  echo "  export B2_KEY_ID='cola_o_account'"
  echo "  export B2_APPLICATION_KEY='cola_a_key'"
  echo "  bash install-drive.sh"
  exit 1
fi
rclone lsd b2:atlas-victor-bruto | grep -q YT-MAIN || {
  echo "Não achei YT-MAIN. Chave errada ou bucket errado. Para e avisa o Daniel."
  exit 1
}

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/ATLAS/inbox-mac"
TRANSFER="$HOME/ATLAS/TRANSFER"
mkdir -p "$DEST" "$TRANSFER"
rsync -a --delete \
  --exclude '.env' --exclude 'data' --exclude 'bin' --exclude '.git' \
  "$SRC_DIR/" "$DEST/"

if [ ! -f "$DEST/.env" ]; then
  TOKEN="$(python3 -c 'import secrets; print(secrets.token_hex(8))' 2>/dev/null || openssl rand -hex 8)"
  cat > "$DEST/.env" <<EOF
PORT=8088
INBOX_TOKEN=$TOKEN
B2_BUCKET=atlas-victor-bruto
PUBLIC_ORIGIN=http://127.0.0.1:8088
RCLONE_REMOTE=b2
BIND=127.0.0.1
EOF
  chmod 600 "$DEST/.env"
  echo "Criei a chave local do app."
else
  TOKEN="$(grep '^INBOX_TOKEN=' "$DEST/.env" | cut -d= -f2-)"
fi

NODE_BIN="$(command -v node)"
RCLONE_BIN="$(command -v rclone)"
if grep -q '^RCLONE_BIN=' "$DEST/.env"; then
  sed -i.bak "s|^RCLONE_BIN=.*|RCLONE_BIN=$RCLONE_BIN|" "$DEST/.env"
else
  echo "RCLONE_BIN=$RCLONE_BIN" >> "$DEST/.env"
fi
rm -f "$DEST/.env.bak"

PLIST="$HOME/Library/LaunchAgents/com.atlas.inbox.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$DEST/data"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.atlas.inbox</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>WorkingDirectory</key><string>$DEST</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$DEST/server.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StandardOutPath</key><string>$HOME/ATLAS/inbox-mac/data/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/ATLAS/inbox-mac/data/launchd.err.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

chmod +x "$DEST/update-then-open.sh" "$DEST/enviar-b2.sh" \
  "$DEST/ATLAS Drive.command" "$DEST/ATLAS Mandar B2.command" 2>/dev/null || true

DRIVE_ICON="$HOME/Desktop/ATLAS Drive.command"
cat > "$DRIVE_ICON" <<'EOF'
#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export ATLAS_OPEN=/drive
exec bash "$HOME/ATLAS/inbox-mac/update-then-open.sh"
EOF
chmod +x "$DRIVE_ICON"

MANDAR_ICON="$HOME/Desktop/ATLAS Mandar B2.command"
cat > "$MANDAR_ICON" <<'EOF'
#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export ATLAS_SKIP_OPEN=1
bash "$HOME/ATLAS/inbox-mac/update-then-open.sh" || true
exec bash "$HOME/ATLAS/inbox-mac/enviar-b2.sh"
EOF
chmod +x "$MANDAR_ICON"

echo
echo "Aguardando o Drive..."
sleep 1
curl -fsS "http://127.0.0.1:8088/health" || {
  echo "Servidor ainda não respondeu. Abre o ícone ATLAS Drive no Desktop mesmo assim."
}

echo
echo "Pronto."
echo "Pasta de envio: $TRANSFER"
echo "Desktop → ATLAS Drive  (ver e gerenciar)"
echo "Desktop → ATLAS Mandar B2  (subir o que está na pasta TRANSFER)"
echo "Inbox e LucidLink não se mexem."
