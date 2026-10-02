# ATLAS Mandar B2 — como funciona (pra levar pra outro modo)

Atualizado: 2026-10-01. Bucket `atlas-victor-bruto`. Código no Mac: `~/ATLAS/inbox-mac`. Publicar: `.\publicar.ps1` neste Windows.

**No ar na Erica:** `2026.09.23.2`. Esta pasta tem o patch seguinte e **não foi publicada**. Não rodar `publicar.ps1` enquanto o multipart do C982 existir. O Mac lê o B2, não o GitHub.

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

## Pipeline do Mandar (pasta local, ainda não no Mac)

1. Varre `TRANSFER` **pasta por pasta** (`find | sort`, nome).
2. Em cada pasta, só arquivos **daquele nível** (`--max-depth 1`).
3. **Abaixo de 64 MB:** `rclone copy --max-size 64M --b2-upload-cutoff 64M`. Não abre large file. `--retries 10` e `--low-level-retries 50`. Pasta sem arquivo pequeno pula o rclone.
4. **De 64 MB para cima:** `b2-resume-upload.py` (API nativa B2, não rclone). Um arquivo por vez. **1 parte por vez.** Fatia base **8 MiB**; sobe (múltiplo de 1 MiB) se o arquivo passaria de 10.000 partes. 32 MiB × 3 paralelo foi revertido em 17/09: a Starlink quebrava as 3 e zero fatia gravava.

O que está no Mac hoje (`2026.09.23.2`) ainda usa o corte de **100 MB**, não 64. O resto do resume abaixo já vale nessa versão, menos o timeout por progresso e o cancelamento de unfinished sem `fileInfo`.

Gordo no B2 = *large file*:

- `b2_start_large_file` grava `src_size` e `src_mtime_ms` no `fileInfo`
- Partes de **8 MiB** em arquivo novo (última = resto). Se retomar unfinished, **mantém o tamanho que já está no B2**
- `b2_get_upload_part_url` **novo a cada tentativa** (URL morre depois de erro)
- `b2_upload_part` + SHA1 da parte
- `b2_finish_large_file` com o array de SHA1s **só quando todas as partes existem**
- `b2_get_file_info`: tamanho igual ao arquivo local, senão não marca `FECHOU`
- Até o `finish`, o objeto **não aparece** no Drive. Fica em Unfinished Large Files (custa storage)

Resume:

- Unfinished sem `src_size` e `src_mtime_ms` é **cancelado**. Não costura export antigo.
- Unfinished com tamanho ou mtime diferente é cancelado.
- Parte já no B2 só entra no `finish` se o SHA1 **e** o `contentLength` batem com a leitura local. SHA1 de 40 caracteres sozinho não basta.
- HTTP 401 chama `authorize_account` de novo. Backoff 8 → 16 → … → **120 s**, com jitter de ±20%. Não pula o arquivo.
- Timeout desta pasta: **180 s sem byte** na parte. O teto da parte é `tamanho / 0,02 MiB/s + 180 s` (32 MiB ≈ 30 min). No `2026.09.23.2` o teto ainda é 300 s para a requisição inteira.
- **Atualizar o app não zera pedaços** de um unfinished que ainda bate. Só zera no cancel.

rclone **não** retoma partes B2 (issue #3019): no `Failed to copy` ele **cancela o large file**. Por isso o caminho dos gordos é Python.

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

## O que o 12.17 passou a fazer, e o 23.2 manteve

- Depois de cada pipe: `list_parts`. Se a parte está lá, trata como ok e segue (ou `finish`).
- Backoff até **120 s**. Não pula o arquivo.
- `finish` 400 “already finished” → confere o tamanho e, se bater, conta `FECHOU`.

Não se troca de arquivo porque a rede caiu. Um arquivo lento pela Starlink fica na frente da fila.

---

## O que ainda não é

- Cortar `.CRM` no disco (Resolve não abre).
- `--transfers 8` nos gordos (rclone cancela large file).
- Achar que 24 Mbps no teste = 24 MB/s.
- Mexer no Mandar enquanto um envio está no Terminal.

---

## Como atualizar na Erica

Não atualizar com o C982 aberto. Control+C no meio troca o processo e pode retomar fatia velha.

Quando o log der `FECHOU` nesse arquivo e não houver outro multipart: `.\publicar.ps1` com o Terminal dela parado. Aí o ícone puxa a versão nova. Log bom de um resume: `retomo <arquivo>: N partes` e, se cair, `espero …s (não pulo o arquivo)`.
