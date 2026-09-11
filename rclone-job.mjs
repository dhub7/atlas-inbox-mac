/**
 * rclone copy jobs for ATLAS Inbox on the local machine.
 * Never pass --delete. Prefix must stay inside the B2 allowlist.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

export const ALLOWED_PREFIXES = [
  "YT-MAIN/00_INBOX/",
  "YT-MAIN/episodes/micanopy/",
  "YT-MAIN/episodes/south-dakota-p1/",
  "YT-MAIN/episodes/south-dakota-p2/",
  "dropbox-mirror/",
];

const FORBIDDEN_FLAGS = ["--delete", "--delete-excluded", "--b2-hard-delete"];

export function assertAllowedPrefix(prefix) {
  const p = String(prefix || "").replace(/\\/g, "/").trim();
  const withSlash = p.endsWith("/") ? p : `${p}/`;
  if (!withSlash || withSlash.includes("\0") || withSlash.includes("..")) {
    throw new Error("prefix not allowed");
  }
  const ok = ALLOWED_PREFIXES.some((a) => withSlash === a || withSlash.startsWith(a));
  if (!ok) throw new Error("prefix not allowed");
  return withSlash;
}

export function destUri(bucket, prefix, remote = "b2") {
  const p = assertAllowedPrefix(prefix);
  const b = String(bucket || "atlas-victor-bruto").trim();
  if (b !== "atlas-victor-bruto") throw new Error("bad bucket");
  const r = String(remote || "b2").trim() || "b2";
  if (!/^[A-Za-z0-9_-]+$/.test(r)) throw new Error("bad remote");
  return `${r}:${b}/${p}`;
}

function transferFlags(dryRun) {
  const args = [
    "--progress",
    "--checksum",
    "--fast-list",
    "--transfers",
    "8",
    "--b2-upload-concurrency",
    "4",
    "--retries",
    "20",
    "--low-level-retries",
    "20",
    "--stats",
    "1s",
    "--exclude",
    ".DS_Store",
    "--exclude",
    "._*",
    "--exclude",
    ".Trash/**",
  ];
  if (dryRun) args.push("--dry-run");
  return args;
}

export function buildCopyArgs({ srcPath, destUri: dest, dryRun = false, excludes = [] }) {
  if (!srcPath) throw new Error("missing srcPath");
  if (!dest || !String(dest).includes(":")) throw new Error("missing destUri");
  const args = ["copy", srcPath, dest, ...transferFlags(dryRun)];
  for (const rel of excludes) {
    const n = String(rel).replace(/\\/g, "/").replace(/^\/+/, "");
    if (!n || n.includes("..")) continue;
    args.push("--exclude", `/${n}`);
  }
  for (const bad of FORBIDDEN_FLAGS) {
    if (args.includes(bad)) throw new Error(`forbidden flag ${bad}`);
  }
  return args;
}

export function buildCopytoArgs({ srcFile, destUri: dest, dryRun = false }) {
  if (!srcFile || !dest) throw new Error("missing copyto paths");
  const args = [
    "copyto",
    srcFile,
    dest,
    "--progress",
    "--checksum",
    "--retries",
    "20",
    "--low-level-retries",
    "20",
    "--stats",
    "1s",
  ];
  if (dryRun) args.push("--dry-run");
  for (const bad of FORBIDDEN_FLAGS) {
    if (args.includes(bad)) throw new Error(`forbidden flag ${bad}`);
  }
  return args;
}

export function parseSizeToBytes(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^([\d.]+)\s*([KMGTPE]i?B|B)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] || "B").toUpperCase();
  const mul = {
    B: 1,
    KB: 1e3,
    MB: 1e6,
    GB: 1e9,
    TB: 1e12,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
  };
  return Math.round(n * (mul[unit] || 1));
}

export function parseProgress(line) {
  const text = String(line || "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
  if (!text) return null;
  const m = text.match(
    /Transferred:\s+([\d.]+\s*[KMGTPE]i?B|[0-9]+(?:\.[0-9]+)?\s*B)\s*\/\s*([\d.]+\s*[KMGTPE]i?B|[0-9]+(?:\.[0-9]+)?\s*B|-),\s*([^,]*),\s*([^,]*),\s*ETA\s+(\S+)/i
  );
  if (!m) return null;
  const bytes = parseSizeToBytes(m[1]);
  const total = m[2] === "-" ? null : parseSizeToBytes(m[2]);
  const pctRaw = m[3].trim();
  const percent = pctRaw.endsWith("%") ? Number(pctRaw.replace("%", "")) : null;
  const speed = m[4].trim();
  const eta = m[5].trim();
  return { bytes, total, percent: Number.isFinite(percent) ? percent : null, speed, eta, line: text };
}

/** rclone --progress uses \\r, not newlines. Also picks file counts. */
export function parseProgressChunk(text) {
  const clean = String(text || "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  const parts = clean.split(/\r\n|\n|\r/).map((s) => s.trim()).filter(Boolean);
  const out = {};
  for (const line of parts) {
    const bytes = parseProgress(line);
    if (bytes) Object.assign(out, bytes);
    if (/[KMGTPE]i?B/i.test(line)) continue;
    const files = line.match(/^Transferred:\s+(\d+)\s*\/\s*(\d+)/i);
    if (files) {
      out.filesDone = Number(files[1]);
      out.filesTotal = Number(files[2]);
    }
    const checks = line.match(/^Checks:\s+(\d+)\s*\/\s*(\d+)/i);
    if (checks) {
      out.checksDone = Number(checks[1]);
      out.checksTotal = Number(checks[2]);
    }
    const elapsed = line.match(/Elapsed time:\s+(\S+)/i);
    if (elapsed) out.elapsed = elapsed[1].replace(/,$/, "");
  }
  return Object.keys(out).length ? out : null;
}

export function newJobId() {
  return `j_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

export function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "jobs.json");
  const logDir = path.join(dir, "logs");
  fs.mkdirSync(logDir, { recursive: true });

  function load() {
    if (!fs.existsSync(file)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function save(jobs) {
    fs.writeFileSync(file, JSON.stringify(jobs, null, 2));
  }

  function publicJob(j) {
    return {
      id: j.id,
      status: j.status,
      srcPath: j.srcPath,
      destPrefix: j.destPrefix,
      destUri: j.destUri,
      bytes: j.bytes || 0,
      total: j.total || 0,
      percent: j.percent,
      speed: j.speed || "",
      eta: j.eta || "",
      elapsed: j.elapsed || "",
      filesDone: j.filesDone || 0,
      filesTotal: j.filesTotal || 0,
      error: j.error || "",
      startedAt: j.startedAt || null,
      endedAt: j.endedAt || null,
      verify: j.verify || null,
      dryRun: Boolean(j.dryRun),
    };
  }

  const children = new Map();

  function list() {
    return load().map(publicJob);
  }

  function get(id) {
    const j = load().find((x) => x.id === id);
    if (!j) return null;
    let logTail = "";
    if (j.logFile && fs.existsSync(j.logFile)) {
      const buf = fs.readFileSync(j.logFile, "utf8");
      logTail = buf.slice(-4000);
    }
    return { ...publicJob(j), logTail };
  }

  function upsert(job) {
    const jobs = load();
    const i = jobs.findIndex((x) => x.id === job.id);
    if (i >= 0) jobs[i] = job;
    else jobs.push(job);
    save(jobs);
    return job;
  }

  function findRcloneBin() {
    const env = process.env.RCLONE_BIN;
    if (env && fs.existsSync(env)) return env;
    const here = path.dirname(file);
    const local = [
      path.join(here, "..", "bin", process.platform === "win32" ? "rclone.exe" : "rclone"),
      path.join(here, "..", "bin", "rclone.exe"),
    ];
    for (const p of local) if (fs.existsSync(p)) return p;
    return process.platform === "win32" ? "rclone.exe" : "rclone";
  }

  function spawnCopy(job) {
    const bin = findRcloneBin();
    const logStream = fs.createWriteStream(job.logFile, { flags: "a" });
    const isMac = process.platform === "darwin";
    const extras = Array.isArray(job.extras) ? job.extras : [];

    const onChunk = (buf) => {
      const text = buf.toString("utf8");
      logStream.write(text);
      const prog = parseProgressChunk(text);
      if (!prog) return;
      if (prog.bytes != null) job.bytes = prog.bytes;
      if (prog.total != null) job.total = prog.total;
      if (prog.percent != null) job.percent = prog.percent;
      if (prog.speed) job.speed = prog.speed;
      if (prog.eta && prog.eta !== "-") job.eta = prog.eta;
      if (prog.elapsed) job.elapsed = prog.elapsed;
      if (prog.filesDone != null) job.filesDone = prog.filesDone;
      if (prog.filesTotal != null) job.filesTotal = prog.filesTotal;
      upsert(job);
    };

    const finish = (code, msg) => {
      children.delete(job.id);
      logStream.end();
      if (job.status === "cancelled") {
        job.endedAt = Date.now();
        upsert(job);
        return;
      }
      if (code === 0) {
        job.status = "done";
        job.percent = 100;
        job.error = "";
      } else {
        job.status = "paused_error";
        job.error = job.error || msg || `rclone saiu com código ${code}`;
      }
      job.endedAt = Date.now();
      upsert(job);
    };

    const runArgs = (args, then) => {
      const cmd = isMac ? "caffeinate" : bin;
      const cmdArgs = isMac ? ["-i", bin, ...args] : args;
      const child = spawn(cmd, cmdArgs, { env: { ...process.env }, windowsHide: true });
      job.pid = child.pid;
      children.set(job.id, child);
      child.stdout?.on("data", onChunk);
      child.stderr?.on("data", onChunk);
      child.on("error", (err) => finish(1, err.message));
      child.on("close", (code) => {
        if (job.status === "cancelled") {
          finish(code);
          return;
        }
        if (job.status === "paused") {
          children.delete(job.id);
          return;
        }
        then(code);
      });
    };

    const runExtras = (i) => {
      if (i >= extras.length) {
        finish(0);
        return;
      }
      const ex = extras[i];
      runArgs(
        buildCopytoArgs({ srcFile: ex.srcFile, destUri: ex.destUri, dryRun: job.dryRun }),
        (code) => {
          if (code !== 0) finish(code, `não copiou ${ex.srcFile}`);
          else runExtras(i + 1);
        }
      );
    };

    job.status = "running";
    job.startedAt = Date.now();
    upsert(job);

    if (job.skipMainCopy) {
      runExtras(0);
      return job;
    }
    runArgs(
      buildCopyArgs({
        srcPath: job.srcPath,
        destUri: job.destUri,
        dryRun: job.dryRun,
        excludes: job.excludes || [],
      }),
      (code) => {
        if (code !== 0) finish(code);
        else runExtras(0);
      }
    );
    return job;
  }

  function createJob({ srcPath, destPrefix, bucket, remote, dryRun, excludes, extras, skipMainCopy }) {
    const resolved = path.resolve(srcPath);
    if (!fs.existsSync(resolved)) throw new Error("pasta origem não encontrada");
    const st = fs.statSync(resolved);
    if (!st.isDirectory() && !st.isFile()) throw new Error("origem inválida");
    const prefix = assertAllowedPrefix(destPrefix);
    const uri = destUri(bucket, prefix, remote);
    const id = newJobId();
    const job = {
      id,
      status: "queued",
      srcPath: resolved,
      destPrefix: prefix,
      destUri: uri,
      dryRun: Boolean(dryRun),
      excludes: Array.isArray(excludes) ? excludes : [],
      extras: Array.isArray(extras) ? extras : [],
      skipMainCopy: Boolean(skipMainCopy),
      bytes: 0,
      total: st.isFile() ? st.size : 0,
      percent: null,
      speed: "",
      eta: "",
      elapsed: "",
      filesDone: 0,
      filesTotal: 0,
      error: "",
      pid: null,
      logFile: path.join(logDir, `${id}.log`),
      startedAt: null,
      endedAt: null,
    };
    upsert(job);
    if (job.skipMainCopy && !job.extras.length) {
      job.status = "done";
      job.percent = 100;
      job.startedAt = Date.now();
      job.endedAt = Date.now();
      upsert(job);
      return publicJob(job);
    }
    spawnCopy(job);
    return publicJob(job);
  }

  function cancel(id) {
    const jobs = load();
    const job = jobs.find((x) => x.id === id);
    if (!job) throw new Error("job não encontrado");
    const child = children.get(id);
    job.status = "cancelled";
    job.error = "cancelado";
    upsert(job);
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
    return publicJob(job);
  }

  function pause(id) {
    const job = load().find((x) => x.id === id);
    if (!job) throw new Error("job não encontrado");
    if (job.status !== "running" && job.status !== "queued") {
      throw new Error("nada pra pausar");
    }
    const child = children.get(id);
    job.status = "paused";
    job.error = "pausado — Continuar retoma (o que já subiu não vai de novo)";
    upsert(job);
    if (child && !child.killed) {
      try {
        child.kill("SIGSTOP");
      } catch {
        child.kill("SIGTERM");
      }
    }
    return publicJob(job);
  }

  function resume(id) {
    const job = load().find((x) => x.id === id);
    if (!job) throw new Error("job não encontrado");
    const child = children.get(id);
    if (child && job.status === "paused") {
      try {
        child.kill("SIGCONT");
        job.status = "running";
        job.error = "";
        upsert(job);
        return publicJob(job);
      } catch {
        /* fall through to respawn */
      }
    }
    if (job.status !== "paused" && job.status !== "paused_error" && job.status !== "cancelled") {
      throw new Error("nada pra retomar");
    }
    job.error = "";
    job.verify = null;
    spawnCopy(job);
    return publicJob(job);
  }

  function restart(id) {
    const job = load().find((x) => x.id === id);
    if (!job) throw new Error("job não encontrado");
    const child = children.get(id);
    if (child && !child.killed) child.kill("SIGTERM");
    job.error = "";
    job.verify = null;
    job.bytes = 0;
    job.percent = null;
    spawnCopy(job);
    return publicJob(job);
  }

  function verify(id) {
    const job = load().find((x) => x.id === id);
    if (!job) throw new Error("job não encontrado");
    const bin = findRcloneBin();
    const args = [
      "check",
      job.srcPath,
      job.destUri,
      "--one-way",
      "--checksum",
      "--fast-list",
    ];
    job.verify = { status: "running", summary: "conferindo checksums…" };
    upsert(job);
    const child = spawn(bin, args, { windowsHide: true });
    let out = "";
    child.stdout?.on("data", (b) => {
      out += b.toString("utf8");
    });
    child.stderr?.on("data", (b) => {
      out += b.toString("utf8");
    });
    child.on("close", (code) => {
      const tail = out.slice(-1500);
      job.verify = {
        status: code === 0 ? "ok" : "diff",
        summary: code === 0 ? "arquivos batem com o destino" : "tem diferença — vê o log",
        log: tail,
      };
      upsert(job);
    });
    return publicJob(job);
  }

  function resetCache({ thumbs = true, jobsClear = false } = {}) {
    const dataDir = path.dirname(file);
    const thumbsDir = path.join(dataDir, "thumbs");
    let cleared = [];
    if (thumbs && fs.existsSync(thumbsDir)) {
      for (const n of fs.readdirSync(thumbsDir)) {
        try {
          fs.unlinkSync(path.join(thumbsDir, n));
        } catch {
          /* skip */
        }
      }
      cleared.push("thumbs");
    }
    if (jobsClear) {
      for (const j of load()) {
        const child = children.get(j.id);
        if (child && !child.killed) child.kill("SIGTERM");
      }
      save([]);
      cleared.push("jobs");
    }
    return { ok: true, cleared };
  }

  function reconnect() {
    for (const job of load()) {
      if (job.status === "running") {
        job.status = "paused";
        job.error = "servidor reiniciou — Continuar retoma (rclone pula o que já subiu)";
        upsert(job);
      }
    }
  }

  reconnect();

  return { list, get, createJob, cancel, pause, resume, restart, verify, resetCache, findRcloneBin };
}
