/**
 * Video/image thumbs via ffmpeg. Cache on disk. Max 2 ffmpeg at a time.
 * First open of a folder is a few seconds per clip; after that the jpg is local.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

export function findFfmpeg() {
  if (process.env.FFMPEG_BIN && fs.existsSync(process.env.FFMPEG_BIN)) {
    return process.env.FFMPEG_BIN;
  }
  const cands = [
    path.join(os.homedir(), "AppData", "Local", "Microsoft", "WinGet", "Links", "ffmpeg.exe"),
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ];
  for (const p of cands) {
    if (fs.existsSync(p)) return p;
  }
  return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

function cacheName(key, fileId) {
  const raw = fileId || key;
  return crypto.createHash("sha1").update(String(raw)).digest("hex") + ".jpg";
}

function runFfmpeg(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let err = "";
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffmpeg timeout"));
    }, timeoutMs);
    child.stderr?.on("data", (b) => {
      err += b.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(t);
      if (code === 0) resolve();
      else reject(new Error(err.trim().slice(-400) || `ffmpeg ${code}`));
    });
  });
}

export function createThumbs({ dir, getSourceUrl }) {
  fs.mkdirSync(dir, { recursive: true });
  const bin = findFfmpeg();
  const queue = [];
  let active = 0;
  const MAX = 2;

  function pump() {
    while (active < MAX && queue.length) {
      const job = queue.shift();
      active += 1;
      job
        .fn()
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  }

  function enqueue(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      pump();
    });
  }

  async function grab(key, dest) {
    const url = await getSourceUrl(key);
    const tmp = dest + ".tmp.jpg";
    const vf = "scale=320:-2:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2";
    try {
      await runFfmpeg(
        bin,
        ["-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", url, "-frames:v", "1", "-vf", vf, "-q:v", "5", tmp],
        22_000
      );
    } catch {
      await runFfmpeg(
        bin,
        ["-hide_banner", "-loglevel", "error", "-y", "-i", url, "-ss", "0.4", "-frames:v", "1", "-vf", vf, "-q:v", "5", tmp],
        28_000
      );
    }
    if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 200) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      throw new Error("thumb vazio");
    }
    fs.renameSync(tmp, dest);
    return dest;
  }

  function pathFor(key, fileId) {
    return path.join(dir, cacheName(key, fileId));
  }

  async function ensure(key, fileId) {
    const dest = pathFor(key, fileId);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 200) return dest;
    return enqueue(() => grab(key, dest));
  }

  return { ensure, pathFor, ffmpeg: bin };
}
