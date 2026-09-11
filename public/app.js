const gate = document.getElementById("gate");
const app = document.getElementById("app");
const destChips = document.getElementById("dest-chips");
const camChips = document.getElementById("cam-chips");
const pathEl = document.getElementById("path");
const listEl = document.getElementById("list");
const whoEl = document.getElementById("who");
const dateEl = document.getElementById("date");
const pickedEl = document.getElementById("picked-path");
const queueEl = document.getElementById("queue");
const btnSend = document.getElementById("btn-send");
const btnCancel = document.getElementById("btn-cancel");
const sendHint = document.getElementById("send-hint");
const pickBtn = document.getElementById("pick-folder");
const livePill = document.getElementById("live-pill");
const driveHint = document.getElementById("drive-hint");
const dupesEl = document.getElementById("dupes");
const dupesList = document.getElementById("dupes-list");
const dupesLead = document.getElementById("dupes-lead");

let destinations = [];
let cameras = [];
let destId = "inbox";
let camId = "canon-bruto";
let browse = "";
let pickedPath = "";
let activeJobId = "";
let pollTimer = null;

function dest() {
  return destinations.find((d) => d.id === destId) || destinations[0];
}
function cam() {
  return cameras.find((c) => c.id === camId) || cameras[0];
}
function rootPrefix() {
  const d = dest();
  if (!d) return "YT-MAIN/00_INBOX/";
  let p = d.prefix;
  if (d.cameras) p += cam()?.suffix || "";
  return p;
}
function prefix() {
  return rootPrefix() + browse;
}
function resetBrowse() {
  const day = dateEl.value.trim().replace(/\/+$/, "");
  browse = day ? day + "/" : "";
}

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
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  return `${(n / 1024 ** 4).toFixed(2)} TB`;
}

function prettyEta(raw, startedAt, bytes, total) {
  if (raw && raw !== "-") {
    const s = String(raw).replace(/(\d+)h(\d+)m(\d+)s/i, "$1 h $2 min");
    const h = s.match(/(\d+)h/i);
    const m = s.match(/(\d+)m/i);
    const sec = s.match(/(\d+(?:\.\d+)?)s/i);
    const bits = [];
    if (h) bits.push(`${h[1]} h`);
    if (m) bits.push(`${m[1]} min`);
    if (!h && !m && sec) bits.push(`${Math.max(1, Math.round(Number(sec[1])))} s`);
    if (bits.length) return `faltam ${bits.join(" ")}`;
  }
  if (startedAt && bytes > 0 && total > bytes) {
    const elapsed = (Date.now() - startedAt) / 1000;
    const bps = bytes / Math.max(elapsed, 1);
    const left = (total - bytes) / bps;
    if (left < 60) return `faltam ${Math.max(1, Math.round(left))} s`;
    if (left < 3600) return `faltam ${Math.round(left / 60)} min`;
    const hrs = Math.floor(left / 3600);
    const mins = Math.round((left % 3600) / 60);
    return `faltam ${hrs} h ${mins} min`;
  }
  return "calculando tempo…";
}

function prettyElapsed(startedAt, endedAt) {
  const t0 = startedAt;
  if (!t0) return "";
  const sec = Math.max(0, Math.round(((endedAt || Date.now()) - t0) / 1000));
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  return `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`;
}

function statusLabel(status) {
  if (status === "queued") return "Na fila";
  if (status === "running") return "Enviando agora";
  if (status === "done") return "Chegou no arquivo";
  if (status === "cancelled") return "Cancelado";
  if (status === "paused_error") return "Parou";
  return status || "";
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function chipBar(el, items, current, onPick) {
  el.innerHTML = "";
  for (const item of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (item.id === current ? " on" : "");
    b.textContent = item.label;
    b.addEventListener("click", () => onPick(item.id));
    el.appendChild(b);
  }
}

function renderPath() {
  const root = rootPrefix();
  const parts = browse.split("/").filter(Boolean);
  const bits = [];
  bits.push(`<button type="button" data-to="">${escapeHtml(root)}</button>`);
  let acc = "";
  parts.forEach((seg, i) => {
    acc += seg + "/";
    const last = i === parts.length - 1;
    bits.push(" / ");
    if (last) bits.push(`<span class="here">${escapeHtml(seg)}</span>`);
    else bits.push(`<button type="button" data-to="${escapeHtml(acc)}">${escapeHtml(seg)}</button>`);
  });
  pathEl.innerHTML = bits.join("");
  pathEl.querySelectorAll("button[data-to]").forEach((b) => {
    b.addEventListener("click", () => {
      browse = b.getAttribute("data-to") || "";
      renderPath();
      loadList();
    });
  });
}

function renderChips() {
  chipBar(destChips, destinations, destId, (id) => {
    destId = id;
    camChips.classList.toggle("hidden", !dest().cameras);
    resetBrowse();
    renderChips();
    renderPath();
    loadList();
  });
  chipBar(camChips, cameras, camId, (id) => {
    camId = id;
    resetBrowse();
    renderChips();
    renderPath();
    loadList();
  });
  camChips.classList.toggle("hidden", !dest()?.cameras);
}

function setPicked(p) {
  pickedPath = p || "";
  pickedEl.textContent = pickedPath || "Nenhuma pasta ainda.";
  pickedEl.classList.toggle("ok", Boolean(pickedPath));
  syncButtons();
}

function syncButtons() {
  const live = Boolean(activeJobId);
  btnSend.disabled = !pickedPath || live;
  btnCancel.disabled = !live;
  if (!pickedPath) sendHint.textContent = "Escolhe a pasta pra liberar o envio.";
  else if (live) sendHint.textContent = "Enviando. Pode fechar a janela — o envio continua.";
  else sendHint.textContent = "Pronto. Clique Enviar.";
}

function isLive(job) {
  return job && (job.status === "running" || job.status === "queued");
}

function drawJob(job) {
  if (!job) {
    queueEl.classList.add("hidden");
    livePill.textContent = "parado";
    livePill.classList.remove("on");
    return;
  }
  queueEl.classList.remove("hidden");
  const live = isLive(job);
  livePill.textContent = live ? "enviando" : job.status === "done" ? "atualizado" : "parado";
  livePill.classList.toggle("on", live);
  const pct = job.percent == null ? (live ? "…" : "0") : String(Math.round(job.percent));
  const cls = live ? "live" : job.status === "done" ? "ok" : "fail";
  const eta = live
    ? prettyEta(job.eta, job.startedAt, job.bytes || 0, job.total || 0)
    : job.status === "done"
      ? "terminou"
      : "";
  const elapsed = prettyElapsed(job.startedAt, job.endedAt);
  const files =
    job.filesTotal > 0 ? `${job.filesDone || 0} de ${job.filesTotal} arquivos` : live ? "contando arquivos…" : "";
  const speed = job.speed && job.speed !== "0 B/s" && job.speed !== "-" ? job.speed : live ? "aquecendo o envio…" : "";
  queueEl.innerHTML = `<div class="job-card ${cls}">
      <p class="job-status">${escapeHtml(statusLabel(job.status))}${job.dryRun ? " · teste" : ""}</p>
      <p class="job-pct">${escapeHtml(pct)}%</p>
      <div class="job-meter"><span style="width:${Number(pct) || 0}%"></span></div>
      <div class="job-stats">
        <div><b>${prettySize(job.bytes || 0)}</b> <span>enviado</span></div>
        <div><b>${job.total ? prettySize(job.total) : "—"}</b> <span>tamanho</span></div>
        <div><b>${escapeHtml(eta || "—")}</b> <span>previsão</span></div>
        <div><b>${escapeHtml(elapsed ? "já faz " + elapsed : "—")}</b> <span>tempo</span></div>
        <div><b>${escapeHtml(speed || "—")}</b> <span>velocidade</span></div>
        <div><b>${escapeHtml(files || "—")}</b> <span>arquivos</span></div>
      </div>
      ${job.error ? `<p class="err">${escapeHtml(job.error)}</p>` : ""}
      <p class="job-path">${escapeHtml(job.srcPath || "")} → ${escapeHtml(job.destPrefix || "")}</p>
    </div>`;
}

let lastListAt = 0;
let lastJobKey = "";
async function refreshJobs() {
  const data = await api("/api/jobs");
  const live = (data.jobs || []).find((j) => isLive(j));
  const current = activeJobId
    ? (data.jobs || []).find((j) => j.id === activeJobId) || live
    : live || (data.jobs || [])[data.jobs.length - 1];
  if (current) {
    const running = isLive(current);
    activeJobId = running ? current.id : "";
    drawJob(current);
    syncButtons();
    const now = Date.now();
    const key = `${current.id}:${current.status}`;
    if (running && now - lastListAt > 2500) {
      lastListAt = now;
      loadList({ quiet: true });
    } else if (!running && current.status === "done" && lastJobKey !== key) {
      loadList();
    }
    lastJobKey = key;
    return;
  }
  drawJob(null);
  syncButtons();
}

function startPoll() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    refreshJobs().catch(() => {});
  }, 1000);
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const k = params.get("k");
  if (k) {
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ token: k }) });
      history.replaceState({}, "", "/");
    } catch {
      /* gate */
    }
  }
  try {
    const data = await api("/api/destinations");
    destinations = data.destinations;
    cameras = data.cameras;
    dateEl.value = data.today || "";
    const savedWho = localStorage.getItem("atlas-who");
    if (savedWho) whoEl.value = savedWho;
    gate.classList.add("hidden");
    app.classList.remove("hidden");
    fetch("/health")
      .then((r) => r.json())
      .then((h) => {
        const el = document.getElementById("app-ver");
        if (el && h.version) el.textContent = h.version;
      })
      .catch(() => {});
    resetBrowse();
    renderChips();
    renderPath();
    loadList();
    startPoll();
    await refreshJobs();
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

whoEl.addEventListener("change", () => localStorage.setItem("atlas-who", whoEl.value));
dateEl.addEventListener("change", () => {
  resetBrowse();
  renderPath();
  loadList();
});

document.getElementById("mkdir").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("mkdir-err");
  err.textContent = "";
  const name = document.getElementById("new-folder").value.trim();
  if (!name) return;
  try {
    const data = await api("/api/mkdir", {
      method: "POST",
      body: JSON.stringify({ prefix: prefix(), name }),
    });
    document.getElementById("new-folder").value = "";
    browse = (data.prefix || prefix() + name + "/").slice(rootPrefix().length);
    renderPath();
    loadList();
  } catch (ex) {
    err.textContent = ex.message || "não criou a pasta";
  }
});

async function loadList(opts = {}) {
  if (!opts.quiet) {
    listEl.innerHTML = `<div class="item"><div class="name">lendo pasta…</div></div>`;
  }
  try {
    const data = await api(`/api/ls?prefix=${encodeURIComponent(prefix())}`);
    const folders = data.folders || [];
    const files = data.files || [];
    if (!folders.length && !files.length) {
      listEl.innerHTML = `<div class="item"><div class="name">pasta vazia</div><div class="meta">cria uma ou envia arquivo</div></div>`;
      return;
    }
    const folderRows = folders
      .map(
        (f) =>
          `<button type="button" class="item folder" data-folder="${escapeHtml(f.name)}">
            <div class="name">${escapeHtml(f.name)}/</div>
            <div class="meta">pasta</div>
          </button>`
      )
      .join("");
    const fileRows = files
      .map(
        (f) =>
          `<div class="item"><div class="name">${escapeHtml(f.name)}</div><div class="meta">${prettySize(
            f.size || 0
          )}</div></div>`
      )
      .join("");
    listEl.innerHTML = folderRows + fileRows;
    listEl.querySelectorAll("[data-folder]").forEach((el) => {
      el.addEventListener("click", () => {
        browse += el.getAttribute("data-folder") + "/";
        renderPath();
        loadList();
      });
    });
  } catch (ex) {
    if (!opts.quiet) {
      listEl.innerHTML = `<div class="item fail"><div class="name">${escapeHtml(ex.message)}</div></div>`;
    }
  }
}

pickBtn.addEventListener("click", async () => {
  pickBtn.disabled = true;
  try {
    const data = await api("/api/pick-folder", { method: "POST", body: "{}" });
    setPicked(data.path);
  } catch (ex) {
    sendHint.textContent = ex.message || "não escolheu pasta";
  } finally {
    pickBtn.disabled = false;
  }
});

let pendingCollisions = [];

function hideDupes() {
  dupesEl.classList.add("hidden");
  pendingCollisions = [];
}

function showDupes(scan) {
  pendingCollisions = (scan.collisions || []).map((c) => ({
    ...c,
    action: c.sameSize ? "skip" : "rename",
  }));
  const n = pendingCollisions.length;
  const same = pendingCollisions.filter((c) => c.sameSize).length;
  dupesLead.textContent = `${n} arquivo${n === 1 ? "" : "s"} com o mesmo nome no destino. ${same} com o mesmo tamanho (cópia).`;
  renderDupes();
  dupesEl.classList.remove("hidden");
}

function renderDupes() {
  dupesList.innerHTML = pendingCollisions
    .map((c, i) => {
      const why = c.sameSize
        ? `mesmo nome e mesmo tamanho (${prettySize(c.localSize)}) — parece o mesmo arquivo`
        : `mesmo nome, tamanho diferente (aqui ${prettySize(c.localSize)} · no arquivo ${prettySize(c.remoteSize)})`;
      return `<div class="dupe">
        <div class="nm">${escapeHtml(c.rel)}</div>
        <select data-i="${i}">
          <option value="skip" ${c.action === "skip" ? "selected" : ""}>Ignorar</option>
          <option value="replace" ${c.action === "replace" ? "selected" : ""}>Substituir</option>
          <option value="rename" ${c.action === "rename" ? "selected" : ""}>Inserir com outro nome</option>
        </select>
        <div class="why">${escapeHtml(why)}${c.action === "rename" ? ` → ${escapeHtml(c.suggestedName)}` : ""}</div>
      </div>`;
    })
    .join("");
  dupesList.querySelectorAll("select").forEach((sel) => {
    sel.addEventListener("change", () => {
      const i = Number(sel.getAttribute("data-i"));
      pendingCollisions[i].action = sel.value;
      renderDupes();
    });
  });
}

async function startJob(decisions) {
  const job = await api("/api/jobs", {
    method: "POST",
    body: JSON.stringify({ srcPath: pickedPath, destPrefix: prefix(), decisions }),
  });
  hideDupes();
  activeJobId = job.id;
  drawJob(job);
  syncButtons();
  startPoll();
}

btnSend.addEventListener("click", async () => {
  if (!pickedPath) return;
  btnSend.disabled = true;
  sendHint.textContent = "conferindo se já existe no arquivo…";
  try {
    const scan = await api("/api/scan", {
      method: "POST",
      body: JSON.stringify({ srcPath: pickedPath, destPrefix: prefix() }),
    });
    if (scan.collisions && scan.collisions.length) {
      showDupes(scan);
      btnSend.disabled = false;
      sendHint.textContent = "escolhe o que fazer com os duplicados.";
      return;
    }
    await startJob([]);
  } catch (ex) {
    sendHint.textContent = ex.message || "não começou o envio";
    btnSend.disabled = false;
  }
});

document.getElementById("dupes-skip").addEventListener("click", () => {
  pendingCollisions.forEach((c) => {
    c.action = "skip";
  });
  renderDupes();
});
document.getElementById("dupes-replace").addEventListener("click", () => {
  pendingCollisions.forEach((c) => {
    c.action = "replace";
  });
  renderDupes();
});
document.getElementById("dupes-rename").addEventListener("click", () => {
  pendingCollisions.forEach((c) => {
    c.action = "rename";
  });
  renderDupes();
});
document.getElementById("dupes-cancel").addEventListener("click", () => {
  hideDupes();
  sendHint.textContent = "envio cancelado. Nada subiu.";
});
document.getElementById("dupes-go").addEventListener("click", async () => {
  const btn = document.getElementById("dupes-go");
  btn.disabled = true;
  try {
    await startJob(
      pendingCollisions.map((c) => ({
        rel: c.rel,
        action: c.action,
        newName: c.suggestedName,
      }))
    );
  } catch (ex) {
    sendHint.textContent = ex.message || "não começou o envio";
  } finally {
    btn.disabled = false;
  }
});

btnCancel.addEventListener("click", async () => {
  if (!activeJobId) return;
  try {
    const job = await api(`/api/jobs/${encodeURIComponent(activeJobId)}/cancel`, {
      method: "POST",
      body: "{}",
    });
    drawJob(job);
    activeJobId = "";
    syncButtons();
  } catch (ex) {
    sendHint.textContent = ex.message || "não cancelou";
  }
});

if (navigator.platform && /Win/.test(navigator.platform)) {
  pickBtn.textContent = "Escolher pasta neste PC";
}

boot();
