# O que colar no Terminal da Erica (uma vez)

Chaves Backblaze só no privado. Sem `$()`. Sem PDF.

## 1. AirDrop

Manda a pasta `inbox-mac` (sem `bin\`, sem `.env`, sem `data\`). Ela coloca em Downloads.

## 2. Terminal — instalação

As duas strings vêm do `rclone.conf` do Daniel, bloco `[b2]`: `account` e `key`. Não usar `_` nem `…`.

```
cd ~/Downloads/inbox-mac
export B2_KEY_ID='cola_o_account'
export B2_APPLICATION_KEY='cola_a_key'
bash install-drive.sh
```

Se deu `401 bad_auth_token` (remote `_` / `_`):

```
rclone config delete b2
export B2_KEY_ID='cola_o_account'
export B2_APPLICATION_KEY='cola_a_key'
bash install-drive.sh
```

Senha do Mac pode pedir. Enquanto digita, não aparece letra. Enter no fim.

Se a Apple abrir “Ferramentas de linha de comando”: Instalar, esperar, rodar o `bash install-drive.sh` de novo.

## 3. Conferir

```
rclone lsd b2:atlas-victor-bruto
curl -s http://127.0.0.1:8088/health
```

Tem que aparecer `YT-MAIN` e `"ok":true`.

## 4. Uso (sem Terminal)

1. Footage já está no Mac dela → copiar pra `ATLAS/TRANSFER` (Finder: pasta do usuário → ATLAS → TRANSFER).
2. Dois cliques em **ATLAS Mandar B2**.
3. Dois cliques em **ATLAS Drive** — vê `00_INBOX` / data de hoje.

Se o footage já está em outra pasta (não precisa copiar pra TRANSFER):

```
bash ~/ATLAS/inbox-mac/enviar-b2.sh "/Users/erica/CAMINHO/DA/PASTA"
```

Mandar B2: pasta por pasta. Pequenos (<100 MB) rclone. Gordos: B2 resume, **32 MB × 3 paralelo** em arquivo novo (retoma o tamanho antigo se já tiver pedaço no B2). Pipe: list_parts + backoff, não pula. O clique **já atualiza** o app do B2 antes de enviar.

## Se o Terminal mostrar ERROR / % caindo

É Starlink, não arquivo duplicado. Deixa aberto. Não clica Mandar de novo.

Próximo lote: só clicar **ATLAS Mandar B2**. O ícone puxa a versão nova do B2 sozinho. Sem AirDrop, sem copiar script.

## Não fazer

- `rclone sync`
- `--delete`
- LucidLink
- Inbox (ícone Enviar)
