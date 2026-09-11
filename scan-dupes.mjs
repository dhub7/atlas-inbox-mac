import fs from "node:fs";
import path from "node:path";

function skipName(n) {
  return n === ".DS_Store" || n.startsWith("._") || n === ".Trash" || n === "Thumbs.db";
}

export function walkLocal(srcPath) {
  const resolved = path.resolve(srcPath);
  if (!fs.existsSync(resolved)) throw new Error("pasta origem não encontrada");
  const st = fs.statSync(resolved);
  const files = [];
  if (st.isFile()) {
    files.push({ rel: path.basename(resolved), abs: resolved, size: st.size });
    return { root: path.dirname(resolved), files, isFile: true };
  }
  if (!st.isDirectory()) throw new Error("origem inválida");
  function walk(dir, relBase) {
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (skipName(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      const rel = (relBase ? `${relBase}/${ent.name}` : ent.name).replace(/\\/g, "/");
      if (ent.isDirectory()) walk(abs, rel);
      else if (ent.isFile()) {
        try {
          const s = fs.statSync(abs);
          files.push({ rel, abs, size: s.size });
        } catch {
          /* skip locked */
        }
      }
    }
  }
  walk(resolved, "");
  return { root: resolved, files, isFile: false };
}

export function suggestName(rel, taken) {
  const parts = String(rel).replace(/\\/g, "/").split("/");
  const base = parts.pop() || "arquivo";
  const i = base.lastIndexOf(".");
  const stem = i > 0 ? base.slice(0, i) : base;
  const ext = i > 0 ? base.slice(i) : "";
  const parent = parts.join("/");
  for (let n = 2; n < 500; n++) {
    const name = `${stem} (${n})${ext}`;
    const cand = parent ? `${parent}/${name}` : name;
    if (!taken.has(cand.toLowerCase())) return cand;
  }
  const fallback = `${stem} (${Date.now()})${ext}`;
  return parent ? `${parent}/${fallback}` : fallback;
}

export function findCollisions(localFiles, remoteByRel) {
  const collisions = [];
  const taken = new Set(remoteByRel.keys());
  for (const f of localFiles) taken.add(String(f.rel).replace(/\\/g, "/").toLowerCase());
  for (const f of localFiles) {
    const rel = String(f.rel).replace(/\\/g, "/");
    const hit = remoteByRel.get(rel.toLowerCase());
    if (!hit) continue;
    const suggestedName = suggestName(rel, taken);
    taken.add(suggestedName.toLowerCase());
    collisions.push({
      rel,
      localSize: f.size,
      remoteSize: hit.size,
      sameSize: Number(f.size) === Number(hit.size),
      remoteKey: hit.key,
      suggestedName,
    });
  }
  return collisions;
}

export function planDecisions(collisions, decisions) {
  const map = new Map();
  for (const d of decisions || []) {
    if (!d || !d.rel) continue;
    const action = d.action === "replace" || d.action === "rename" ? d.action : "skip";
    map.set(String(d.rel).replace(/\\/g, "/"), {
      action,
      newName: d.newName || "",
    });
  }
  const skip = [];
  const replace = [];
  const rename = [];
  for (const c of collisions) {
    const d = map.get(c.rel) || { action: c.sameSize ? "skip" : "rename", newName: c.suggestedName };
    if (d.action === "replace") replace.push(c);
    else if (d.action === "rename") {
      rename.push({ ...c, newName: (d.newName || c.suggestedName).replace(/\\/g, "/") });
    } else skip.push(c);
  }
  return { skip, replace, rename };
}
