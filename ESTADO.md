# Inbox + Drive — memória canônica

**Atualizado:** 2026-09-12  
**Código (Windows):** `C:\Users\Daniel\Desktop\Projeto Vitor\07_Execucao\B0_Infra\inbox-mac`  
**GitHub privado:** https://github.com/dhub7/atlas-inbox-mac  
**B2 app:** `b2:atlas-victor-bruto/YT-MAIN/00_APPS/inbox-mac/` (`version.txt` + `current/`)  
**Versão local:** `2026.09.12.1` (Erica Drive; ainda não precisa publicar no Mac do Victor)  
**Mac Victor:** `~/ATLAS/inbox-mac` · ícone Desktop `ATLAS Inbox.command` — **não mexer**  
**Mac Erica:** `bash install-drive.sh` · cola em `ERICA_TERMINAL.md`  
**Handoff sessão:** `~\.claude\session-data\2026-09-12-atlas-inbox-drive-session.tmp`

Junction: `Desktop\Projeto Victor` → `Projeto Vitor`.

---

## Atualizar sem ela mexer

Daniel: `.\publicar.ps1` nesta pasta. Erica: clica **ATLAS Drive** ou **Mandar B2** — o ícone puxa `00_APPS/inbox-mac/current/`. Sem git no Mac dela. Sem AirDrop.

Log do Mandar sobe sozinho pra `YT-MAIN/00_APPS/inbox-mac/ops/`. Daqui: `.\puxar-logs.ps1`. No Drive, botão **Log**.

## Erica agora (essencial)

Footage **já está no Mac dela** → pasta `~/ATLAS/TRANSFER` → clique **Mandar pro B2** → `YT-MAIN/00_INBOX/{hoje}/`. Drive = ícone **ATLAS Drive** (`/drive`). Inbox stand-by. Call: `ERICA_TERMINAL.md`.

## O que é

App **local** (Mac/Windows): pasta TRANSFER + `rclone copy` → bucket `atlas-victor-bruto`. Drive lista/organiza o B2. Só `127.0.0.1`. LucidLink = outro disco (proxies Resolve). **Não misturar.**

Hetzner `:8088` = arquivo solto no browser. **Não** dump TB / arquivo 10 GB+.

10 GB+: no Inbox local **sim** (rclone em fatias, B2 large file). Não testámos empiricamente um clip de 10 GB; GoPro do Victor era menor.

---

## Como se publica (Daniel)

```
cd "C:\Users\Daniel\Desktop\Projeto Vitor\07_Execucao\B0_Infra\inbox-mac"
.\publicar.ps1
```

GitHub **e** B2. Sem `.env`, sem `bin/`, sem `data/`.

Victor: dois cliques no ícone. Se `version.txt` ≠ disco → notifica, `rclone copy` (não sync), reinicia Node se **não** houver job running/queued/**paused**.

---

## Visual

**As duas telas = Mac OS 9 Platinum** (cinza, title listrado, desktop roxo). Daniel curtiu o mock e unificou Inbox+Drive nisso.

Mocks extra (não funcionam): `/looks.html`, `/mac9-inbox.html`, `/mac9-drive.html`.

Hetzner inbox/public ainda é papel + Drive Win98 — **não** é o app do Mac.

---

## O que já funciona

- Loopback sem pedir chave
- Escolher pasta nativa (Finder / diálogo Windows)
- `rclone copy` **sem** `--delete`; retoma o que já subiu
- Duplicados: mesmo nome+tamanho → ignorar / substituir / outro nome `(2)`
- Progresso: %, GB, velocidade, ETA (`\r` do rclone)
- Drive: clique entra; ícones/lista; du de pasta; thumb ffmpeg (fila 2); preview
- Jobs: pausar / cancelar / retomar / reiniciar / verificar / zerar thumbs
- Log: `data/ops.jsonl` (redacted). Botão **Mandar log** → B2 `00_APPS/inbox-mac/ops/`. Daqui: `.\puxar-logs.ps1` → issue GitHub
- Allowlist Drive **não** inclui `00_APPS` (pacote do app invisível)
- GitHub: `dhub7` logado; repo criado e push ok (`a906108` … `789c25d`)

## Mac Victor — fatos

- Homebrew, node, rclone instalados. `rclone lsd` vê `YT-MAIN` e `dropbox-mirror`
- LaunchAgent `com.atlas.inbox` (KeepAlive). `EADDRINUSE` = Node já no ar (bom)
- Updater **instalado** (12/09): `update-then-open.sh` existe; `chmod` ok
- Dois ícones no Desktop: ficar o **comando** cujo conteúdo tem `update-then-open.sh`; lixo o antigo
- OZARK: pedaços no B2 `YT-MAIN/00_INBOX/2026-09-08/` e `2026-09-11/OZARK/`. ~3 TB RAW no HD, não no Dropbox
- Popup “Backblaze Permissions” = **backup** do Mac, não B2. Fechar

## MCP B2 (Grok, 12/09)

- Oficial `@backblaze-labs/b2-mcp` **0.2.1**
- Launcher: `C:\Users\Daniel\.grok\mcp\b2-mcp-launch.ps1` lê rclone `[b2]`, **não** grava chave no `config.toml`
- `B2_DESTRUCTIVE_POLICY=confirm`
- `grok mcp doctor backblaze-b2`: 37 tools, handshake OK
- **Precisa de sessão Grok nova** pra as tools aparecerem neste chat

---

## Armadilhas (não repetir)

| Sintoma | Causa | Correção |
|---|---|---|
| `zsh: no matches found: data/**` | zsh come `**` | `--exclude 'data/**'` **com aspas** |
| `cp: command not found` | `export PATH=...$PATH0` (zero) tirou `/bin` | PATH com `/usr/bin:/bin`; usar `/bin/cp` |
| `zsh: bad pattern` `[200~` | colar PDF ou `$()` | uma linha; sem eval brew se PATH já tem homebrew |
| `not found` no Enviar | JS novo + Node **velho na RAM** | clique no ícone (updater 11.6 compara health vs VERSION); se falhar `/usr/bin/killall node` **só sem upload** |
| Bootstrap não reiniciou Node | disco já era a mesma versão da nuvem | 11.6: se live ≠ disk, restart |
| Dois ícones | `cp` do `.command` + atalho antigo | um só: o que tem `update-then-open.sh` |
| Pause não para | SIGSTOP no `caffeinate`, rclone filho segue | **ainda aberto** (plano revisão P0) |
| Thumbs 🎬 no Mac | `brew install ffmpeg` **não** está no install | **ainda aberto** |
| `rclone copyto` + `--exclude` | filters vs single file | copyto **sem** exclude |
| Progresso 0% | rclone escreve `\r` | `parseProgressChunk` |

PDF `Sobe_OZARK_no_Backblaze.pdf` **aposentado**. Telegram quieto até **manda**. Sem `--delete`. Sem porta na Starlink. Sem Grok no Mac do Victor.

---

## Erica M5 Max 128 GB RAM (pesquisa 12/09, plano abandonado na UI — verdades ficam)

- 128 GB = **RAM**, não SSD. Não copiar o HD inteiro no boot sem medir.
- Mais rápido/seguro: Thunderbolt HD → volume INGEST na Erica → `rclone copy` (não sync delete) → B2. HD não formata até checksum.
- MCP oficial no Grok (já instalado). Infimount = piloto UI, MCP **off**, nunca no RAW master.
- Lucid = proxy. Suite/ExpanDrive no RAW = armadilha.

---

## Revisão Inbox/Drive — ainda NÃO feito (próxima janela)

P0: ffmpeg no Mac; pause no processo rclone de verdade; verify 3 TB = size-only default; update bloqueia também `paused`.  
P1: Inbox só envia (sem mini-Drive); busca na pasta; lixeira `00_TRASH`; “net caiu” / “liga o HD”.  
P2: thumbs só visíveis; du de pasta enorme sob demanda; preview sem preload de 10 vídeos; fila de jobs.

---

## Próximo clique (nova janela)

1. Call Erica: colar `ERICA_TERMINAL.md`
2. AirDrop da pasta `inbox-mac` (sem bin/env/data)
3. Teste: 1 arquivo em `~/ATLAS/TRANSFER` → Mandar pro B2 → Drive
4. Victor não se mexe. Não publicar nesta fatia a menos que queira o Drive no Mac dele também.
