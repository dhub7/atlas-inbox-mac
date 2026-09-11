const gate = document.getElementById("gate");
const app = document.getElementById("app");
const treeEl = document.getElementById("tree");
const listEl = document.getElementById("list");
const addr = document.getElementById("addr");
const statusEl = document.getElementById("status");
const titleEl = document.getElementById("win-title");
const recentEl = document.getElementById("recent");
const previewEl = document.getElementById("preview");
const listWrap = document.getElementById("list-wrap");
const colsEl = document.getElementById("cols");
const btnIcons = document.getElementById("btn-icons");
const btnList = document.getElementById("btn-list");

let destinations = [];
let prefix = "YT-MAIN/00_INBOX/";
const historyStack = [];
let selected = null;
let clip = null;
let dlgMode = "";
let viewMode = localStorage.getItem("atlas-drive-view") || "icons";

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function prettySize(n) {
  if (n == null || n === "") return "…";
  const v = Number(n);
  if (!Number.isFinite(v)) return "…";
  if (v < 1024) return `${v} bytes`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 ** 3) return `${(v / 1024 / 1024).toFixed(1)} MB`;
  if (v < 1024 ** 4) return `${(v / 1024 ** 3).toFixed(2)} GB`;
  return `${(v / 1024 ** 4).toFixed(2)} TB`;
}

function prettyDate(ms) {
  if (!ms) return "";
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function winPath(p) {
  return p.replace(/\//g, "\\");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extOf(name) {
  return (String(name).split(".").pop() || "").toLowerCase();
}

function typeOf(name, folder) {
  if (folder) return "Pasta de arquivos";
  const ext = extOf(name);
  if (["mp4", "mov", "mxf", "crm", "m4v"].includes(ext)) return "Vídeo";
  if (["wav", "mp3", "aac", "m4a"].includes(ext)) return "Áudio";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "Imagem";
  return ext ? `Arquivo ${ext.toUpperCase()}` : "Arquivo";
}

function glyphOf(name, folder) {
  if (folder) return "📁";
  const ext = extOf(name);
  if (["mp4", "mov", "mxf", "crm", "m4v"].includes(ext)) return "🎬";
  if (["wav", "mp3", "aac", "m4a"].includes(ext)) return "🎵";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "🖼️";
  return "📄";
}

function applyView() {
  const icons = viewMode === "icons";
  listEl.classList.toggle("icons", icons);
  listWrap.classList.toggle("icons-on", icons);
  btnIcons.classList.toggle("on", icons);
  btnList.classList.toggle("on", !icons);
  localStorage.setItem("atlas-drive-view", viewMode);
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const k = params.get("k");
  if (k) {
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ token: k }) });
      history.replaceState({}, "", "/drive");
    } catch {
      /* gate */
    }
  }
  try {
    const data = await api("/api/destinations");
    destinations = data.destinations;
    prefix = destinations[0]?.prefix || prefix;
    gate.classList.add("hidden");
    app.classList.remove("hidden");
    applyView();
    renderTree();
    await loadRecent();
    await openDir(prefix, false);
  } catch {
    gate.classList.remove("hidden");
    app.classList.add("hidden");
  }
}

document.getElementById("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("login-err");
  err.textContent = "";
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ token: document.getElementById("token").value }),
    });
    await boot();
  } catch (ex) {
    err.textContent = ex.message || "chave inválida";
  }
});

function renderTree() {
  treeEl.innerHTML = destinations
    .map(
      (d) =>
        `<button type="button" data-p="${escapeHtml(d.prefix)}" class="${prefix.startsWith(d.prefix) ? "on" : ""}">${escapeHtml(d.label)}</button>`
    )
    .join("");
  treeEl.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => openDir(b.getAttribute("data-p"), true));
  });
}

async function openDir(next, push) {
  if (push && next !== prefix) historyStack.push(prefix);
  prefix = next.endsWith("/") ? next : next + "/";
  selected = null;
  addr.value = winPath(prefix);
  const dest = destinations.find((d) => prefix.startsWith(d.prefix));
  titleEl.textContent = `Explorando — ${dest ? dest.label : "ATLAS"}`;
  renderTree();
  listEl.innerHTML = `<div class="row"><span class="name">abrindo...</span></div>`;
  try {
    const data = await api(`/api/ls?prefix=${encodeURIComponent(prefix)}`);
    const folders = data.folders || [];
    const files = data.files || [];
    const rows = [
      ...folders.map((f) => ({ ...f, folder: true })),
      ...files.map((f) => ({ ...f, folder: false })),
    ];
    if (!rows.length) {
      listEl.innerHTML = `<div class="row"><span class="name">pasta vazia</span></div>`;
      statusEl.textContent = "0 objeto(s)";
      return;
    }
    listEl.innerHTML = rows
      .map((r) => {
        const key = prefix + r.name + (r.folder ? "/" : "");
        const size = r.folder ? "…" : prettySize(r.size || 0);
        const kind = typeOf(r.name, r.folder);
        const wantThumb = !r.folder && (kind === "Vídeo" || kind === "Imagem");
        const thumbSrc = wantThumb
          ? `/api/thumb?key=${encodeURIComponent(key)}${r.fileId ? `&id=${encodeURIComponent(r.fileId)}` : ""}`
          : "";
        return `<div class="row ${r.folder ? "folder" : ""}" draggable="true" data-key="${escapeHtml(key)}" data-folder="${r.folder ? "1" : "0"}" data-id="${escapeHtml(r.fileId || "")}" data-name="${escapeHtml(r.name)}" data-size="${r.folder ? "" : r.size || 0}">
          <span class="glyph">${
            thumbSrc
              ? `<img class="thumb" alt="" src="${escapeHtml(thumbSrc)}"><span class="fallback">${glyphOf(r.name, r.folder)}</span>`
              : glyphOf(r.name, r.folder)
          }</span>
          <span class="name">${escapeHtml(r.name)}</span>
          <span class="sz" data-sz>${size}</span>
          <span class="type">${escapeHtml(typeOf(r.name, r.folder))}</span>
          <span class="when">${r.folder ? "" : prettyDate(r.uploaded)}</span>
        </div>`;
      })
      .join("");
    listEl.querySelectorAll(".thumb").forEach((img) => {
      img.addEventListener("load", () => img.classList.add("ok"));
      img.addEventListener("error", () => img.classList.add("fail"));
    });
    listEl.querySelectorAll(".row[data-key]").forEach((el) => {
      el.addEventListener("click", () => onItemClick(el));
      el.addEventListener("dblclick", () => activate(el));
      el.addEventListener("dragstart", (e) => {
        selectRow(el);
        e.dataTransfer.setData("text/plain", el.getAttribute("data-key"));
        e.dataTransfer.effectAllowed = "move";
      });
      if (el.getAttribute("data-folder") === "1") bindDropTarget(el);
    });
    bindDropTarget(listEl);
    const n = rows.length;
    const bytes = files.reduce((s, f) => s + (f.size || 0), 0);
    statusEl.textContent = `${n} objeto(s)${bytes ? `  |  ${prettySize(bytes)} nesta pasta` : ""} · um clique na pasta entra`;
    fillFolderSizes();
    loadRecent();
  } catch (ex) {
    listEl.innerHTML = `<div class="row"><span class="name">${ex.message}</span></div>`;
    statusEl.textContent = "erro";
  }
}

function onItemClick(el) {
  const folder = el.getAttribute("data-folder") === "1";
  if (folder) {
    openDir(el.getAttribute("data-key"), true);
    return;
  }
  selectRow(el);
  showPreview(el);
}

async function activate(el) {
  const key = el.getAttribute("data-key");
  const folder = el.getAttribute("data-folder") === "1";
  if (folder) {
    await openDir(key, true);
    return;
  }
  try {
    const data = await api(`/api/download-url?key=${encodeURIComponent(key)}`);
    window.open(data.url, "_blank");
  } catch (ex) {
    statusEl.textContent = ex.message || "não abriu";
  }
}

async function fillFolderSizes() {
  const tiles = [...listEl.querySelectorAll('.row[data-folder="1"]')];
  await Promise.all(
    tiles.slice(0, 40).map(async (el) => {
      const key = el.getAttribute("data-key");
      const slot = el.querySelector("[data-sz]");
      try {
        const du = await api(`/api/du?prefix=${encodeURIComponent(key)}`);
        if (slot) {
          slot.textContent = du.files ? `${prettySize(du.bytes)} · ${du.files} arq.` : "vazia";
        }
      } catch {
        if (slot) slot.textContent = "—";
      }
    })
  );
}

async function showPreview(el) {
  const name = el.getAttribute("data-name") || "";
  const key = el.getAttribute("data-key");
  const size = el.getAttribute("data-size");
  const folder = el.getAttribute("data-folder") === "1";
  if (folder) {
    previewEl.innerHTML = `<div class="preview-empty">Pasta. Um clique entra.</div>`;
    return;
  }
  previewEl.innerHTML = `<div class="preview-empty">carregando…</div>`;
  try {
    const data = await api(`/api/download-url?key=${encodeURIComponent(key)}`);
    const ext = extOf(name);
    const kind = typeOf(name, false);
    let media = "";
    const thumb = `/api/thumb?key=${encodeURIComponent(key)}`;
    if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
      media = `<img alt="" src="${escapeHtml(data.url)}" />`;
    } else if (["mp4", "mov", "m4v"].includes(ext)) {
      media = `<video controls preload="metadata" poster="${escapeHtml(thumb)}" src="${escapeHtml(data.url)}"></video>`;
    } else if (["wav", "mp3", "aac", "m4a"].includes(ext)) {
      media = `<audio controls src="${escapeHtml(data.url)}"></audio>`;
    }
    previewEl.innerHTML = `${media}
      <p class="pv-name">${escapeHtml(name)}</p>
      <p class="pv-meta">${escapeHtml(kind)} · ${prettySize(size)}</p>
      <button type="button" class="pv-open" id="pv-open">Abrir / baixar</button>`;
    document.getElementById("pv-open").addEventListener("click", () => window.open(data.url, "_blank"));
  } catch (ex) {
    previewEl.innerHTML = `<div class="preview-empty">${escapeHtml(ex.message || "não abriu")}</div>`;
  }
}

async function loadRecent() {
  try {
    const data = await api("/api/recent?limit=20");
    const files = data.files || [];
    if (!files.length) {
      recentEl.innerHTML = `<div class="recent-empty">nada ainda</div>`;
      return;
    }
    recentEl.innerHTML = files
      .map(
        (f) => `<button type="button" class="recent-item" data-key="${escapeHtml(f.key)}" data-folder="${escapeHtml(f.folder || "")}">
          <span class="nm">${escapeHtml(f.name)}</span>
          <span>${prettySize(f.size || 0)}</span>
          <span>${escapeHtml(winPath(f.folder || ""))}</span>
          <span>${prettyDate(f.uploaded)}</span>
        </button>`
      )
      .join("");
    recentEl.querySelectorAll(".recent-item").forEach((el) => {
      el.addEventListener("click", () => {
        recentEl.querySelectorAll(".recent-item").forEach((x) => x.classList.remove("on"));
        el.classList.add("on");
        const folder = el.getAttribute("data-folder");
        if (folder) openDir(folder, true);
      });
      el.addEventListener("dblclick", async () => {
        try {
          const data = await api(`/api/download-url?key=${encodeURIComponent(el.getAttribute("data-key"))}`);
          window.open(data.url, "_blank");
        } catch (ex) {
          statusEl.textContent = ex.message || "não abriu";
        }
      });
    });
  } catch (ex) {
    recentEl.innerHTML = `<div class="recent-empty">${escapeHtml(ex.message)}</div>`;
  }
}

function selectRow(el) {
  listEl.querySelectorAll(".row").forEach((x) => x.classList.remove("on"));
  el.classList.add("on");
  selected = {
    key: el.getAttribute("data-key"),
    fileId: el.getAttribute("data-id") || "",
    folder: el.getAttribute("data-folder") === "1",
    name: el.getAttribute("data-name") || "",
  };
}

function bindDropTarget(el) {
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    el.classList.add("drop-hot");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drop-hot"));
  el.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove("drop-hot");
    if (!selected) return;
    let dest = prefix;
    if (el.classList.contains("folder") && el.getAttribute("data-key")) dest = el.getAttribute("data-key");
    if (selected.folder && dest.startsWith(selected.key)) {
      statusEl.textContent = "não dá pra mover uma pasta pra dentro dela";
      return;
    }
    const toKey = selected.folder ? dest + selected.name + "/" : dest + selected.name;
    statusEl.textContent = "movendo...";
    try {
      await api("/api/move", {
        method: "POST",
        body: JSON.stringify({ fromKey: selected.key, fileId: selected.fileId, toKey }),
      });
      clip = null;
      await openDir(prefix, false);
    } catch (ex) {
      statusEl.textContent = ex.message || "não moveu";
    }
  });
}

function openDlg(mode, title, value) {
  dlgMode = mode;
  document.getElementById("dlg-title").textContent = title;
  const input = document.getElementById("dlg-name");
  input.value = value || "";
  document.getElementById("dlg").classList.remove("hidden");
  input.focus();
  input.select();
}

function closeDlg() {
  document.getElementById("dlg").classList.add("hidden");
  dlgMode = "";
}

document.getElementById("dlg-cancel").addEventListener("click", closeDlg);
document.getElementById("dlg-ok").addEventListener("click", () => submitDlg());
document.getElementById("dlg-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitDlg();
  if (e.key === "Escape") closeDlg();
});

async function submitDlg() {
  const name = document.getElementById("dlg-name").value.trim();
  const mode = dlgMode;
  closeDlg();
  if (!name) return;
  try {
    if (mode === "mkdir") {
      await api("/api/mkdir", { method: "POST", body: JSON.stringify({ prefix, name }) });
      await openDir(prefix, false);
    } else if (mode === "rename" && selected) {
      const toKey = selected.folder ? prefix + name + "/" : prefix + name;
      await api("/api/move", {
        method: "POST",
        body: JSON.stringify({ fromKey: selected.key, fileId: selected.fileId, toKey }),
      });
      await openDir(prefix, false);
    }
  } catch (ex) {
    statusEl.textContent = ex.message || "não deu";
  }
}

document.getElementById("btn-new").addEventListener("click", () => openDlg("mkdir", "Nova pasta", "Nova pasta"));
document.getElementById("btn-cut").addEventListener("click", () => {
  if (!selected) {
    statusEl.textContent = "seleciona um arquivo ou pasta";
    return;
  }
  clip = { ...selected };
  statusEl.textContent = `recortado: ${clip.name}`;
});
document.getElementById("btn-paste").addEventListener("click", async () => {
  if (!clip) {
    statusEl.textContent = "nada na área de transferência";
    return;
  }
  const toKey = clip.folder ? prefix + clip.name + "/" : prefix + clip.name;
  statusEl.textContent = "colando...";
  try {
    await api("/api/move", {
      method: "POST",
      body: JSON.stringify({ fromKey: clip.key, fileId: clip.fileId, toKey }),
    });
    clip = null;
    await openDir(prefix, false);
  } catch (ex) {
    statusEl.textContent = ex.message || "não colou";
  }
});
document.getElementById("btn-rename").addEventListener("click", () => {
  if (!selected) {
    statusEl.textContent = "seleciona um arquivo ou pasta";
    return;
  }
  openDlg("rename", "Renomear", selected.name);
});
document.getElementById("btn-del").addEventListener("click", async () => {
  if (!selected) {
    statusEl.textContent = "seleciona um arquivo ou pasta";
    return;
  }
  if (!confirm(`Excluir "${selected.name}"?`)) return;
  statusEl.textContent = "excluindo...";
  try {
    await api("/api/delete", {
      method: "POST",
      body: JSON.stringify({ key: selected.key, fileId: selected.fileId }),
    });
    await openDir(prefix, false);
  } catch (ex) {
    statusEl.textContent = ex.message || "não excluiu";
  }
});

document.getElementById("btn-back").addEventListener("click", () => {
  const prev = historyStack.pop();
  if (prev) openDir(prev, false);
});
document.getElementById("btn-up").addEventListener("click", () => {
  const dest = destinations.find((d) => prefix.startsWith(d.prefix));
  const root = dest ? dest.prefix : "YT-MAIN/00_INBOX/";
  if (prefix === root) return;
  const trimmed = prefix.replace(/\/$/, "");
  const parent = trimmed.slice(0, trimmed.lastIndexOf("/") + 1);
  if (parent.length >= root.length) openDir(parent, true);
});

document.getElementById("help-ok").addEventListener("click", () => {
  document.getElementById("help").classList.add("hidden");
});

btnIcons.addEventListener("click", () => {
  viewMode = "icons";
  applyView();
});
btnList.addEventListener("click", () => {
  viewMode = "list";
  applyView();
});

boot();
