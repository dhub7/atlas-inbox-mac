#!/usr/bin/env python3
"""Sobe arquivos >= min-bytes pro B2 com large file + resume de partes.
Stdlib só. Chaves no rclone.conf [b2]."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BUCKET = "atlas-victor-bruto"
PART = 32 * 1024 * 1024
MIN_PART = 5 * 1024 * 1024
RETRIES = 20
SLEEP = 8


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


def b2(auth: dict, path: str, body: dict, timeout: int = 120) -> dict:
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


def start_large(auth: dict, bid: str, name: str) -> str:
    data = b2(auth, "b2_start_large_file", {"bucketId": bid, "fileName": name, "contentType": "b2/x-auto"})
    return data["fileId"]


def upload_part(auth: dict, file_id: str, part_no: int, blob: bytes, sha1: str) -> None:
    last = None
    for attempt in range(1, RETRIES + 1):
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
            return
        except Exception as e:
            last = e
            log(f"parte {part_no} tentativa {attempt}/{RETRIES} falhou: {e}")
            time.sleep(SLEEP)
    raise RuntimeError(f"parte {part_no} desistiu: {last}")


def finish(auth: dict, file_id: str, sha1s: list[str]) -> None:
    b2(auth, "b2_finish_large_file", {"fileId": file_id, "partSha1Array": sha1s}, timeout=180)


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


def pick_unfinished(auth: dict, files: list[dict], size: int, part_size: int) -> tuple[str | None, dict[int, dict], int]:
    best_id = None
    best_parts: dict[int, dict] = {}
    best_ps = part_size
    for f in files:
        fid = f["fileId"]
        parts = list_parts(auth, fid)
        if not parts:
            if best_id is None:
                best_id, best_parts, best_ps = fid, parts, part_size
            continue
        ps = int(next(iter(parts.values())).get("contentLength") or part_size)
        if ps < MIN_PART:
            cancel(auth, fid)
            continue
        if len(parts) > len(best_parts):
            best_id, best_parts, best_ps = fid, parts, ps
    return best_id, best_parts, best_ps


def upload_file(auth: dict, bid: str, local: Path, dest_name: str) -> None:
    size = local.stat().st_size
    if already_complete(auth, bid, dest_name, size):
        log(f"já no B2 ({size} bytes): {dest_name}")
        return
    unfinished = list_unfinished(auth, bid, dest_name)
    file_id, have, part_size = pick_unfinished(auth, unfinished, size, PART)
    if file_id is None:
        file_id = start_large(auth, bid, dest_name)
        have = {}
        part_size = PART
        log(f"novo large file {local.name} {size} bytes parte={part_size}")
    else:
        for f in unfinished:
            if f["fileId"] != file_id:
                cancel(auth, f["fileId"])
        log(f"retomo {local.name}: {len(have)} partes já no B2, parte={part_size}")
    chunks = plan_parts(size, part_size)
    sha1s = [""] * len(chunks)
    for p in have.values():
        n = int(p["partNumber"])
        if 1 <= n <= len(sha1s):
            raw = (p.get("contentSha1") or "").replace("unverified:", "")
            if len(raw) == 40:
                sha1s[n - 1] = raw
    with local.open("rb") as fh:
        for part_no, off, ln in chunks:
            if sha1s[part_no - 1] and len(sha1s[part_no - 1]) == 40:
                log(f"parte {part_no}/{len(chunks)} skip (já no B2)")
                continue
            fh.seek(off)
            blob = fh.read(ln)
            if len(blob) != ln:
                raise RuntimeError(f"leitura curta em {local} off={off}")
            sha = hashlib.sha1(blob).hexdigest()
            t0 = time.time()
            upload_part(auth, file_id, part_no, blob, sha)
            dt = max(time.time() - t0, 0.001)
            mbps = (ln / (1024 * 1024)) / dt
            sha1s[part_no - 1] = sha
            log(f"parte {part_no}/{len(chunks)} {ln / (1024 * 1024):.1f} MiB ok  {mbps:.2f} MiB/s  {local.name}")
    if any(not s for s in sha1s):
        raise RuntimeError("faltou SHA1 de parte — não fecho o arquivo")
    finish(auth, file_id, sha1s)
    log(f"FECHOU {local.name} ({size / (1024 ** 3):.2f} GiB)")


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
    ap.add_argument("--src", required=True)
    ap.add_argument("--b2-prefix", required=True, help="ex: YT-MAIN/00_INBOX/2026-09-13/CANON/RAW/")
    ap.add_argument("--min-bytes", type=int, default=524288000)
    ap.add_argument("--max-depth", type=int, default=1)
    args = ap.parse_args()
    src = Path(args.src)
    if not src.is_dir():
        log(f"pasta não existe: {src}")
        return 1
    prefix = args.b2_prefix.strip("/") + "/"
    files = iter_files(src, args.min_bytes, args.max_depth)
    if not files:
        log("nenhum gordo nesta pasta")
        return 0
    account, key = read_b2_keys()
    auth = authorize(account, key)
    bid = bucket_id(auth)
    log(f"gordos nesta pasta: {len(files)}")
    rc = 0
    for i, f in enumerate(files, 1):
        dest = prefix + f.name
        log(f"--- gordo {i}/{len(files)} {f.name} {f.stat().st_size / (1024 ** 3):.2f} GiB ---")
        try:
            upload_file(auth, bid, f, dest)
        except Exception as e:
            log(f"ERRO {f.name}: {e}")
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
