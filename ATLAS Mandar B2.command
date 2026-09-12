#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export ATLAS_SKIP_OPEN=1
bash "$HOME/ATLAS/inbox-mac/update-then-open.sh" || true
exec bash "$HOME/ATLAS/inbox-mac/enviar-b2.sh"
