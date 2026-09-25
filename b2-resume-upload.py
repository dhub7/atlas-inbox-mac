#!/usr/bin/env python3
"""Sobe arquivos >= min-bytes pro B2 com large file + resume de partes.
Stdlib só. Chaves no rclone.conf [b2]."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BUCKET = "atlas-victor-bruto"
PART = 8 * 1024 * 1024
MIN_PART = 5 * 1024 * 1024
B2_MAX_PARTS = 10000
UA = "ATLAS-Mandar-B2/12.21"
RETRIES = 20
SLEEP = 8
MAX_SLEEP = 120
CREDS = {"account": "", "key": ""}


def log(msg: str) -> None:
    print(msg, flush=True)


def rclone_conf() -> Path:
    home = Path.home()
    cands = [
        home / ".config" / "rclone" / "rclone.conf",
        home / "AppData" / "Roaming" / "rclone" / "rclone.conf",
    ]
    for p in cands:
        if p.is_file():
            return p
    raise SystemExit("rclone.conf não achado")


def read_b2_keys() -> tuple[str, str]:
    account = key = None
    in_b2 = False
    for line in rclone_conf().read_text(encoding="utf-8", errors="replace").splitlines():
        s = line.strip()
        if s.startswith("["):
            in_b2 = s == "[b2]"
            continue
        if not in_b2 or "=" not in s:
            continue
        k, v = s.split("=", 1)
        k, v = k.strip(), v.strip()
        if k == "account":
            account = v
        elif k == "key":
            key = v
    if not account or not key:
        raise SystemExit("account/key [b2] faltando no rclone.conf")
    return account, key


def api(method: str, url: str, token: str | None, body: dict | None = None, raw: bytes | None = None, headers: dict | None = None, timeout: int = 120):
    hdrs = dict(headers or {})
    hdrs.setdefault("User-Agent", UA)
    data = None
    if raw is not None:
        data = raw
    elif body is not None:
        data = json.dumps(body).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json")
    if token:
        hdrs["Authorization"] = token
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            blob = resp.read()
            if not blob:
                return {}
            try:
                return json.loads(blob.decode("utf-8"))
            except json.JSONDecodeError:
                return {"_raw": blob}
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code} {url}: {err[:400]}") from e


def authorize(account: str, key: str) -> dict:
    token = "Basic " + base64.b64encode(f"{account}:{key}".encode()).decode()
    return api("GET", "https://api.backblazeb2.com/b2api/v2/b2_authorize_account", token)


def refresh_auth(auth: dict) -> None:
    new = authorize(CREDS["account"], CREDS["key"])
    auth.clear()
    auth.update(new)
    log("reautorizei conta B2 (401/token)")


def b2(auth: dict, path: str, body: dict, timeout: int = 120) -> dict:
    url = auth["apiUrl"].rstrip("/") + "/b2api/v2/" + path
    try:
        return api("POST", url, auth["authorizationToken"], body=body, timeout=timeout)
    except RuntimeError as e:
        if "HTTP 401" not in str(e):
            raise
        refresh_auth(auth)
        url = auth["apiUrl"].rstrip("/") + "/b2api/v2/" + path
        return api("POST", url, auth["authorizationToken"], body=body, timeout=timeout)


def bucket_id(auth: dict) -> str:
    data = b2(auth, "b2_list_buckets", {"accountId": auth["accountId"]})
    for b in data.get("buckets") or []:
        if b.get("bucketName") == BUCKET:
            return b["bucketId"]
    raise SystemExit(f"bucket {BUCKET} não achado")


def already_complete(auth: dict, bid: str, name: str, size: int) -> bool:
    data = b2(auth, "b2_list_file_names", {"bucketId": bid, "prefix": name, "maxFileCount": 20})
    for f in data.get("files") or []:
        if f.get("fileName") == name and int(f.get("size") or 0) == size and f.get("action") == "upload":
            return True
    return False


def list_unfinished(auth: dict, bid: str, name: str) -> list[dict]:
    out = []
    start = None
    while True:
        body = {"bucketId": bid, "namePrefix": name, "maxFileCount": 100}
        if start:
            body["startFileId"] = start
        data = b2(auth, "b2_list_unfinished_large_files", body)
        for f in data.get("files") or []:
            if f.get("fileName") == name:
                out.append(f)
        start = data.get("nextFileId")
        if not start:
            break
    return out


def list_parts(auth: dict, file_id: str) -> dict[int, dict]:
    parts: dict[int, dict] = {}
    start = 1
    while True:
        data = b2(auth, "b2_list_parts", {"fileId": file_id, "startPartNumber": start, "maxPartCount": 1000})
        batch = data.get("parts") or []
        if not batch:
            break
        for p in batch:
            parts[int(p["partNumber"])] = p
        if len(batch) < 1000:
            break
        start = int(batch[-1]["partNumber"]) + 1
    return parts


def cancel(auth: dict, file_id: str) -> None:
    try:
        b2(auth, "b2_cancel_large_file", {"fileId": file_id})
    except Exception as e:
        log(f"aviso: não cancelei {file_id[-12:]}: {e}")


def start_large(auth: dict, bid: str, name: str, size: int, mtime_ms: int) -> str:
    data = b2(
        auth,
        "b2_start_large_file",
        {
            "bucketId": bid,
            "fileName": name,
            "contentType": "b2/x-auto",
            "fileInfo": {"src_size": str(size), "src_mtime_ms": str(mtime_ms)},
        },
    )
    return data["fileId"]


def unfinished_matches(f: dict, size: int, mtime_ms: int) -> bool:
    info = f.get("fileInfo") or {}
    if not info.get("src_size"):
        return True
    return info.get("src_size") == str(size) and info.get("src_mtime_ms") == str(mtime_ms)


def sha_of_part(p: dict) -> str:
    raw = (p.get("contentSha1") or "").replace("unverified:", "")
    return raw if len(raw) == 40 else ""


def part_on_b2(auth: dict, file_id: str, part_no: int) -> str:
    try:
        parts = list_parts(auth, file_id)
    except Exception as e:
        log(f"list_parts falhou: {e}")
        return ""
    return sha_of_part(parts.get(part_no) or {})


def upload_part(auth: dict, file_id: str, part_no: int, blob: bytes, sha1: str) -> str:
    """Retry até a parte existir no B2. Pipe não desiste do arquivo.
    Depois de cada erro, pergunta se a parte já gravou (docs B2)."""
    attempt = 0
    while True:
        attempt += 1
        got = part_on_b2(auth, file_id, part_no)
        if got:
            log(f"parte {part_no} já no B2 (não remitir)")
            return got
        try:
            urls = b2(auth, "b2_get_upload_part_url", {"fileId": file_id})
            api(
                "POST",
                urls["uploadUrl"],
                urls["authorizationToken"],
                raw=blob,
                headers={
                    "X-Bz-Part-Number": str(part_no),
                    "X-Bz-Content-Sha1": sha1,
                    "Content-Type": "application/octet-stream",
                    "Content-Length": str(len(blob)),
                },
                timeout=300,
            )
            return sha1
        except Exception as e:
            err = str(e)
            if "HTTP 401" in err:
                try:
                    refresh_auth(auth)
                except Exception as re:
                    log(f"reauth falhou: {re}")
            wait = min(SLEEP * (2 ** min(attempt - 1, 4)), MAX_SLEEP)
            wait = wait * (0.8 + random.random() * 0.4)
            log(f"parte {part_no} tentativa {attempt} falhou: {e}")
            log(f"espero {wait:.0f}s (não pulo o arquivo)")
            time.sleep(wait)


def finish(auth: dict, file_id: str, sha1s: list[str]) -> None:
    b2(auth, "b2_finish_large_file", {"fileId": file_id, "partSha1Array": sha1s}, timeout=180)


def part_size_for(size: int, base: int = PART) -> int:
    """B2 aceita no máximo 10000 partes. 100 GB / 8 MiB = 12800 → estoura.
    Sobe a fatia (múltiplo de 1 MiB, ≥ 8 MiB) até caber."""
    mb = 1024 * 1024
    need = (size + B2_MAX_PARTS - 1) // B2_MAX_PARTS
    ps = max(base, need, MIN_PART)
    ps = ((ps + mb - 1) // mb) * mb
    while (size + ps - 1) // ps > B2_MAX_PARTS:
        ps += mb
    return ps


def plan_parts(size: int, part_size: int) -> list[tuple[int, int, int]]:
    """[(part_no, offset, length), ...]"""
    out = []
    n = 1
    off = 0
    while off < size:
        ln = min(part_size, size - off)
        out.append((n, off, ln))
        n += 1
        off += ln
    return out


def pick_unfinished(
    auth: dict, files: list[dict], size: int, mtime_ms: int, part_size: int
) -> tuple[str | None, dict[int, dict], int]:
    best_id = None
    best_parts: dict[int, dict] = {}
    best_ps = part_size
    for f in files:
        fid = f["fileId"]
        if not unfinished_matches(f, size, mtime_ms):
            log(f"unfinished {fid[-12:]} não bate size/mtime — cancelo")
            cancel(auth, fid)
            continue
        parts = list_parts(auth, fid)
        if not parts:
            if best_id is None:
                best_id, best_parts, best_ps = fid, parts, part_size
            continue
        first = parts.get(1) or next(iter(parts.values()))
        ps = int(first.get("contentLength") or part_size)
        if 1 in parts and ps >= MIN_PART:
            pass
        elif ps < MIN_PART:
            cancel(auth, fid)
            continue
        if len(parts) > len(best_parts):
            best_id, best_parts, best_ps = fid, parts, ps
    return best_id, best_parts, best_ps


def upload_file(auth: dict, bid: str, local: Path, dest_name: str, fresh: bool = False) -> None:
    st = local.stat()
    size = st.st_size
    mtime_ms = int(st.st_mtime * 1000)
    if already_complete(auth, bid, dest_name, size):
        log(f"já no B2 ({size} bytes): {dest_name}")
        return
    unfinished = list_unfinished(auth, bid, dest_name)
    if fresh:
        for f in unfinished:
            log(f"--fresh: cancelo unfinished {f['fileId'][-12:]}")
            cancel(auth, f["fileId"])
        unfinished = []
    want_ps = part_size_for(size, PART)
    file_id, have, part_size = pick_unfinished(auth, unfinished, size, mtime_ms, want_ps)
    if file_id is None:
        file_id = start_large(auth, bid, dest_name, size, mtime_ms)
        have = {}
        part_size = want_ps
        log(f"novo large file {local.name} {size} bytes parte={part_size} ({(size + part_size - 1) // part_size} partes)")
    else:
        nparts = (size + part_size - 1) // part_size
        if nparts > B2_MAX_PARTS:
            log(f"unfinished parte={part_size} daria {nparts} partes (>10000) — cancelo e recomeço com {want_ps}")
            cancel(auth, file_id)
            file_id = start_large(auth, bid, dest_name, size, mtime_ms)
            have = {}
            part_size = want_ps
            log(f"novo large file {local.name} {size} bytes parte={part_size} ({(size + part_size - 1) // part_size} partes)")
        else:
            for f in unfinished:
                if f["fileId"] != file_id:
                    cancel(auth, f["fileId"])
            log(f"retomo {local.name}: {len(have)} partes já no B2, parte={part_size}")
    chunks = plan_parts(size, part_size)
    sha1s = [""] * len(chunks)
    with local.open("rb") as fh:
        for part_no, off, ln in chunks:
            fh.seek(off)
            blob = fh.read(ln)
            if len(blob) != ln:
                raise RuntimeError(f"leitura curta em {local} off={off}")
            local_sha = hashlib.sha1(blob).hexdigest()
            remote = have.get(part_no)
            remote_sha = sha_of_part(remote) if remote else ""
            remote_len = int(remote.get("contentLength") or 0) if remote else 0
            if remote_sha == local_sha and remote_len == ln:
                sha1s[part_no - 1] = local_sha
                log(f"parte {part_no}/{len(chunks)} skip (hash+tamanho ok)")
                continue
            t0 = time.time()
            got = upload_part(auth, file_id, part_no, blob, local_sha)
            dt = max(time.time() - t0, 0.001)
            mbps = (ln / (1024 * 1024)) / dt
            sha1s[part_no - 1] = got or local_sha
            log(f"parte {part_no}/{len(chunks)} {ln / (1024 * 1024):.1f} MiB ok  {mbps:.2f} MiB/s  {local.name}")
    if any(not s for s in sha1s):
        raise RuntimeError("faltou SHA1 de parte — não fecho o arquivo")
    try:
        finish(auth, file_id, sha1s)
    except Exception as e:
        msg = str(e)
        if "400" not in msg and "already" not in msg.lower():
            raise
        log(f"finish 400 — confiro se já fechou: {e}")
    for _ in range(8):
        try:
            info = b2(auth, "b2_get_file_info", {"fileId": file_id})
            got = int(info.get("contentLength") or info.get("size") or 0)
            if got == size:
                log(f"FECHOU {local.name} ({size / (1024 ** 3):.2f} GiB)")
                return
            log(f"get_file_info size={got} esperado={size}")
        except Exception as e:
            log(f"get_file_info: {e}")
        if already_complete(auth, bid, dest_name, size):
            log(f"FECHOU {local.name} (listou no B2)")
            return
        time.sleep(2)
    if already_complete(auth, bid, dest_name, size):
        log(f"FECHOU {local.name} (listou no B2)")
        return
    raise RuntimeError(f"finish rodou mas tamanho não confere no B2: {dest_name}")


def iter_files(src: Path, min_bytes: int, max_depth: int) -> list[Path]:
    out = []
    src = src.resolve()
    for p in src.rglob("*"):
        if not p.is_file():
            continue
        if p.name in {".DS_Store"} or p.name.startswith("._"):
            continue
        rel = p.relative_to(src)
        if max_depth == 1 and len(rel.parts) != 1:
            continue
        if p.stat().st_size < min_bytes:
            continue
        out.append(p)
    out.sort(key=lambda x: (x.stat().st_size, x.name.lower()))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--b2-prefix", default="", help="ex: YT-MAIN/00_INBOX/2026-09-13/CANON/RAW/")
    ap.add_argument("--src", default="")
    ap.add_argument("--file", default="", help="um arquivo só (teste)")
    ap.add_argument("--pick-test", action="store_true", help="escolhe um CRM grande != C904 e --fresh")
    ap.add_argument("--fresh", action="store_true", help="ignora unfinished e começa em 8MB")
    ap.add_argument("--min-bytes", type=int, default=104857600)
    ap.add_argument("--max-depth", type=int, default=1)
    args = ap.parse_args()
    if args.pick_test:
        args.fresh = True
        root = Path.home() / "ATLAS" / "TRANSFER"
        cands = []
        if root.is_dir():
            for p in root.rglob("*"):
                if not p.is_file():
                    continue
                if "C904" in p.name:
                    continue
                if p.suffix.upper() not in {".CRM", ".MP4", ".MOV"}:
                    continue
                if p.stat().st_size < args.min_bytes:
                    continue
                cands.append(p)
        cands.sort(key=lambda x: x.stat().st_size)
        if not cands:
            log("pick-test: nenhum CRM/MP4 >=100MB (exceto C904) em ~/ATLAS/TRANSFER")
            return 1
        args.file = str(cands[0])
        rel = cands[0].relative_to(root).as_posix()
        parent = str(Path(rel).parent).replace("\\", "/")
        if parent in (".", ""):
            args.b2_prefix = "YT-MAIN/00_INBOX/TRANSFER/"
        else:
            args.b2_prefix = f"YT-MAIN/00_INBOX/TRANSFER/{parent}/"
        log(f"pick-test: {cands[0]}  {cands[0].stat().st_size / (1024 ** 3):.2f} GiB")
        log(f"pick-test dest: {args.b2_prefix}")
    prefix = args.b2_prefix.strip("/") + "/"
    if args.file:
        p = Path(args.file).expanduser()
        if not p.is_file():
            log(f"arquivo não existe: {p}")
            return 1
        files = [p]
    else:
        src = Path(args.src)
        if not src.is_dir():
            log(f"pasta não existe: {src}")
            return 1
        files = iter_files(src, args.min_bytes, args.max_depth)
        if not files:
            log("nenhum gordo nesta pasta")
            return 0
    account, key = read_b2_keys()
    CREDS["account"], CREDS["key"] = account, key
    auth = authorize(account, key)
    bid = bucket_id(auth)

    def parts_done(p: Path) -> int:
        dest = prefix + p.name
        try:
            unf = list_unfinished(auth, bid, dest)
            if not unf:
                return 0
            st = p.stat()
            _fid, have, _ps = pick_unfinished(
                auth, unf, st.st_size, int(st.st_mtime * 1000), PART
            )
            return len(have)
        except Exception:
            return 0

    if not args.file:
        files.sort(key=lambda p: (-parts_done(p), p.stat().st_size, p.name.lower()))
    log(f"gordos nesta pasta: {len(files)}")
    rc = 0
    for i, f in enumerate(files, 1):
        dest = prefix + f.name
        log(f"--- gordo {i}/{len(files)} {f.name} {f.stat().st_size / (1024 ** 3):.2f} GiB ---")
        try:
            upload_file(auth, bid, f, dest, fresh=args.fresh)
        except Exception as e:
            log(f"ERRO {f.name}: {e}")
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
