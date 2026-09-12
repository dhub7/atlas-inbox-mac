/**
 * ATLAS.victor — Inbox local (Mac / Windows)
 * Drive (ls/mkdir/move/delete) still talks to B2.
 * Bulk upload is rclone copy on this machine — not the browser.
 *
 * Extra vs Hetzner inbox:
 * POST /api/pick-folder
 * POST /api/scan            { srcPath, destPrefix }
 * POST /api/jobs            { srcPath, destPrefix, decisions? }
 * GET  /api/jobs
 * GET  /api/jobs/:id
 * POST /api/jobs/:id/cancel
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStore, destUri as b2DestUri } from "./rclone-job.mjs";
import { createThumbs } from "./thumbs.mjs";
import { findCollisions, planDecisions, walkLocal } from "./scan-dupes.mjs";
import { createOpsLog } from "./ops-log.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(here, ".env"));

const PUBLIC = path.join(here, "public");
const PORT = Number(process.env.PORT || 8088);
const TOKEN = process.env.INBOX_TOKEN || "";
const BUCKET = process.env.B2_BUCKET || "atlas-victor-bruto";
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
const CORS_NAME = "atlasInbox";
const BIND = process.env.BIND || "127.0.0.1";
const APP_VERSION = (() => {
  try {
    return fs.readFileSync(path.join(here, "VERSION"), "utf8").trim();
  } catch {
    return "dev";
  }
})();
const jobs = createStore(path.join(here, "data"));
const ops = createOpsLog(path.join(here, "data"));
const thumbs = createThumbs({
  dir: path.join(here, "data", "thumbs"),
  getSourceUrl: b2DownloadUrl,
});

const ALLOWED_PREFIXES = [
  "YT-MAIN/00_INBOX/",
  "YT-MAIN/episodes/micanopy/",
  "YT-MAIN/episodes/south-dakota-p1/",
  "YT-MAIN/episodes/south-dakota-p2/",
  "dropbox-mirror/",
];

const DESTINATIONS = [
  { id: "inbox", label: "Inbox", prefix: "YT-MAIN/00_INBOX/", cameras: false },
  { id: "micanopy", label: "Micanopy", prefix: "YT-MAIN/episodes/micanopy/", cameras: true },
  { id: "sdp1", label: "South Dakota P1", prefix: "YT-MAIN/episodes/south-dakota-p1/", cameras: true },
  { id: "sdp2", label: "South Dakota P2", prefix: "YT-MAIN/episodes/south-dakota-p2/", cameras: true },
  { id: "dropbox", label: "Dropbox mirror", prefix: "dropbox-mirror/", cameras: false },
];

const CAMERAS = [
  { id: "canon-bruto", label: "Canon BRUTO", suffix: "CANON/BRUTO/" },
  { id: "gopro-bruto", label: "GoPro BRUTO", suffix: "GO-PRO/BRUTO/" },
  { id: "iphone", label: "iPhone", suffix: "IPHONE/" },
  { id: "rode", label: "Rode Pro", suffix: "RODE_PRO/" },
  { id: "ep-root", label: "Pasta do episódio", suffix: "" },
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

let session = null;
let sessionAt = 0;
const SESSION_MS = 12 * 60 * 60 * 1000;

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] == null) process.env[k] = v;
  }
}

function rcloneConfPaths() {
  const home = os.homedir();
  return [
    process.env.RCLONE_CONFIG,
    path.join(home, "AppData", "Roaming", "rclone", "rclone.conf"),
    path.join(home, ".config", "rclone", "rclone.conf"),
    "/root/.config/rclone/rclone.conf",
  ].filter(Boolean);
}

function readRcloneB2() {
  const p = rcloneConfPaths().find((c) => fs.existsSync(c));
  if (!p) return {};
  const text = fs.readFileSync(p, "utf8");
  let inB2 = false;
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("[")) {
      inB2 = t === "[b2]";
      continue;
    }
    if (!inB2 || !t.includes("=")) continue;
    const i = t.indexOf("=");
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return { keyId: out.account, appKey: out.key };
}

function credentials() {
  const rclone = readRcloneB2();
  const keyId = process.env.B2_KEY_ID || rclone.keyId;
  const appKey = process.env.B2_APPLICATION_KEY || rclone.appKey;
  if (!keyId || !appKey) throw new Error("missing B2 credentials");
  return { keyId, appKey };
}

function send(res, code, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(code, {
    "content-length": buf.length,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    ...headers,
  });
  res.end(buf);
}

function json(res, code, obj, extra = {}) {
  send(res, code, JSON.stringify(obj), {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extra,
  });
}

function cookieToken(req) {
  const raw = req.headers.cookie || "";
  const m = raw.match(/(?:^|;\s*)k=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

function isLoopback(req) {
  const ip = String(req.socket.remoteAddress || "");
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function authed(req, url) {
  if (isLoopback(req)) return true;
  if (!TOKEN || TOKEN === "change-me") return false;
  const q = url.searchParams.get("k") || "";
  return q === TOKEN || cookieToken(req) === TOKEN;
}

function setAuthCookie() {
  return `k=${encodeURIComponent(TOKEN)}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`;
}

const hits = new Map();
function rateOk(ip, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now);
  hits.set(ip, arr);
  return true;
}

async function readJson(req, limit = 64 * 1024) {
  const chunks = [];
  let n = 0;
  for await (const ch of req) {
    n += ch.length;
    if (n > limit) throw new Error("body too large");
    chunks.push(ch);
  }
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  return JSON.parse(raw);
}

function safeJoin(root, rel) {
  const p = path.normalize(path.join(root, rel));
  if (!p.startsWith(root)) return null;
  return p;
}

export function sanitizeKey(input) {
  let key = String(input || "").replace(/\\/g, "/").trim();
  if (key.startsWith("/")) key = key.slice(1);
  if (!key || key.includes("\0")) return null;
  const parts = key.split("/").filter((p) => p && p !== "." && p !== "..");
  if (parts.length !== key.split("/").filter(Boolean).length) return null;
  if (parts.some((p) => p === "." || p === "..")) return null;
  const out = parts.join("/");
  if (!ALLOWED_PREFIXES.some((p) => out.startsWith(p))) return null;
  if (out.length > 900) return null;
  return out;
}

function prefixOk(prefix) {
  const p = String(prefix || "").replace(/\\/g, "/");
  if (!p.endsWith("/")) return false;
  return ALLOWED_PREFIXES.some((a) => p === a || p.startsWith(a));
}

function sanitizeFolderName(input) {
  const name = String(input || "")
    .replace(/[\\/]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || name === "." || name === "..") return null;
  if (name.includes("\0") || name.length > 80) return null;
  if (!/^[\p{L}\p{N} ._'-]+$/u.test(name)) return null;
  return name;
}

async function putKeep(key) {
  const bucket = await bucketInfo();
  const up = await b2("b2_get_upload_url", { bucketId: bucket.bucketId });
  const res = await fetch(up.uploadUrl, {
    method: "POST",
    headers: {
      Authorization: up.authorizationToken,
      "X-Bz-File-Name": encodeURIComponent(key),
      "Content-Type": "application/octet-stream",
      "X-Bz-Content-Sha1": "da39a3ee5e6b4b0d3255bfef95601890afd80709",
      "Content-Length": "0",
    },
    body: Buffer.alloc(0),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.code || "mkdir failed");
    err.status = res.status;
    throw err;
  }
  return data;
}

let recentCache = { at: 0, files: [] };

async function listRecent(limit) {
  if (Date.now() - recentCache.at < 5_000 && recentCache.files.length) {
    return recentCache.files.slice(0, limit);
  }
  const bucket = await bucketInfo();
  const prefixes = ["YT-MAIN/00_INBOX/", "YT-MAIN/episodes/"];
  const all = [];
  for (const prefix of prefixes) {
    let startFileName;
    for (let page = 0; page < 15; page++) {
      const listed = await b2("b2_list_file_names", {
        bucketId: bucket.bucketId,
        prefix,
        maxFileCount: 1000,
        ...(startFileName ? { startFileName } : {}),
      });
      for (const f of listed.files || []) {
        if (f.action !== "upload") continue;
        const base = String(f.fileName || "").split("/").pop();
        if (!base || base === ".keep") continue;
        const folder = f.fileName.slice(0, Math.max(0, f.fileName.length - base.length));
        all.push({
          key: f.fileName,
          name: base,
          folder,
          size: f.contentLength,
          uploaded: f.uploadTimestamp,
          fileId: f.fileId,
        });
      }
      if (!listed.nextFileName) break;
      startFileName = listed.nextFileName;
    }
  }
  all.sort((a, b) => (b.uploaded || 0) - (a.uploaded || 0));
  recentCache = { at: Date.now(), files: all };
  return all.slice(0, limit);
}

function bumpRecent() {
  recentCache = { at: 0, files: [] };
}

function runCapture(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, ...opts });
    let out = "";
    let err = "";
    child.stdout?.on("data", (b) => {
      out += b.toString("utf8");
    });
    child.stderr?.on("data", (b) => {
      err += b.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        const e = new Error(err.trim() || out.trim() || `${cmd} failed`);
        reject(e);
        return;
      }
      resolve(out.trim());
    });
  });
}

async function pickFolderNative() {
  if (process.platform === "darwin") {
    const out = await runCapture("osascript", [
      "-e",
      'POSIX path of (choose folder with prompt "Pasta pra enviar ao arquivo")',
    ]);
    const folder = out.replace(/\/$/, "");
    if (!folder || !fs.existsSync(folder)) {
      const e = new Error("nenhuma pasta");
      e.status = 400;
      throw e;
    }
    return { path: folder };
  }
  if (process.platform === "win32") {
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
      '$d.Description = "Pasta pra enviar ao arquivo"',
      "$d.ShowNewFolderButton = $false",
      "if ($d.ShowDialog() -ne 'OK') { exit 2 }",
      "[Console]::Out.Write($d.SelectedPath)",
    ].join("; ");
    try {
      const out = await runCapture("powershell", ["-NoProfile", "-STA", "-Command", ps]);
      if (!out || !fs.existsSync(out)) {
        const e = new Error("nenhuma pasta");
        e.status = 400;
        throw e;
      }
      return { path: out };
    } catch (err) {
      if (String(err.message).includes("exit") || err.message) {
        const e = new Error("escolha cancelada ou o diálogo não abriu");
        e.status = 400;
        throw e;
      }
      throw err;
    }
  }
  const e = new Error("escolher pasta nativa só no Mac ou Windows");
  e.status = 501;
  throw e;
}

function sanitizeFileName(input) {
  const name = String(input || "").replace(/[\\/]/g, "").trim();
  if (!name || name === "." || name === "..") return null;
  if (/[\x00-\x1f]/.test(name) || name.length > 180) return null;
  return name;
}

const duCache = new Map();
const DU_TTL_MS = 90_000;

async function folderDu(prefix) {
  const hit = duCache.get(prefix);
  if (hit && Date.now() - hit.at < DU_TTL_MS) {
    return { prefix: hit.prefix, bytes: hit.bytes, files: hit.files, truncated: hit.truncated };
  }
  const listed = await listAllUnder(prefix);
  let bytes = 0;
  let files = 0;
  for (const f of listed) {
    const base = String(f.fileName || "").split("/").pop();
    if (!base || base === ".keep") continue;
    bytes += Number(f.contentLength || 0);
    files += 1;
  }
  const out = { prefix, bytes, files, truncated: listed.length >= 30_000 };
  duCache.set(prefix, { ...out, at: Date.now() });
  return out;
}

async function remoteMap(prefix) {
  const listed = await listAllUnder(prefix);
  const map = new Map();
  for (const f of listed) {
    const rel = String(f.fileName || "").slice(prefix.length).replace(/\\/g, "/");
    const base = rel.split("/").pop();
    if (!rel || !base || base === ".keep") continue;
    map.set(rel.toLowerCase(), { key: f.fileName, size: Number(f.contentLength || 0) });
  }
  return map;
}

async function scanUpload(srcPath, destPrefix) {
  const local = walkLocal(srcPath);
  const remote = await remoteMap(destPrefix);
  const collisions = findCollisions(local.files, remote);
  return {
    destPrefix,
    localFiles: local.files.length,
    localBytes: local.files.reduce((s, f) => s + (f.size || 0), 0),
    collisions,
  };
}

async function deleteRemoteKey(fileKey) {
  const parent = fileKey.slice(0, fileKey.lastIndexOf("/") + 1);
  const found = (await listAllUnder(parent)).filter((f) => f.fileName === fileKey);
  for (const f of found) {
    await b2("b2_delete_file_version", { fileId: f.fileId, fileName: f.fileName });
  }
  return found.length;
}

function shipOps() {
  const dump = ops.dump();
  if (!dump.trim()) return { ok: true, skipped: true };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const host = os.hostname().replace(/[^\w.-]+/g, "");
  const tmp = path.join(os.tmpdir(), `atlas-ops-${host}-${stamp}.jsonl`);
  fs.writeFileSync(tmp, dump);
  const dest = `b2:${BUCKET}/YT-MAIN/00_APPS/inbox-mac/ops/${host}-${stamp}.jsonl`;
  const bin = jobs.findRcloneBin();
  const run = spawnSync(bin, ["copyto", tmp, dest, "--retries", "2"], { encoding: "utf8", windowsHide: true });
  if (run.status !== 0) {
    throw new Error((run.stderr || run.stdout || "rclone log").slice(-300));
  }
  ops.write("info", "ops_shipped", { dest });
  return { ok: true, dest };
}

function safeRenameRel(rel, newName) {
  const cleanRel = String(rel).replace(/\\/g, "/");
  const parent = cleanRel.includes("/") ? cleanRel.slice(0, cleanRel.lastIndexOf("/") + 1) : "";
  const base = String(newName || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop();
  if (!base || base === "." || base === ".." || base.includes("..")) {
    throw new Error("nome novo inválido");
  }
  return parent + base;
}

async function listAllUnder(prefix) {
  const bucket = await bucketInfo();
  const out = [];
  let startFileName;
  for (let page = 0; page < 30; page++) {
    const listed = await b2("b2_list_file_names", {
      bucketId: bucket.bucketId,
      prefix,
      maxFileCount: 1000,
      ...(startFileName ? { startFileName } : {}),
    });
    for (const f of listed.files || []) {
      if (f.action === "upload") out.push(f);
    }
    if (!listed.nextFileName) break;
    startFileName = listed.nextFileName;
  }
  return out;
}

async function moveFile(fileId, fromKey, toKey) {
  if (fromKey === toKey) return;
  await b2("b2_copy_file", { sourceFileId: fileId, fileName: toKey });
  await b2("b2_delete_file_version", { fileId, fileName: fromKey });
}

async function b2DownloadUrl(key) {
  const s = await authorize();
  const bucket = await bucketInfo();
  const authz = await b2("b2_get_download_authorization", {
    bucketId: bucket.bucketId,
    fileNamePrefix: key,
    validDurationInSeconds: 3600,
  });
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${s.downloadUrl}/file/${BUCKET}/${encoded}?Authorization=${encodeURIComponent(authz.authorizationToken)}`;
}

async function authorize(force = false) {
  if (!force && session && Date.now() - sessionAt < SESSION_MS) return session;
  const { keyId, appKey } = credentials();
  const token = Buffer.from(`${keyId}:${appKey}`).toString("base64");
  const res = await fetch("https://api.backblaze.com/b2api/v2/b2_authorize_account", {
    headers: { Authorization: `Basic ${token}` },
  });
  const data = await res.json();
  if (!res.ok) {
    session = null;
    throw new Error(data.message || data.code || "b2 authorize failed");
  }
  session = data;
  sessionAt = Date.now();
  return session;
}

async function b2(api, body = {}) {
  let s = await authorize();
  const call = async (sess) => {
    const res = await fetch(`${sess.apiUrl}/b2api/v2/${api}`, {
      method: "POST",
      headers: {
        Authorization: sess.authorizationToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  };
  let { res, data } = await call(s);
  if (res.status === 401) {
    s = await authorize(true);
    ({ res, data } = await call(s));
  }
  if (!res.ok) {
    const err = new Error(data.message || data.code || api);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function bucketInfo() {
  const s = await authorize();
  const list = await b2("b2_list_buckets", {
    accountId: s.accountId,
    bucketName: BUCKET,
  });
  const bucket = (list.buckets || []).find((b) => b.bucketName === BUCKET);
  if (!bucket) throw new Error(`bucket ${BUCKET} not found`);
  return bucket;
}

async function ensureCors() {
  const bucket = await bucketInfo();
  const origins = Array.from(
    new Set([PUBLIC_ORIGIN, `http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`])
  );
  const rule = {
    corsRuleName: CORS_NAME,
    allowedOrigins: origins,
    allowedHeaders: [
      "authorization",
      "content-type",
      "x-bz-file-name",
      "x-bz-content-sha1",
      "x-bz-part-number",
      "x-bz-info-uploader",
      "x-bz-info-src",
    ],
    allowedOperations: ["b2_upload_file", "b2_upload_part"],
    exposeHeaders: ["x-bz-file-id", "x-bz-content-sha1", "x-bz-file-name"],
    maxAgeSeconds: 3600,
  };
  const existing = bucket.corsRules || [];
  const others = existing.filter((r) => r.corsRuleName !== CORS_NAME);
  const same =
    existing.some(
      (r) =>
        r.corsRuleName === CORS_NAME &&
        JSON.stringify(r.allowedOrigins?.slice().sort()) === JSON.stringify(origins.slice().sort())
    );
  if (same) return { ok: true, skipped: true };
  const s = await authorize();
  await b2("b2_update_bucket", {
    accountId: s.accountId,
    bucketId: bucket.bucketId,
    corsRules: [...others, rule],
  });
  return { ok: true, updated: true };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const ip = req.socket.remoteAddress || "?";

  try {
    if (url.pathname === "/health") {
      json(res, 200, {
        ok: true,
        version: APP_VERSION,
        platform: process.platform,
        bind: BIND,
        rclone: jobs.findRcloneBin(),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      if (!rateOk(`login:${ip}`, 8, 10 * 60 * 1000)) {
        json(res, 429, { error: "slow down" });
        return;
      }
      const body = await readJson(req);
      if (String(body.token || "") !== TOKEN || !TOKEN || TOKEN === "change-me") {
        json(res, 401, { error: "chave inválida" });
        return;
      }
      json(res, 200, { ok: true }, { "set-cookie": setAuthCookie() });
      return;
    }

    const isApi = url.pathname.startsWith("/api/");
    if (isApi && !authed(req, url)) {
      json(res, 401, { error: "need access key" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/destinations") {
      json(res, 200, {
        bucket: BUCKET,
        destinations: DESTINATIONS,
        cameras: CAMERAS,
        today: new Date().toISOString().slice(0, 10),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/ls") {
      if (!rateOk(`ls:${ip}`, 40, 60_000)) {
        json(res, 429, { error: "slow down" });
        return;
      }
      let prefix = String(url.searchParams.get("prefix") || "YT-MAIN/00_INBOX/");
      if (!prefix.endsWith("/")) prefix += "/";
      if (!prefixOk(prefix)) {
        json(res, 400, { error: "prefix not allowed" });
        return;
      }
      const bucket = await bucketInfo();
      const listed = await b2("b2_list_file_names", {
        bucketId: bucket.bucketId,
        prefix,
        delimiter: "/",
        maxFileCount: 1000,
      });
      const folders = (listed.files || [])
        .filter((f) => f.action === "folder")
        .map((f) => ({ name: f.fileName.slice(prefix.length).replace(/\/$/, ""), type: "folder" }));
      const files = (listed.files || [])
        .filter((f) => f.action === "upload")
        .map((f) => ({
          name: f.fileName.slice(prefix.length),
          type: "file",
          size: f.contentLength,
          uploaded: f.uploadTimestamp,
          fileId: f.fileId,
        }))
        .filter((f) => f.name && f.name !== ".keep" && !f.name.endsWith("/.keep"));
      json(res, 200, { prefix, folders, files });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/du") {
      if (!rateOk(`du:${ip}`, 40, 60_000)) {
        json(res, 429, { error: "slow down" });
        return;
      }
      let prefix = String(url.searchParams.get("prefix") || "");
      if (!prefix.endsWith("/")) prefix += "/";
      if (!prefixOk(prefix)) {
        json(res, 400, { error: "prefix not allowed" });
        return;
      }
      json(res, 200, await folderDu(prefix));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/recent") {
      if (!rateOk(`recent:${ip}`, 30, 60_000)) {
        json(res, 429, { error: "slow down" });
        return;
      }
      const limit = Math.min(40, Math.max(1, Number(url.searchParams.get("limit") || 20)));
      json(res, 200, { files: await listRecent(limit) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/mkdir") {
      if (!rateOk(`mkdir:${ip}`, 20, 60_000)) {
        json(res, 429, { error: "slow down" });
        return;
      }
      const body = await readJson(req);
      let prefix = String(body.prefix || "");
      if (!prefix.endsWith("/")) prefix += "/";
      const name = sanitizeFolderName(body.name);
      if (!prefixOk(prefix) || !name) {
        json(res, 400, { error: "nome de pasta inválido" });
        return;
      }
      const key = sanitizeKey(`${prefix}${name}/.keep`);
      if (!key) {
        json(res, 400, { error: "pasta fora do drive" });
        return;
      }
      await putKeep(key);
      bumpRecent();
      ops.write("info", "mkdir", { prefix: `${prefix}${name}/` });
      json(res, 200, { ok: true, prefix: `${prefix}${name}/`, name });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/move") {
      if (!rateOk(`move:${ip}`, 40, 60_000)) {
        json(res, 429, { error: "slow down" });
        return;
      }
      const body = await readJson(req);
      const fromKey = String(body.fromKey || "").replace(/\\/g, "/");
      const toKeyRaw = String(body.toKey || "").replace(/\\/g, "/");
      const isFolder = fromKey.endsWith("/");
      if (isFolder) {
        const fromPrefix = fromKey.endsWith("/") ? fromKey : fromKey + "/";
        let toPrefix = toKeyRaw.endsWith("/") ? toKeyRaw : toKeyRaw + "/";
        if (!prefixOk(fromPrefix) || !prefixOk(toPrefix)) {
          json(res, 400, { error: "pasta fora do drive" });
          return;
        }
        if (toPrefix.startsWith(fromPrefix)) {
          json(res, 400, { error: "não dá pra mover uma pasta pra dentro dela" });
          return;
        }
        const files = await listAllUnder(fromPrefix);
        for (const f of files) {
          const rel = f.fileName.slice(fromPrefix.length);
          const dest = sanitizeKey(toPrefix + rel);
          if (!dest) continue;
          await moveFile(f.fileId, f.fileName, dest);
        }
        bumpRecent();
        ops.write("info", "move_folder", { from: fromPrefix, to: toPrefix, n: files.length });
        json(res, 200, { ok: true, moved: files.length });
        return;
      }
      const from = sanitizeKey(fromKey);
      const to = sanitizeKey(toKeyRaw);
      if (!from || !to) {
        json(res, 400, { error: "caminho inválido" });
        return;
      }
      let fileId = String(body.fileId || "");
      if (!fileId) {
        const parent = from.slice(0, from.lastIndexOf("/") + 1);
        const found = (await listAllUnder(parent)).find((f) => f.fileName === from);
        fileId = found?.fileId || "";
      }
      if (!fileId) {
        json(res, 400, { error: "arquivo não encontrado" });
        return;
      }
      await moveFile(fileId, from, to);
      bumpRecent();
      ops.write("info", "move", { from, to });
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/delete") {
      if (!rateOk(`del:${ip}`, 20, 60_000)) {
        json(res, 429, { error: "slow down" });
        return;
      }
      const body = await readJson(req);
      const key = String(body.key || "").replace(/\\/g, "/");
      if (key.endsWith("/")) {
        const prefix = key;
        if (!prefixOk(prefix)) {
          json(res, 400, { error: "pasta fora do drive" });
          return;
        }
        if (ALLOWED_PREFIXES.includes(prefix)) {
          json(res, 400, { error: "não apaga a raiz do drive" });
          return;
        }
        const files = await listAllUnder(prefix);
        for (const f of files) {
          await b2("b2_delete_file_version", { fileId: f.fileId, fileName: f.fileName });
        }
        bumpRecent();
        ops.write("info", "delete_folder", { prefix, n: files.length });
        json(res, 200, { ok: true, deleted: files.length });
        return;
      }
      const fileKey = sanitizeKey(key);
      if (!fileKey) {
        json(res, 400, { error: "caminho inválido" });
        return;
      }
      let fileId = String(body.fileId || "");
      if (!fileId) {
        const parent = fileKey.slice(0, fileKey.lastIndexOf("/") + 1);
        const found = (await listAllUnder(parent)).find((f) => f.fileName === fileKey);
        fileId = found?.fileId || "";
      }
      if (!fileId) {
        json(res, 400, { error: "arquivo não encontrado" });
        return;
      }
      await b2("b2_delete_file_version", { fileId, fileName: fileKey });
      bumpRecent();
      ops.write("info", "delete", { key: fileKey });
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/simple-url") {
      if (!rateOk(`up:${ip}`, 80, 60_000)) {
        json(res, 429, { error: "slow down" });
        return;
      }
      const body = await readJson(req);
      const key = sanitizeKey(body.key);
      if (!key) {
        json(res, 400, { error: "bad key" });
        return;
      }
      const bucket = await bucketInfo();
      const up = await b2("b2_get_upload_url", { bucketId: bucket.bucketId });
      json(res, 200, {
        mode: "simple",
        key,
        uploadUrl: up.uploadUrl,
        authorizationToken: up.authorizationToken,
        fileNameHeader: encodeURIComponent(key),
        contentType: String(body.contentType || "b2/x-auto").slice(0, 120),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/large/start") {
      if (!rateOk(`up:${ip}`, 80, 60_000)) {
        json(res, 429, { error: "slow down" });
        return;
      }
      const body = await readJson(req);
      const key = sanitizeKey(body.key);
      if (!key) {
        json(res, 400, { error: "bad key" });
        return;
      }
      const bucket = await bucketInfo();
      const started = await b2("b2_start_large_file", {
        bucketId: bucket.bucketId,
        fileName: key,
        contentType: String(body.contentType || "b2/x-auto").slice(0, 120),
      });
      json(res, 200, { mode: "large", key, fileId: started.fileId });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/large/part-url") {
      const body = await readJson(req);
      const fileId = String(body.fileId || "");
      if (!fileId || fileId.length > 200) {
        json(res, 400, { error: "bad fileId" });
        return;
      }
      const up = await b2("b2_get_upload_part_url", { fileId });
      json(res, 200, {
        uploadUrl: up.uploadUrl,
        authorizationToken: up.authorizationToken,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/large/finish") {
      const body = await readJson(req, 512 * 1024);
      const fileId = String(body.fileId || "");
      const sha1s = Array.isArray(body.sha1s) ? body.sha1s.map(String) : [];
      if (!fileId || !sha1s.length || sha1s.length > 10000) {
        json(res, 400, { error: "bad finish" });
        return;
      }
      if (sha1s.some((h) => !/^[a-f0-9]{40}$/i.test(h))) {
        json(res, 400, { error: "bad sha1" });
        return;
      }
      const done = await b2("b2_finish_large_file", {
        fileId,
        partSha1Array: sha1s,
      });
      json(res, 200, {
        ok: true,
        fileName: done.fileName,
        size: done.contentLength,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/large/cancel") {
      const body = await readJson(req);
      const fileId = String(body.fileId || "");
      if (!fileId) {
        json(res, 400, { error: "bad fileId" });
        return;
      }
      await b2("b2_cancel_large_file", { fileId }).catch(() => {});
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/pick-folder") {
      if (!rateOk(`pick:${ip}`, 10, 60_000)) {
        json(res, 429, { error: "slow down" });
        return;
      }
      try {
        const picked = await pickFolderNative();
        json(res, 200, picked);
      } catch (err) {
        json(res, err.status || 400, { error: err.message });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/jobs") {
      json(res, 200, { jobs: jobs.list() });
      return;
    }

    const jobOne = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (req.method === "GET" && jobOne) {
      const row = jobs.get(decodeURIComponent(jobOne[1]));
      if (!row) {
        json(res, 404, { error: "job não encontrado" });
        return;
      }
      json(res, 200, row);
      return;
    }

    const jobAct = url.pathname.match(/^\/api\/jobs\/([^/]+)\/(cancel|pause|resume|restart|verify)$/);
    if (req.method === "POST" && jobAct) {
      const id = decodeURIComponent(jobAct[1]);
      const act = jobAct[2];
      const fn = jobs[act];
      json(res, 200, fn(id));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/cache/reset") {
      const body = await readJson(req).catch(() => ({}));
      json(res, 200, jobs.resetCache({ thumbs: body.thumbs !== false, jobsClear: body.jobs === true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/scan") {
      if (!rateOk(`scan:${ip}`, 12, 60_000)) {
        json(res, 429, { error: "slow down" });
        return;
      }
      const body = await readJson(req);
      const srcPath = String(body.srcPath || "").trim();
      let destPrefix = String(body.destPrefix || "YT-MAIN/00_INBOX/");
      if (!destPrefix.endsWith("/")) destPrefix += "/";
      if (!prefixOk(destPrefix)) {
        json(res, 400, { error: "prefix not allowed" });
        return;
      }
      try {
        const scan = await scanUpload(srcPath, destPrefix);
        ops.write("info", "scan", {
          destPrefix,
          files: scan.localFiles,
          collisions: (scan.collisions || []).length,
        });
        json(res, 200, scan);
      } catch (err) {
        ops.write("error", "scan_fail", { destPrefix, error: err.message });
        json(res, 400, { error: err.message || "scan failed" });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/jobs") {
      if (!rateOk(`job:${ip}`, 20, 60_000)) {
        json(res, 429, { error: "slow down" });
        return;
      }
      const body = await readJson(req);
      let srcPath = String(body.srcPath || "").trim();
      if (!srcPath) {
        json(res, 400, { error: "escolhe a pasta primeiro" });
        return;
      }
      let destPrefix = String(body.destPrefix || "YT-MAIN/00_INBOX/");
      if (!destPrefix.endsWith("/")) destPrefix += "/";
      const dryRun =
        body.dryRun === true ||
        process.env.RCLONE_DRY_RUN === "1" ||
        process.env.RCLONE_DRY_RUN === "true";
      try {
        if (!prefixOk(destPrefix)) throw new Error("prefix not allowed");
        const local = walkLocal(srcPath);
        const remote = await remoteMap(destPrefix);
        const collisions = findCollisions(local.files, remote);
        const plan = planDecisions(collisions, body.decisions);
        for (const r of plan.replace) {
          await deleteRemoteKey(r.remoteKey);
        }
        const skipSet = new Set(plan.skip.map((x) => x.rel));
        const renameSet = new Set(plan.rename.map((x) => x.rel));
        const excludes = [...skipSet, ...renameSet];
        const remaining = local.files.filter((f) => !skipSet.has(f.rel) && !renameSet.has(f.rel));
        const extras = plan.rename.map((r) => {
          const loc = local.files.find((f) => f.rel === r.rel);
          if (!loc) throw new Error(`arquivo local sumiu: ${r.rel}`);
          const newRel = safeRenameRel(r.rel, r.newName);
          const destKey = `${destPrefix}${newRel}`;
          if (!sanitizeKey(destKey)) throw new Error("nome novo fora do drive");
          return { srcFile: loc.abs, destUri: b2DestUri(BUCKET, destPrefix) + newRel };
        });
        const job = jobs.createJob({
          srcPath,
          destPrefix,
          bucket: BUCKET,
          remote: process.env.RCLONE_REMOTE || "b2",
          dryRun,
          excludes,
          extras,
          skipMainCopy: remaining.length === 0,
        });
        ops.write("info", "job_start", {
          id: job.id,
          destPrefix,
          files: remaining.length,
          skip: skipSet.size,
          rename: extras.length,
        });
        json(res, 200, job);
      } catch (err) {
        const msg = String(err.message || "job failed");
        ops.write("error", "job_fail", { destPrefix, error: msg });
        const bad =
          /not allowed|não encontrada|inválida|bad bucket|missing srcPath/.test(msg);
        json(res, bad ? 400 : 500, { error: msg });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/download-url") {
      if (!rateOk(`dl:${ip}`, 40, 60_000)) {
        json(res, 429, { error: "slow down" });
        return;
      }
      const key = sanitizeKey(url.searchParams.get("key") || "");
      if (!key || key.endsWith("/")) {
        json(res, 400, { error: "bad key" });
        return;
      }
      json(res, 200, {
        url: await b2DownloadUrl(key),
        name: key.split("/").pop(),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/thumb") {
      if (!rateOk(`thumb:${ip}`, 120, 60_000)) {
        json(res, 429, { error: "slow down" });
        return;
      }
      const key = sanitizeKey(url.searchParams.get("key") || "");
      if (!key || key.endsWith("/")) {
        json(res, 400, { error: "bad key" });
        return;
      }
      const fileId = String(url.searchParams.get("id") || "").slice(0, 200);
      try {
        const jpg = await thumbs.ensure(key, fileId);
        send(res, 200, fs.readFileSync(jpg), {
          "content-type": "image/jpeg",
          "cache-control": "private, max-age=86400",
        });
      } catch {
        send(res, 204, "", { "cache-control": "no-store" });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/ops") {
      json(res, 200, { events: ops.tail(Number(url.searchParams.get("n") || 80)) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ops/ship") {
      try {
        json(res, 200, await shipOps());
      } catch (err) {
        json(res, 500, { error: err.message || "não mandou o log" });
      }
      return;
    }

    if (isApi) {
      ops.write("warn", "api_404", { path: url.pathname, method: req.method });
      json(res, 404, {
        error: "not found",
        path: url.pathname,
        hint: "servidor velho na memória — fecha, clica de novo no ATLAS Inbox",
      });
      return;
    }

    let rel = url.pathname === "/" ? "/index.html" : url.pathname;
    if (rel === "/drive" || rel === "/drive/") rel = "/explorer.html";
    const file = safeJoin(PUBLIC, rel);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      send(res, 404, "not found", { "content-type": "text/plain; charset=utf-8" });
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    const extra = {};
    if (url.searchParams.get("k") === TOKEN && TOKEN && TOKEN !== "change-me") {
      extra["set-cookie"] = setAuthCookie();
    }
    send(res, 200, fs.readFileSync(file), {
      "content-type": type,
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=600",
      ...extra,
    });
  } catch (err) {
    ops.write("error", "request_fail", { path: url.pathname, method: req.method, error: err.message });
    console.error(new Date().toISOString(), req.method, url.pathname, err.message);
    if (!res.headersSent) {
      const status = err.status && err.status < 500 ? err.status : 500;
      json(res, status, { error: status === 500 ? "server error" : err.message });
    }
  }
});

if (!TOKEN || TOKEN === "change-me") {
  console.error("INBOX_TOKEN missing — refuse to start");
  process.exit(1);
}

ensureCors()
  .then((r) => console.log("cors", r))
  .catch((err) => console.error("cors setup skipped", err.message));

server.listen(PORT, BIND, () => {
  console.log(`inbox-mac on http://${BIND}:${PORT} origin=${PUBLIC_ORIGIN}`);
});
