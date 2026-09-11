#!/bin/bash
# ATLAS Inbox no Mac do Victor. Idempotente. Não cola PDF.
set -euo pipefail

echo "ATLAS Inbox — instalação no Mac"
echo "Senha do Mac pode ser pedida. Enquanto digita, não aparece letra. Enter no fim."
echo

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

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

echo "Instalando rclone e node..."
brew install rclone node

if ! rclone version >/dev/null 2>&1; then
  echo "rclone não entrou no PATH. Fecha o Terminal, abre de novo, roda o script outra vez."
  exit 1
fi

if ! rclone listremotes 2>/dev/null | grep -q '^b2:'; then
  if [ -z "${B2_KEY_ID:-}" ] || [ -z "${B2_APPLICATION_KEY:-}" ]; then
    echo "Falta a chave Backblaze."
    echo "No Mac, no Terminal, cola (troca pelos valores que o Daniel mandou no privado):"
    echo "  export B2_KEY_ID='...'"
    echo "  export B2_APPLICATION_KEY='...'"
    echo "  bash install-mac.sh"
    exit 1
  fi
  rclone config create b2 b2 account "$B2_KEY_ID" key "$B2_APPLICATION_KEY"
fi

echo "Testando o arquivo na nuvem..."
rclone lsd b2:atlas-victor-bruto
rclone lsd b2:atlas-victor-bruto | grep -q YT-MAIN || {
  echo "Não achei YT-MAIN. Chave errada ou bucket errado. Para e avisa o Daniel."
  exit 1
}

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/ATLAS/inbox-mac"
mkdir -p "$DEST"
# copy app without secrets / job data
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
# rewrite rclone bin into env
if grep -q '^RCLONE_BIN=' "$DEST/.env"; then
  sed -i.bak "s|^RCLONE_BIN=.*|RCLONE_BIN=$RCLONE_BIN|" "$DEST/.env"
else
  echo "RCLONE_BIN=$RCLONE_BIN" >> "$DEST/.env"
fi
rm -f "$DEST/.env.bak"

PLIST="$HOME/Library/LaunchAgents/com.atlas.inbox.plist"
mkdir -p "$HOME/Library/LaunchAgents"
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

mkdir -p "$DEST/data"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

chmod +x "$DEST/update-then-open.sh" "$DEST/ATLAS Inbox.command" 2>/dev/null || true
ICON="$HOME/Desktop/ATLAS Inbox.command"
cat > "$ICON" <<'EOF'
#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
exec bash "$HOME/ATLAS/inbox-mac/update-then-open.sh"
EOF
chmod +x "$ICON"

echo
echo "Aguardando o app..."
sleep 1
curl -fsS "http://127.0.0.1:8088/health" || {
  echo "Servidor ainda não respondeu. Abre o ícone ATLAS Inbox no Desktop mesmo assim."
}

echo
echo "Pronto."
echo "Ícone: Desktop → ATLAS Inbox"
echo "Dois cliques. Escolher pasta. Enviar. Drive = ver pastas."
echo "LucidLink não se mexe."
