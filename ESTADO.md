# Inbox local — memória desta frente

**Atualizado:** 2026-09-11 (update no clique, v `2026.09.11.1`)  
**Pasta:** `07_Execucao/B0_Infra/inbox-mac/`  
**Windows (fonte da verdade do código):** `C:\Users\Daniel\Desktop\Projeto Vitor\07_Execucao\B0_Infra\inbox-mac`  
**Mac do Victor (instalação):** `~/ATLAS/inbox-mac` + ícone `~/Desktop/ATLAS Inbox.command`

O código no Windows **está na frente** do Mac. Recopiar a pasta e `killall node` no Mac quando for levar thumbs, duplicados, progresso e o Drive Win98 certo.

---

## O que é

App **neste computador** (Windows ou Mac): Inbox envia pasta via `rclone copy` pro Backblaze `atlas-victor-bruto`. Drive organiza o que já está lá. Só escuta `127.0.0.1`. LucidLink não se mexe.

Não é o site Hetzner `:8088` (browser upload, cai em TB). Aquele continua pra arquivo solto.

## Visual — não misturar

Fonte: `07_Execucao/B0_Infra/inbox/public/` (o que está no ar no Hetzner).

| Superfície | Pele |
|---|---|
| Inbox `/` | papel, IBM Plex, Source Serif, navy |
| Drive `/drive` | Windows 98 (teal `#008080`, Tahoma, bisel) |

São duas peles de propósito. Feature nova só **acrescenta** CSS no fim. Não unificar o Drive no papel.

## O que já funciona (testado neste Windows)

- Servidor Node `127.0.0.1:8088`, login dispensado em loopback
- Escolher pasta nativa (Finder no Mac / diálogo no Windows)
- `rclone copy` sem `--delete`; retoma o que já subiu
- Barra de envio: %, tamanho, velocidade, tempo, ETA
- Drive: um clique entra na pasta; ícones/lista; tamanho de pasta; thumb de vídeo (ffmpeg, cache em `data/thumbs/`); preview grande
- Duplicados: mesmo nome+tamanho → ignorar / substituir / outro nome (`arquivo (2).ext`)
- Teste real no B2: smoke + rename `smoke-windows (2).txt`

## Mac do Victor (10–11/09)

- Homebrew, node, rclone **instalados**. `rclone lsd` viu `YT-MAIN` e `dropbox-mirror`.
- LaunchAgent subiu (segunda `node` deu `EADDRINUSE` = já estava no ar).
- `ATLAS Inbox.command` existe no Desktop (não é app da Loja).
- Chrome abriu o Inbox. Ele já mandou OZARK (GoPro/WAV em `YT-MAIN/00_INBOX/2026-09-11/OZARK/`).
- PDF `Sobe_OZARK_no_Backblaze.pdf` **não usar** — colar o PDF no Terminal quebra (`zsh: bad pattern`, `[200~`).
- Popup “Backblaze Permissions Issue” = app de **backup** do Mac, não o B2. Fechar.

## OZARK

Episódio/lugar (~3 TB RAW). Não está no Dropbox compartilhado. Pedacinho já no B2 (08/09 pelo site, 11/09 pelo Inbox). Os 3 TB provavelmente em HD, não no SSD. O app aponta qualquer pasta.

## Como rodar

**Windows (Daniel):** `.\start-windows.ps1` → http://127.0.0.1:8088  
**Mac (depois de recopiar):** `killall node` (LaunchAgent sobe de novo) → ícone no Desktop.

Não colar comando com `$()` no Terminal do Victor (bracketed paste).

## Arquivos

| Arquivo | Papel |
|---|---|
| `server.mjs` | HTTP local + B2 Drive API + scan/jobs |
| `rclone-job.mjs` | copy sem `--delete`, progresso `\r` |
| `scan-dupes.mjs` | nome+tamanho → skip/replace/rename |
| `thumbs.mjs` | ffmpeg 1 frame, fila 2, cache |
| `install-mac.sh` | brew, rclone, LaunchAgent, ícone |
| `public/` | Inbox + Drive |
| `.env` | gitignore; não grupo |

Testes: `node --test test/rclone-job.test.mjs test/scan-dupes.test.mjs`

## Não fazer

- Telegram sem **manda**
- `--delete` no rclone
- Porta na Starlink
- Lucid / 598
- Logar conta Grok/Claude no Mac dele
- Mandar chave B2 no grupo
- Recortar Shorts neste fio
- Tratar o PDF como instalador

## Publicar daqui (Daniel)

```
cd Desktop\Projeto Vitor\07_Execucao\B0_Infra\inbox-mac
.\publicar.ps1
```

Sobe GitHub (quando houver remote) + B2 `YT-MAIN/00_APPS/inbox-mac/`. Fora da allowlist do Drive.

GitHub CLI está em `bin\gh.exe` mas **não logado**. Uma vez:

```
bin\gh.exe auth login
bin\gh.exe repo create atlas-inbox-mac --private --source=. --remote=origin --push
```

## Última vez no Mac (bootstrap do updater)

O `.env` e o LaunchAgent **ficam**. No Terminal dele, sem `$()`:

```
rclone copy b2:atlas-victor-bruto/YT-MAIN/00_APPS/inbox-mac/current/ ~/ATLAS/inbox-mac/ --exclude .env --exclude data/**
chmod +x ~/ATLAS/inbox-mac/update-then-open.sh
chmod +x ~/Desktop/ATLAS\ Inbox.command
killall node
```

Copiar também o `ATLAS Inbox.command` novo pro Desktop (o da pasta `current`). Depois disso, só clica. Se tiver versão nova, notifica e atualiza.

## Próximo nesta frente

1. Bootstrap no Mac (bloco acima) — última entrada remota
2. Daqui: `.\publicar.ps1` e pedir pra ele clicar de novo (tem que aparecer a versão no canto)
3. `gh auth login` + repo privado quando der
4. Dump grande do HD OZARK
