# ATLAS Mandar B2 — como funciona (pra levar pra outro modo)

Atualizado: 2026-09-17 (rollback 8 MiB série). Bucket `atlas-victor-bruto`. Código no Mac: `~/ATLAS/inbox-mac`. Publicar: `.\publicar.ps1` neste Windows.

---

## Peças

| Peça | Papel |
|--|--|
| `TRANSFER` no Mac da Erica | Origem. Ela joga os arquivos. |
| **Mandar B2** | Sobe pro B2. Não é o Drive. |
| **ATLAS Drive** / https://driveatlasvictor.vercel.app | Lista/organiza o que **já fechou**. |
| Log | `YT-MAIN/00_APPS/inbox-mac/ops/enviar-live.log` (a cada ~20s) |

Link Starlink medido: teste ~24 **Mbps** upload ≈ 3 MB/s. rclone chegava ~3,5 MB/s. Quedas a cada ~8–10 min.

---

## Pipeline do Mandar (v12.17+)

1. Varre `TRANSFER` **pasta por pasta** (`find \| sort`, nome).
2. Em cada pasta, só arquivos **daquele nível** (`--max-depth 1`).
3. **Pequenos (< 500 MB):** `rclone copy --max-size 500M --transfers 4 --order-by size,ascending`. Já fechavam.
4. **Gordos (≥ 100 MB):** `b2-resume-upload.py` (API nativa B2, **não** rclone). Um arquivo por vez, menor→maior. **1 parte por vez, 8 MiB.** 32 MiB × 3 paralelo revertido em 17/09: Starlink quebrava as 3 e zero fatia gravava.

Gordo no B2 = *large file*:

- `b2_start_large_file` (ou retoma unfinished do mesmo `fileName`)
- Partes de **8 MiB** em arquivo novo (última = resto). Se retomar unfinished, **mantém o tamanho que já está no B2**.
- `b2_get_upload_part_url` **novo a cada tentativa** (URL morre depois de erro)
- `b2_upload_part` + SHA1 da parte
- `b2_finish_large_file` com o array de SHA1s **só quando todas as partes existem**
- Até o `finish`, o objeto **não aparece** no Drive (404). Fica em Unfinished Large Files (custa storage).

Resume: `b2_list_unfinished_large_files` + `b2_list_parts`. Partes com SHA1 de 40 chars = skip. **Atualizar o app não zera pedaços.** Só zera se alguém der cancel no unfinished.

rclone **não** retoma partes B2 (issue #3019): no `Failed to copy` ele **cancela o large file**. Por isso saímos do rclone nos gordos.

---

## O que vimos no C904 (`A021C904_…P.CRM`, 1,83 GiB, 59 partes)

Consulta S3 `list_parts` em 2026-09-14:

- Partes **1–58** no B2, todas **33554432 bytes** (32 MiB).
- **Parte 59 não existe.**
- Objeto final: **404**.

Log: 58 skip no restart, depois 20× `broken pipe` / `connection reset` na 59, `ERRO … desistiu`, foi pro próximo CRM.

A 59 é o **resto** (~18 MiB), não 32. Isso é válido no B2.

---

## Por que “a última falha e o próximo anda”

Não é a última fatia ser especial no B2.

1. **Desistência curta (bug nosso, pré-12.17).** 20 retries × 8 s ≈ **3 min** de link morto → `raise` → **próximo arquivo**. C904 com 58/59 foi **abandonado**. C913/C908/C903: mesma coisa na primeira parte que faltava. Não “o próximo funciona”: o próximo **pula o que já tinha** (skip 1–9) e **também toma 20 pipes** se a Starlink continua morta.

2. **Broken pipe no B2 (docs oficiais).** O cliente manda o **corpo HTTP inteiro** antes de ler a resposta. Se o pod já respondeu erro (token, 503, timeout), o Mac ainda empurra bytes → `Errno 32`. O erro real some. Retry **tem** que pegar URL nova (a gente pega). A parte **pode ter gravado** mesmo com pipe no cliente — por isso depois do erro tem que dar `list_parts`. No C904 a 59 **não** gravou (confirmado). Em outros casos pode ter gravado e a gente nunca chamou `finish`.

3. **Quando “funciona” de verdade.** C912: parte 1 falhou ~13×, depois **ok a 0,02 MiB/s**, partes 2–3 a **1,5–2,5 MiB/s**. A Starlink **voltou**. Se tivéssemos **ficado na 59 do C904** com espera longa, essa janela serviria pra fechar o C904. Trocar de arquivo **não conserta a rede**; só coincide com o momento em que ela volta, ou parece progresso por causa dos `skip`.

4. **Martelar 8 s.** Checklist B2: backoff exponencial. 20 pipes seguidos em 3 min piora TCP/NAT da Starlink.

---

## Código 12.17 (já no B2 `00_APPS`)

- Depois de cada pipe: `list_parts`. Se a parte está lá, trata como ok e segue (ou `finish`).
- Backoff 8 → 16 → … → **120 s**. Não pula o arquivo.
- `finish` 400 “already finished” → checa se o objeto existe e conta `FECHOU`.

Mandar novo **reusa 1–58 do C904**. Não começa do zero.

---

## O que ainda não é

- Cortar `.CRM` no disco (Resolve não abre).
- `--transfers 8` nos gordos (rclone cancela large file).
- Achar que 24 Mbps no teste = 24 MB/s.
- Mexer no Mandar enquanto um envio está no Terminal.

---

## Como atualizar na Erica

Control+C no Terminal → ATLAS Drive → Mandar B2.  
Log bom: `retomo A021C904: 58 partes` e, se cair, `espero 120s (não pulo o arquivo)`.
