import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function redact(s) {
  return String(s || "")
    .replace(/[A-Za-z]:\\Users\\[^\\]+/g, "~")
    .replace(/\/Users\/[^/]+/g, "~")
    .replace(/key[_-]?id[=:]\s*\S+/gi, "key_id=***")
    .replace(/application[_-]?key[=:]\s*\S+/gi, "application_key=***")
    .replace(/INBOX_TOKEN=\S+/g, "INBOX_TOKEN=***");
}

export function createOpsLog(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "ops.jsonl");

  function write(level, event, extra = {}) {
    const row = {
      ts: new Date().toISOString(),
      level,
      event,
      host: os.hostname(),
      platform: process.platform,
      ...extra,
    };
    const line = redact(JSON.stringify(row)) + "\n";
    try {
      fs.appendFileSync(file, line);
    } catch {
      /* ignore */
    }
  }

  function tail(n = 80) {
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
    return lines.slice(-Math.max(1, Math.min(n, 300))).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { ts: "", event: l };
      }
    });
  }

  function dump() {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  }

  return { write, tail, dump, file };
}
