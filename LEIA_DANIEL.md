# Inbox local — levar pro Victor

Memória desta frente: **`ESTADO.md`** (o que está, o que não fazer, próximo). Este arquivo é só o passo a passo de copiar.

**Teu PC é Windows. O dele é Mac.** O app foi escrito pra os dois. O instalador `install-mac.sh` só roda no Mac.

## Neste Windows (já testado aqui)

```
cd Desktop\Projeto Vitor\07_Execucao\B0_Infra\inbox-mac
.\start-windows.ps1
```

Abre `http://127.0.0.1:8088` — chave está no `.env` (não manda no grupo).

## No Mac dele (na call)

1. Copia a pasta `inbox-mac` inteira (AirDrop / pendrive). Não precisa do `bin\` do Windows.
2. Terminal:

```
cd ~/Downloads/inbox-mac    # ou onde colou
export B2_KEY_ID='…'        # privado, não grupo
export B2_APPLICATION_KEY='…'
bash install-mac.sh
```

3. Dois cliques em **ATLAS Inbox** no Desktop.

## Visual (o que está no ar)

Fonte da verdade: `07_Execucao/B0_Infra/inbox/public/` (Hetzner `:8088`).
- Inbox = papel, IBM Plex, Source Serif, navy (`styles.css`).
- Drive = Windows 98 teal/Tahoma (`explorer.css`). São duas peles de propósito.
Não unificar o Drive no visual do Inbox. Features novas (ícone, thumb, preview, duplicados) só **acrescentam** CSS no fim do arquivo.

## Não fazer

- Não colar o PDF `Sobe_OZARK_no_Backblaze.pdf`.
- Não abrir porta na Starlink. Só `127.0.0.1`.
- Não mexer no LucidLink.
