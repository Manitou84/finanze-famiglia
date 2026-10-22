/* ==========================================================================
   CRM Caron — app per iPhone
   - I dati stanno nel telefono (IndexedDB) e si allineano con Supabase quando c'è rete.
   - Le attività registrate senza campo restano in coda e partono appena torna la connessione.
   - Stesse regole del programma sul computer: ogni modifica alza version e updated_at,
     vince la modifica più recente.
   ========================================================================== */
"use strict";

const TABLES = ["regions", "provinces", "company_types", "markets", "action_types", "visit_purposes", "followup_types",
  "pipeline_stages", "companies", "contacts", "deals", "machines", "territory_weeks", "actions", "followups"];
const DEVICE = "iPhone";
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const ACT_STATUS = { completata: "Fatta", pianificata: "Pianificata", rinviata: "Rinviata", annullata: "Annullata" };

/* ---------- utilità ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoDate(d); };
const nowTs = () => new Date().toISOString();                       // 2026-10-19T14:05:01.123Z, come sul computer
const dayLabel = iso => {
  const t = today();
  if (iso === t) return "Oggi";
  if (iso === addDays(t, 1)) return "Domani";
  if (iso === addDays(t, -1)) return "Ieri";
  const d = new Date(iso + "T12:00:00");
  return `${GIORNI[d.getDay()][0].toUpperCase() + GIORNI[d.getDay()].slice(1)} ${d.getDate()} ${MESI[d.getMonth()].slice(0, 3)}`;
};
const shortDate = iso => { const d = new Date(iso + "T12:00:00"); return `${d.getDate()} ${MESI[d.getMonth()].slice(0, 3)}${iso.slice(0, 4) !== today().slice(0, 4) ? " " + iso.slice(2, 4) : ""}`; };
const norm = s => (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const eur = c => "€ " + Math.round((c || 0) / 100).toLocaleString("it-IT");
function uuid7() {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  let ms = Date.now();
  for (let i = 5; i >= 0; i--) { b[i] = ms % 256; ms = Math.floor(ms / 256); }
  b[6] = (b[6] & 0x0f) | 0x70; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
}
const store = {
  get: k => { try { return JSON.parse(localStorage.getItem("crm_" + k)); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem("crm_" + k, JSON.stringify(v)); } catch (e) { /* spazio pieno */ } },
};
const I = {
  today: '<path d="M4 7h16M7 3v4M17 3v4"/><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 12h3v3H8z"/>',
  clients: '<path d="M4 20V6l7-3v17M11 20V9l9 3v8M2 20h20M7 8v.01M7 12v.01M7 16v.01M15 14v.01M15 17v.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0"/>',
  phone: '<path d="M5 4h3.5l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5V19a1.5 1.5 0 0 1-1.5 1.5A15.5 15.5 0 0 1 3.5 5.5 1.5 1.5 0 0 1 5 4z"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  sync: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
};
const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

/* ---------- configurazione e accesso ---------- */
const cfg = () => {
  const c = window.CRM_CONFIG || {}, s = store.get("cfg") || {};
  return { url: (c.url || s.url || "").trim().replace(/\/+(rest|auth)\/v1\/?.*$/, "").replace(/\/+$/, ""), key: c.key || s.key || "" };
};
async function http(path, body, auth = true) {
  const c = cfg();
  const headers = { apikey: c.key, "Content-Type": "application/json" };
  if (auth) headers.Authorization = `Bearer ${await accessToken()}`;
  let r;
  try { r = await fetch(c.url + path, { method: "POST", headers, body: JSON.stringify(body) }); }
  catch (e) { const err = new Error("Nessuna connessione"); err.offline = true; throw err; }
  const txt = await r.text();
  const data = txt ? JSON.parse(txt) : null;
  if (!r.ok) {
    const msg = (data && (data.message || data.error_description || data.msg || data.error)) || `Errore ${r.status}`;
    const err = new Error(msg); err.status = r.status; throw err;
  }
  return data;
}
function saveSession(s) {
  store.set("session", { access: s.access_token, refresh: s.refresh_token, exp: Date.now() + (s.expires_in || 3600) * 1000 - 60000,
    email: (s.user && s.user.email) || (store.get("session") || {}).email });
}
async function accessToken() {
  const s = store.get("session");
  if (!s) throw Object.assign(new Error("Accedi"), { needLogin: true });
  if (Date.now() < s.exp) return s.access;
  try { saveSession(await http("/auth/v1/token?grant_type=refresh_token", { refresh_token: s.refresh }, false)); }
  catch (e) { if (!e.offline) { store.set("session", null); e.needLogin = true; } throw e; }
  return store.get("session").access;
}
const rpc = (fn, args) => http(`/rest/v1/rpc/${fn}`, args);

/* ---------- database sul telefono (IndexedDB) ---------- */
let idb;
const D = {};                       // tabella → Map(id → riga)
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("crm-caron", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("rows"); r.result.createObjectStore("meta"); };
    r.onsuccess = () => { idb = r.result; res(); };
    r.onerror = () => rej(r.error);
  });
}
const tx = (stores, mode, fn) => new Promise((res, rej) => {
  const t = idb.transaction(stores, mode); const out = fn(t);
  t.oncomplete = () => res(out); t.onerror = () => rej(t.error);
});
async function loadAll() {
  TABLES.forEach(t => D[t] = new Map());
  await tx(["rows"], "readonly", t => {
    const req = t.objectStore("rows").openCursor();
    req.onsuccess = () => { const c = req.result; if (!c) return; const v = c.value; if (D[v.t]) D[v.t].set(v.r.id, v.r); c.continue(); };
  });
  meta.seq = await getMeta("seq") || 0;
  meta.outbox = await getMeta("outbox") || [];
  meta.lastSync = await getMeta("lastSync");
}
const meta = { seq: 0, outbox: [], lastSync: null };
const getMeta = k => new Promise(res => { const r = idb.transaction("meta").objectStore("meta").get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
const putMeta = (k, v) => tx(["meta"], "readwrite", t => t.objectStore("meta").put(v, k));
function putRows(rows) {
  return tx(["rows"], "readwrite", t => { const s = t.objectStore("rows"); rows.forEach(({ t: tb, r }) => s.put({ t: tb, r }, `${tb}:${r.id}`)); });
}
const get = (t, id) => (id && D[t] && D[t].get(id)) || null;
const live = t => [...D[t].values()].filter(r => !r.deleted_at);

/* ---------- scrittura (come il programma: version + 1, updated_at, coda d'invio) ---------- */
const TEMPLATES = {
  companies: { name: null, status: "attivo", company_type_id: null, vat_number: null, address: null, postal_code: null, city: null, province_id: null,
    phone: null, email: null, market_id: null, priority: null, visit_frequency_days: null, to_follow: null, owner_id: null, notes: null },
  contacts: { company_id: null, full_name: null, job_title: null, phone: null, email: null, is_primary: 0, notes: null },
  actions: { action_date: null, start_time: null, company_id: null, action_type_id: null, purpose_id: null, deal_id: null, status: "pianificata",
    outcome_notes: null, user_id: null },
  followups: { action_id: null, company_id: null, followup_type_id: null, due_date: null, status: "da_fare", completed_at: null, outcome: null, user_id: null },
};
async function saveRows(list) {
  const ts = nowTs(), out = [];
  for (const { t, row } of list) {
    const old = get(t, row.id);
    const r = old ? { ...old, ...row } : { ...TEMPLATES[t], ...row, created_at: ts, deleted_at: null };
    r.id = r.id || uuid7(); r.version = (old ? old.version || 0 : 0) + 1; r.updated_at = ts; r.updated_by = DEVICE;
    D[t].set(r.id, r); out.push({ t, r });
    if (!meta.outbox.some(o => o.t === t && o.id === r.id)) meta.outbox.push({ t, id: r.id });
  }
  await putRows(out); await putMeta("outbox", meta.outbox);
  sync();
  return out.map(x => x.r);
}

/* ---------- sincronizzazione ---------- */
let syncing = null, syncErr = null;
function sync() {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      await push(); await pull(); await push();
      meta.lastSync = nowTs(); await putMeta("lastSync", meta.lastSync); syncErr = null;
    } catch (e) {
      syncErr = e.offline ? "offline" : e.message;
      if (e.needLogin) { render(); }
    } finally { syncing = null; updateSyncPill(); }
  })();
  updateSyncPill();
  return syncing;
}
async function push() {
  const batch = meta.outbox.slice(0, 300);
  if (!batch.length) return;
  const rows = batch.map(o => ({ t: o.t, r: get(o.t, o.id) })).filter(x => x.r);
  const sent = rows.map(x => `${x.t}:${x.r.id}:${x.r.version}`);
  await rpc("crm_push", { rows });
  // tolgo dalla coda solo quello che non è cambiato nel frattempo
  meta.outbox = meta.outbox.filter(o => { const r = get(o.t, o.id); return !r || !sent.includes(`${o.t}:${o.id}:${r.version}`); });
  await putMeta("outbox", meta.outbox);
  if (meta.outbox.length && batch.length === 300) await push();
}
async function pull() {
  let cursor = Math.max(0, meta.seq - 200), changed = 0;
  for (;;) {
    const rows = await rpc("crm_pull", { since: cursor, lim: 1000, tables: TABLES }) || [];
    if (!rows.length) break;
    const put = [];
    for (const { t, r, s } of rows) {
      cursor = Math.max(cursor, s);
      if (!D[t]) continue;
      delete r.server_seq;
      const l = get(t, r.id);
      const newer = !l || r.updated_at > l.updated_at || (r.updated_at === l.updated_at && (r.version || 0) > (l.version || 0));
      if (newer) { D[t].set(r.id, r); put.push({ t, r }); changed++; }
    }
    if (put.length) await putRows(put);
    if (cursor > meta.seq) { meta.seq = cursor; await putMeta("seq", cursor); }
    if (rows.length < 1000) break;
  }
  if (changed && !document.querySelector(".sheet.form")) render();
  return changed;
}
function updateSyncPill() {
  const el = $("#sync-pill"); if (!el) return;
  const n = meta.outbox.length;
  el.className = "sync-pill" + (syncing ? " busy" : syncErr ? " off" : n ? " wait" : "");
  el.innerHTML = `${icon("sync")}<span>${syncing ? "Allineo…" : syncErr === "offline" ? (n ? `${n} da inviare · offline` : "Offline") : syncErr ? "Errore" : n ? `${n} da inviare` : "Aggiornato"}</span>`;
}

/* ---------- consultazione ---------- */
const companyName = id => (get("companies", id) || {}).name || "Azienda";
const typeName = id => (get("action_types", id) || {}).name || "Attività";
const provCode = c => (get("provinces", c.province_id) || {}).code || "";
const place = c => [c.city, provCode(c) ? `(${provCode(c)})` : ""].filter(Boolean).join(" ");
const isClient = c => ((get("company_types", c.company_type_id) || {}).name || "") === "CLIENTE";
const companyTypeName = c => ((get("company_types", c.company_type_id) || {}).name || "");
const typeChip = c => { const n = companyTypeName(c); return `<span class="chip ${n === "CLIENTE" ? "cl" : n === "SEGNALATORE" ? "seg" : ""}">${n === "CLIENTE" ? "Cliente" : n === "SEGNALATORE" ? "Segnalatore" : "Prospect"}</span>`; };
const sortBy = (arr, f) => arr.sort((a, b) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0));
function weekRegion(iso) {
  const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const tw = live("territory_weeks").find(w => w.week_start === isoDate(d));
  return tw ? (get("regions", tw.region_id) || {}).name : null;
}
const openFollowups = () => sortBy(live("followups").filter(f => f.status === "da_fare" && get("companies", f.company_id)), f => f.due_date);

/* ==========================================================================
   Interfaccia
   ========================================================================== */
const app = () => $("#app");
let route = { view: "oggi" };
function go(hash) { if (location.hash === "#" + hash) render(); else location.hash = hash; }
window.addEventListener("hashchange", () => render());

function parseRoute() {
  const [v, a] = (location.hash.slice(1) || "oggi").split("/");
  const q = new URLSearchParams(location.hash.split("?")[1] || "");
  return { view: v.split("?")[0], arg: a && a.split("?")[0], q };
}

function shell(title, body, opts = {}) {
  const tab = opts.tab || route.view;
  return `<header class="top ${opts.back ? "with-back" : ""}">
      ${opts.back ? `<button class="back" data-back>${icon("back")}<span>${esc(opts.back)}</span></button>` : ""}
      <h1>${esc(title)}</h1>
      <button class="sync-pill" id="sync-pill" aria-label="Sincronizza ora"></button>
    </header>
    <main class="scroll">${body}</main>
    <nav class="tabs">
      <a href="#oggi" class="${tab === "oggi" ? "on" : ""}">${icon("today")}<span>Oggi</span></a>
      <a href="#clienti" class="${tab === "clienti" || tab === "cliente" ? "on" : ""}">${icon("clients")}<span>Clienti</span></a>
      <a href="#registra" class="add" aria-label="Registra attività">${icon("plus")}</a>
      <a href="#followup" class="${tab === "followup" ? "on" : ""}">${icon("bell")}<span>Follow-up</span>${openFollowups().filter(f => f.due_date <= today()).length ? `<i class="badge">${openFollowups().filter(f => f.due_date <= today()).length}</i>` : ""}</a>
      <a href="#altro" class="${tab === "altro" ? "on" : ""}">${icon("cog")}<span>Altro</span></a>
    </nav>`;
}

function render() {
  route = parseRoute();
  if (!cfg().url || !cfg().key || !store.get("session")) return renderLogin();
  const view = { oggi: renderToday, clienti: renderClients, cliente: renderClient, registra: renderForm, followup: renderFollowups,
    altro: renderMore, prospect: renderProspect }[route.view] || renderToday;
  view();
  updateSyncPill();
  const pill = $("#sync-pill"); if (pill) pill.onclick = () => { sync().then(() => { toast(syncErr === "offline" ? "Sei offline: invio appena torna la rete" : syncErr ? syncErr : "Dati aggiornati"); }); };
  const back = $("[data-back]"); if (back) back.onclick = () => history.length > 1 ? history.back() : go("oggi");
}

/* ---------- accesso ---------- */
function renderLogin() {
  const c = cfg(), W = window.CRM_CONFIG || {};
  const needUrl = !W.url, needKey = !W.key, needCfg = needUrl || needKey;
  app().innerHTML = `<main class="login">
    <div class="brand"><img src="apple-touch-icon.png" alt=""><h1>CRM Caron</h1><p>Accedi con lo stesso utente del programma sul computer.</p></div>
    <form id="login" class="card">
      ${needUrl ? `<label>Indirizzo Supabase<input id="l-url" value="${esc(c.url)}" placeholder="https://xxxx.supabase.co" autocapitalize="off" autocorrect="off" inputmode="url"></label>` : ""}
      ${needKey ? `<label>Chiave pubblica<input id="l-key" value="${esc(c.key)}" placeholder="sb_publishable_…" autocapitalize="off" autocorrect="off"></label>` : ""}
      <label>Email<input id="l-email" type="email" autocomplete="username" value="${esc((store.get("session") || {}).email || store.get("lastEmail") || "")}"></label>
      <label>Password<input id="l-pwd" type="password" autocomplete="current-password"></label>
      <p class="err" id="l-err"></p>
      <button class="btn primary big" type="submit">Accedi</button>
    </form></main>`;
  $("#login").onsubmit = async e => {
    e.preventDefault();
    if (needCfg) store.set("cfg", { url: needUrl ? $("#l-url").value.trim() : W.url, key: needKey ? $("#l-key").value.trim() : W.key });
    const btn = $("#login button"); btn.disabled = true; btn.textContent = "Accesso…"; $("#l-err").textContent = "";
    try {
      const s = await http("/auth/v1/token?grant_type=password", { email: $("#l-email").value.trim(), password: $("#l-pwd").value }, false);
      saveSession(s); store.set("lastEmail", $("#l-email").value.trim());
      if (!await rpc("crm_claim", {})) { store.set("session", null); throw new Error("Questo utente non è autorizzato a vedere i dati."); }
      app().innerHTML = `<main class="login"><div class="brand"><img src="apple-touch-icon.png" alt=""><h1>Scarico i dati…</h1><p>La prima volta ci vuole qualche secondo.</p></div></main>`;
      await sync(); go("oggi");
    } catch (ex) {
      $("#l-err").textContent = ex.offline ? "Nessuna connessione: per il primo accesso serve internet." : /invalid/i.test(ex.message) ? "Email o password non corretti." : ex.message;
      btn.disabled = false; btn.textContent = "Accedi";
    }
  };
}

/* ---------- Chiamate: referenti col telefono + numero dell'azienda ---------- */
const telHref = p => "tel:" + String(p).replace(/[^\d+]/g, "");
const digits = p => String(p || "").replace(/\D/g, "").replace(/^39(?=\d{9,})/, "");
function phonesFor(companyId) {
  const c = get("companies", companyId) || {};
  const list = sortBy(live("contacts").filter(k => k.company_id === companyId && k.phone), k => (k.is_primary ? "0" : "1") + k.full_name)
    .map(k => ({ label: k.full_name, sub: k.job_title || (k.is_primary ? "Referente principale" : "Referente"), phone: k.phone }));
  if (c.phone && !list.some(x => digits(x.phone) === digits(c.phone))) list.push({ label: "Azienda", sub: c.name || "", phone: c.phone });
  return list;
}
// un solo numero → chiama subito; più numeri → si sceglie chi chiamare
function callBtn(companyId) {
  const ph = phonesFor(companyId);
  if (!ph.length) return "";
  if (ph.length === 1) return `<a class="round" href="${telHref(ph[0].phone)}" aria-label="Chiama ${esc(ph[0].label)}">${icon("phone")}</a>`;
  return `<button class="round" data-call="${companyId}" aria-label="Chiama">${icon("phone")}</button>`;
}
function callSheet(companyId) {
  const c = get("companies", companyId) || {}, ph = phonesFor(companyId);
  const el = document.createElement("div");
  el.className = "sheet-bg";
  el.innerHTML = `<div class="sheet" role="dialog" aria-label="Chi vuoi chiamare?">
      <p class="sheet-t">Chiama · ${esc(c.name || "")}</p>
      ${ph.map(x => `<a class="sheet-row" href="${telHref(x.phone)}">${icon("phone")}<span><b>${esc(x.label)}</b><small>${esc(x.sub)} · ${esc(x.phone)}</small></span></a>`).join("")}
    </div><button class="sheet-cancel">Annulla</button>`;
  const close = () => el.remove();
  el.onclick = e => { if (e.target === el || e.target.closest(".sheet-cancel") || e.target.closest(".sheet-row")) setTimeout(close, 50); };
  document.body.appendChild(el);
}

/* ---------- Oggi ---------- */
function actionCard(a, opts = {}) {
  const c = get("companies", a.company_id) || {};
  return `<li class="row act ${a.status}" data-company="${a.company_id}">
    <div class="when">${a.start_time ? `<b>${esc(a.start_time)}</b>` : `<b>—</b>`}</div>
    <div class="what"><b>${esc(c.name || "Azienda")}</b><span>${esc(typeName(a.action_type_id))}${a.purpose_id ? " · " + esc((get("visit_purposes", a.purpose_id) || {}).name || "") : ""}${c.city ? " · " + esc(c.city) : ""}</span>
      ${a.outcome_notes && opts.notes ? `<em>${esc(a.outcome_notes)}</em>` : ""}</div>
    ${a.status === "pianificata" ? callBtn(a.company_id) : ""}
    ${a.status === "pianificata" ? `<button class="mini" data-done="${a.id}">${icon("check")}Fatta</button>` : `<span class="st">${ACT_STATUS[a.status]}</span>`}
  </li>`;
}
function renderToday() {
  const t = today(), d = new Date();
  const acts = live("actions").filter(a => get("companies", a.company_id));
  const todays = sortBy(acts.filter(a => a.action_date === t && a.status !== "annullata"), a => a.start_time || "99");
  const next = sortBy(acts.filter(a => a.action_date > t && a.action_date <= addDays(t, 7) && a.status === "pianificata"), a => a.action_date + (a.start_time || ""));
  const late = acts.filter(a => a.action_date < t && a.status === "pianificata" && a.action_date >= addDays(t, -14));
  const fus = openFollowups(), due = fus.filter(f => f.due_date <= t);
  const region = weekRegion(t);
  const byDay = {};
  next.forEach(a => (byDay[a.action_date] = byDay[a.action_date] || []).push(a));
  app().innerHTML = shell("Oggi", `
    <p class="lead">${GIORNI[d.getDay()][0].toUpperCase() + GIORNI[d.getDay()].slice(1)} ${d.getDate()} ${MESI[d.getMonth()]}${region ? ` · settimana in <b>${esc(region)}</b>` : ""}</p>
    ${due.length ? `<a class="alert" href="#followup">${icon("bell")}<span><b>${due.length} follow-up</b> da fare oggi o scaduti</span>${icon("chevron")}</a>` : ""}
    <section><h2>Agenda di oggi</h2>
      ${todays.length ? `<ul class="list">${todays.map(a => actionCard(a, { notes: true })).join("")}</ul>` : `<p class="empty">Niente in programma oggi.</p>`}
      <a class="btn big primary" href="#registra">${icon("plus")}Registra un'attività</a></section>
    ${late.length ? `<section><h2>Rimaste in sospeso</h2><ul class="list">${sortBy(late, a => a.action_date).map(a => actionCard({ ...a, start_time: shortDate(a.action_date) })).join("")}</ul></section>` : ""}
    <section><h2>Prossimi giorni</h2>
      ${Object.keys(byDay).length ? Object.entries(byDay).map(([day, list]) => `<h3>${dayLabel(day)}</h3><ul class="list">${list.map(a => actionCard(a)).join("")}</ul>`).join("")
        : `<p class="empty">Nessuna attività pianificata nei prossimi 7 giorni.</p>`}</section>
  `);
  bindRows();
}
function bindRows() {
  app().querySelectorAll("[data-company]").forEach(r => r.onclick = e => { if (e.target.closest("button,a")) return; go(`cliente/${r.dataset.company}`); });
  app().querySelectorAll("[data-call]").forEach(b => b.onclick = e => { e.stopPropagation(); callSheet(b.dataset.call); });
  app().querySelectorAll("[data-done]").forEach(b => b.onclick = e => { e.stopPropagation(); go(`registra?azione=${b.dataset.done}&fatta=1`); });
  app().querySelectorAll("[data-fu-done]").forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const f = get("followups", b.dataset.fuDone);
    await saveRows([{ t: "followups", row: { id: f.id, status: "fatto", completed_at: today() } }]);
    toast("Follow-up fatto"); render();
  });
}

/* ---------- Clienti ---------- */
let clientQuery = "";
function renderClients() {
  const words = norm(clientQuery).split(/\s+/).filter(Boolean);
  const all = live("companies").filter(c => c.status !== "chiuso");
  let list;
  if (words.length) {
    list = all.filter(c => { const h = norm(`${c.name} ${c.city || ""} ${provCode(c)}`); return words.every(w => h.includes(w)); });
    sortBy(list, c => (norm(c.name).startsWith(words[0]) ? "0" : "1") + norm(c.name));
  } else {
    const recent = store.get("recent") || [];
    list = recent.map(id => get("companies", id)).filter(c => c && !c.deleted_at);
  }
  const contacts = id => live("contacts").find(k => k.company_id === id && k.is_primary);
  app().innerHTML = shell("Clienti", `
    <div class="searchbar">${icon("search")}<input id="q" type="search" placeholder="Cerca azienda o città" value="${esc(clientQuery)}" autocomplete="off" autocorrect="off"></div>
    ${!words.length ? `<h2 class="sub">${list.length ? "Aperti di recente" : ""}</h2>` : ""}
    <ul class="list">${list.slice(0, 60).map(c => `<li class="row" data-company="${c.id}"><div class="what"><b>${esc(c.name)}</b>
        <span>${esc(place(c))}${contacts(c.id) ? " · " + esc(contacts(c.id).full_name) : ""}</span></div>
        ${typeChip(c)}</li>`).join("")}</ul>
    ${words.length && !list.length ? `<p class="empty">Nessuna azienda trovata.</p>` : ""}
    ${!words.length && !list.length ? `<p class="empty">Cerca un'azienda per nome o città. ${all.length} aziende sul telefono.</p>` : ""}
    <a class="btn big" href="#prospect${words.length ? "?nome=" + encodeURIComponent(clientQuery) : ""}">${icon("plus")}Nuovo prospect</a>
  `);
  const q = $("#q");
  q.oninput = () => { clientQuery = q.value; const pos = q.selectionStart; renderClients(); const n = $("#q"); n.focus(); n.setSelectionRange(pos, pos); updateSyncPill(); };
  bindRows();
}

function renderClient() {
  const c = get("companies", route.arg);
  if (!c) { app().innerHTML = shell("Cliente", `<p class="empty">Azienda non trovata.</p>`, { back: "Indietro", tab: "clienti" }); return; }
  const recent = (store.get("recent") || []).filter(x => x !== c.id); recent.unshift(c.id); store.set("recent", recent.slice(0, 12));
  const t = today();
  const contacts = sortBy(live("contacts").filter(k => k.company_id === c.id), k => (k.is_primary ? "0" : "1") + k.full_name);
  const acts = sortBy(live("actions").filter(a => a.company_id === c.id), a => a.action_date + (a.start_time || "")).reverse();
  const fus = openFollowups().filter(f => f.company_id === c.id);
  const stages = Object.fromEntries(live("pipeline_stages").map(s => [s.id, s]));
  const deals = live("deals").filter(d => d.company_id === c.id && (stages[d.stage_id] || {}).stage_type === "aperta");
  const machines = live("machines").filter(m => m.company_id === c.id);
  const addr = [c.address, [c.postal_code, c.city, provCode(c) ? `(${provCode(c)})` : ""].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const lastVisit = acts.find(a => a.status === "completata" && (get("action_types", a.action_type_id) || {}).is_visit);
  app().innerHTML = shell(c.name, `
    <div class="hero">${typeChip(c)}
      <span class="muted">${esc(place(c))}${lastVisit ? ` · ultima visita ${shortDate(lastVisit.action_date)}` : " · mai visitato"}</span></div>
    <div class="quick">
      ${(() => { const ph = phonesFor(c.id); return !ph.length ? "" : ph.length === 1
        ? `<a href="${telHref(ph[0].phone)}">${icon("phone")}<span>Chiama</span></a>`
        : `<a role="button" data-call="${c.id}">${icon("phone")}<span>Chiama</span></a>`; })()}
      ${c.email ? `<a href="mailto:${esc(c.email)}">${icon("mail")}<span>Email</span></a>` : ""}
      ${addr ? `<a href="https://maps.apple.com/?q=${encodeURIComponent(c.name + ", " + addr)}">${icon("pin")}<span>Mappa</span></a>` : ""}
      <a href="#registra?cliente=${c.id}" class="main">${icon("plus")}<span>Attività</span></a>
    </div>
    ${addr ? `<p class="addr">${esc(addr)}</p>` : ""}
    ${fus.length ? `<section><h2>Follow-up da fare</h2><ul class="list">${fus.map(fuCard).join("")}</ul></section>` : ""}
    ${contacts.length ? `<section><h2>Referenti</h2><ul class="list">${contacts.map(k => `<li class="row person"><div class="what"><b>${esc(k.full_name)}</b><span>${esc([k.job_title, k.phone].filter(Boolean).join(" · "))}</span></div>
        ${k.phone ? `<a class="round" href="tel:${esc(k.phone.replace(/[^\d+]/g, ""))}" aria-label="Chiama ${esc(k.full_name)}">${icon("phone")}</a>` : ""}
        ${k.email ? `<a class="round" href="mailto:${esc(k.email)}" aria-label="Email a ${esc(k.full_name)}">${icon("mail")}</a>` : ""}</li>`).join("")}</ul></section>` : ""}
    ${deals.length ? `<section><h2>Opportunità aperte</h2><ul class="list">${deals.map(d => `<li class="row"><div class="what"><b>${esc(d.title)}</b>
        <span>${esc((stages[d.stage_id] || {}).name || "")}${d.expected_close_date ? " · chiusura " + shortDate(d.expected_close_date) : ""}</span></div><b class="num">${eur(d.amount_cents)}</b></li>`).join("")}</ul></section>` : ""}
    <section><h2>Storico</h2>
      ${acts.length ? `<ul class="timeline">${acts.slice(0, 15).map(a => `<li class="${a.status}"><span class="d">${shortDate(a.action_date)}</span>
          <div><b>${esc(typeName(a.action_type_id))}</b>${a.status !== "completata" ? ` <span class="st">${ACT_STATUS[a.status]}</span>` : ""}
          ${a.outcome_notes ? `<p>${esc(a.outcome_notes)}</p>` : ""}</div>
          ${a.status === "pianificata" ? `<button class="mini" data-done="${a.id}">${icon("check")}Fatta</button>` : ""}</li>`).join("")}</ul>`
        : `<p class="empty">Nessuna attività registrata.</p>`}</section>
    ${machines.length ? `<section><h2>Macchine installate</h2><ul class="list">${machines.map(m => `<li class="row"><div class="what"><b>${esc(m.model)}</b><span>${[m.serial_number ? "matr. " + m.serial_number : "", m.year || ""].filter(Boolean).map(esc).join(" · ")}</span></div></li>`).join("")}</ul></section>` : ""}
    ${c.notes ? `<section><h2>Note</h2><p class="note">${esc(c.notes)}</p></section>` : ""}
  `, { back: "Indietro", tab: "clienti" });
  bindRows();
}

/* ---------- Follow-up ---------- */
function fuCard(f) {
  const c = get("companies", f.company_id) || {}, ft = get("followup_types", f.followup_type_id) || {}, t = today();
  const origin = get("actions", f.action_id);
  return `<li class="row fu ${f.due_date < t ? "late" : ""}" data-company="${f.company_id}">
    <div class="what"><b>${esc(ft.name || "Follow-up")}</b><span>${esc(c.name || "")} · ${f.due_date < t ? "scaduto il " : f.due_date === t ? "oggi" : "entro il "}${f.due_date === t ? "" : shortDate(f.due_date)}</span>
      ${origin && origin.outcome_notes ? `<em>${esc(origin.outcome_notes)}</em>` : ""}</div>
    ${callBtn(f.company_id)}<button class="mini" data-fu-done="${f.id}">${icon("check")}Fatto</button></li>`;
}
function renderFollowups() {
  const t = today(), all = openFollowups();
  const groups = [["Scaduti", all.filter(f => f.due_date < t)], ["Oggi", all.filter(f => f.due_date === t)],
    ["Prossimi 7 giorni", all.filter(f => f.due_date > t && f.due_date <= addDays(t, 7))], ["Più avanti", all.filter(f => f.due_date > addDays(t, 7))]];
  app().innerHTML = shell("Follow-up", groups.filter(([, l]) => l.length).map(([h, l]) => `<section><h2 class="${h === "Scaduti" ? "hot" : ""}">${h} <span class="n">${l.length}</span></h2>
      <ul class="list">${l.slice(0, 40).map(fuCard).join("")}</ul></section>`).join("") || `<p class="empty">Nessun follow-up aperto. 👌</p>`);
  bindRows();
}

/* ---------- Registra attività ---------- */
function renderForm() {
  const q = route.q, existing = q.get("azione") ? get("actions", q.get("azione")) : null;
  const companyId = existing ? existing.company_id : q.get("cliente");
  const types = sortBy(live("action_types"), x => x.position || 0), purposes = sortBy(live("visit_purposes"), x => x.position || 0);
  const ftypes = sortBy(live("followup_types"), x => x.position || 0);
  const visit = types.find(x => x.is_visit) || types[0] || {};
  const t = today();
  const st = { company: companyId, type: existing ? existing.action_type_id : visit.id,
    status: q.get("fatta") ? "completata" : existing ? existing.status : "completata",
    date: q.get("fatta") ? t : existing ? existing.action_date : t };
  const draw = () => {
    const c = get("companies", st.company);
    const stages = Object.fromEntries(live("pipeline_stages").map(s => [s.id, s]));
    const deals = c ? live("deals").filter(d => d.company_id === c.id && (stages[d.stage_id] || {}).stage_type === "aperta") : [];
    app().innerHTML = `<header class="top with-back"><button class="back" data-back>${icon("back")}<span>Annulla</span></button>
        <h1>${existing ? (q.get("fatta") ? "Com'è andata?" : "Modifica attività") : "Registra attività"}</h1><span></span></header>
      <main class="scroll sheet form">
        <label class="fieldset">Cliente
          ${c ? `<button type="button" class="picked" id="f-co"><b>${esc(c.name)}</b><span>${esc(place(c))}</span><em>Cambia</em></button>`
            : `<div class="searchbar">${icon("search")}<input id="f-search" placeholder="Cerca l'azienda" autocomplete="off" autocorrect="off"></div><ul class="list pick" id="f-results"></ul>`}
        </label>
        <div class="fieldset">Tipo<div class="chips" id="f-type">${types.map(x => `<button type="button" data-v="${x.id}" class="${x.id === st.type ? "on" : ""}">${esc(x.name)}</button>`).join("")}</div></div>
        <div class="two"><label class="fieldset">Data<input type="date" id="f-date" value="${st.date}"></label>
          <label class="fieldset">Ora<input type="time" id="f-time" value="${existing && existing.start_time ? existing.start_time : ""}"></label></div>
        <div class="fieldset">Stato<div class="chips" id="f-status">${["completata", "pianificata", "rinviata", "annullata"].map(k => `<button type="button" data-v="${k}" class="${k === st.status ? "on" : ""}">${ACT_STATUS[k]}</button>`).join("")}</div></div>
        <label class="fieldset">Scopo<select id="f-purpose"><option value="">—</option>${purposes.map(p => `<option value="${p.id}" ${existing && existing.purpose_id === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
        <label class="fieldset">Esito / note<textarea id="f-notes" rows="5" placeholder="Cosa è emerso? Puoi dettare con il microfono della tastiera.">${esc(existing ? existing.outcome_notes || "" : "")}</textarea></label>
        ${deals.length ? `<label class="fieldset">Opportunità<select id="f-deal"><option value="">Nessuna</option>${deals.map(d => `<option value="${d.id}" ${existing && existing.deal_id === d.id ? "selected" : ""}>${esc(d.title)}</option>`).join("")}</select></label>` : ""}
        <div class="two"><label class="fieldset">Follow-up<select id="f-fu"><option value="">Nessuno</option>${ftypes.map(f => `<option value="${f.id}" data-days="${f.default_days}">${esc(f.name)}</option>`).join("")}</select></label>
          <label class="fieldset">Entro il<input type="date" id="f-fu-date" disabled></label></div>
        <p class="err" id="f-err"></p>
        <button class="btn primary big" id="f-save">${icon("check")}Salva</button>
        ${existing ? `<button class="btn ghost" id="f-del">Elimina attività</button>` : ""}
      </main>`;
    app().querySelector("[data-back]").onclick = () => history.length > 1 ? history.back() : go("oggi");
    const chipGroup = (id, key) => app().querySelectorAll(`#${id} button`).forEach(b => b.onclick = () => {
      st[key] = b.dataset.v; app().querySelectorAll(`#${id} button`).forEach(x => x.classList.toggle("on", x === b));
      if (key === "status" && st.status === "completata" && $("#f-date").value > t) $("#f-date").value = t;
    });
    chipGroup("f-type", "type"); chipGroup("f-status", "status");
    $("#f-date").onchange = () => { st.date = $("#f-date").value; if (st.date > t && st.status === "completata") { st.status = "pianificata"; app().querySelectorAll("#f-status button").forEach(x => x.classList.toggle("on", x.dataset.v === "pianificata")); } fuDate(); };
    const fuDate = () => {
      const o = $("#f-fu").selectedOptions[0]; $("#f-fu-date").disabled = !o.value;
      $("#f-fu-date").value = o.value ? addDays($("#f-date").value || t, +o.dataset.days) : "";
    };
    $("#f-fu").onchange = fuDate;
    if ($("#f-co")) $("#f-co").onclick = () => { st.company = null; draw(); };
    const search = $("#f-search");
    if (search) {
      const show = () => {
        const w = norm(search.value).split(/\s+/).filter(Boolean);
        const res = w.length ? live("companies").filter(x => x.status !== "chiuso" && w.every(p => norm(`${x.name} ${x.city || ""}`).includes(p))).slice(0, 8)
          : (store.get("recent") || []).map(id => get("companies", id)).filter(Boolean).slice(0, 6);
        $("#f-results").innerHTML = res.map(x => `<li class="row" data-pick="${x.id}"><div class="what"><b>${esc(x.name)}</b><span>${esc(place(x))}</span></div></li>`).join("")
          + `<li class="row new" data-new="1"><div class="what"><b>+ Nuovo prospect${search.value ? ` «${esc(search.value)}»` : ""}</b></div></li>`;
        $("#f-results").querySelectorAll("[data-pick]").forEach(r => r.onclick = () => { st.company = r.dataset.pick; draw(); });
        $("#f-results").querySelector("[data-new]").onclick = () => go(`prospect?nome=${encodeURIComponent(search.value)}&poi=registra`);
      };
      search.oninput = show; show(); search.focus();
    }
    $("#f-save").onclick = async () => {
      if (!st.company) { $("#f-err").textContent = "Scegli il cliente."; return; }
      const date = $("#f-date").value || t;
      const row = { id: existing ? existing.id : uuid7(), company_id: st.company, action_type_id: st.type, action_date: date,
        start_time: $("#f-time").value || null, status: st.status, purpose_id: $("#f-purpose").value || null,
        outcome_notes: $("#f-notes").value.trim() || null, deal_id: $("#f-deal") ? $("#f-deal").value || null : (existing ? existing.deal_id : null) };
      const rows = [{ t: "actions", row }];
      if ($("#f-fu").value) rows.push({ t: "followups", row: { id: uuid7(), action_id: row.id, company_id: st.company, followup_type_id: $("#f-fu").value, due_date: $("#f-fu-date").value } });
      await saveRows(rows);
      toast(navigator.onLine ? "Attività salvata" : "Salvata sul telefono: la invio appena c'è rete");
      history.length > 1 ? history.back() : go(`cliente/${st.company}`);
    };
    const del = $("#f-del");
    if (del) del.onclick = async () => {
      if (!confirm("Eliminare questa attività?")) return;
      const rows = [{ t: "actions", row: { id: existing.id, deleted_at: nowTs() } }];
      live("followups").filter(f => f.action_id === existing.id).forEach(f => rows.push({ t: "followups", row: { id: f.id, deleted_at: nowTs() } }));
      await saveRows(rows); toast("Attività eliminata"); history.back();
    };
  };
  draw();
}

/* ---------- Nuovo prospect ---------- */
function renderProspect() {
  const q = route.q;
  const provinces = sortBy(live("provinces"), p => p.code);
  app().innerHTML = `<header class="top with-back"><button class="back" data-back>${icon("back")}<span>Annulla</span></button><h1>Nuovo prospect</h1><span></span></header>
    <main class="scroll sheet form">
      <label class="fieldset">Nome azienda<input id="p-name" value="${esc(q.get("nome") || "")}" autocapitalize="words"></label>
      <div class="similar" id="p-sim" hidden></div>
      <div class="two"><label class="fieldset">Località<input id="p-city" autocapitalize="words"></label>
        <label class="fieldset">Provincia<input id="p-prov" maxlength="2" autocapitalize="characters" list="p-prov-l" placeholder="BG"><datalist id="p-prov-l">${provinces.map(p => `<option value="${p.code}">`).join("")}</datalist></label></div>
      <label class="fieldset">Indirizzo<input id="p-addr"></label>
      <div class="two"><label class="fieldset">Telefono<input id="p-phone" type="tel"></label><label class="fieldset">Email<input id="p-email" type="email" autocapitalize="off"></label></div>
      <label class="fieldset">Referente<input id="p-contact" autocapitalize="words" placeholder="Nome e cognome"></label>
      <label class="fieldset">Note<textarea id="p-notes" rows="3"></textarea></label>
      <p class="err" id="p-err"></p>
      <button class="btn primary big" id="p-save">${icon("check")}Crea prospect</button>
    </main>`;
  app().querySelector("[data-back]").onclick = () => history.back();
  const core = s => norm(s).replace(/&/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\b(s ?r ?l ?s?|s ?p ?a|s ?n ?c|s ?a ?s|di|e|c)\b/g, " ").replace(/\s+/g, " ").trim();
  const sim = () => {
    const n = core($("#p-name").value);
    const hits = n.length < 3 ? [] : live("companies").filter(c => { const k = core(c.name); return k === n || (k.length > 3 && (k.includes(n) || n.includes(k))); }).slice(0, 3);
    $("#p-sim").hidden = !hits.length;
    $("#p-sim").innerHTML = hits.length ? `Forse c'è già: ${hits.map(h => `<a href="#cliente/${h.id}">${esc(h.name)}</a>${h.city ? ` (${esc(h.city)})` : ""}`).join(", ")}` : "";
  };
  $("#p-name").oninput = sim; sim();
  $("#p-save").onclick = async () => {
    const name = $("#p-name").value.trim().replace(/\s+/g, " ");
    if (!name) { $("#p-err").textContent = "Scrivi il nome dell'azienda."; return; }
    if (live("companies").some(c => norm(c.name) === norm(name))) { $("#p-err").textContent = "Esiste già un'azienda con questo nome."; return; }
    const pc = $("#p-prov").value.trim().toUpperCase(), prov = live("provinces").find(p => p.code === pc);
    if (pc && !prov) { $("#p-err").textContent = "Provincia non riconosciuta: usa la sigla, es. BG."; return; }
    const type = live("company_types").find(x => x.name === "PROSPECT") || live("company_types")[0];
    const id = uuid7();
    const rows = [{ t: "companies", row: { id, name, company_type_id: type.id, city: $("#p-city").value.trim() || null, province_id: prov ? prov.id : null,
      address: $("#p-addr").value.trim() || null, phone: $("#p-phone").value.trim() || null, email: $("#p-email").value.trim() || null, notes: $("#p-notes").value.trim() || null } }];
    if ($("#p-contact").value.trim()) rows.push({ t: "contacts", row: { id: uuid7(), company_id: id, full_name: $("#p-contact").value.trim(), is_primary: 1 } });
    await saveRows(rows);
    toast("Prospect creato");
    location.replace(q.get("poi") === "registra" ? `#registra?cliente=${id}` : `#cliente/${id}`);
  };
}

/* ---------- Altro ---------- */
function renderMore() {
  const s = store.get("session") || {};
  const n = live("companies").length, a = live("actions").length;
  app().innerHTML = shell("Altro", `
    <section class="card"><h2>Account</h2><p>${esc(s.email || "")}</p>
      <p class="muted">${n} aziende e ${a} attività su questo telefono.</p>
      <p class="muted">Ultimo allineamento: ${meta.lastSync ? new Date(meta.lastSync).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "mai"}${meta.outbox.length ? ` · ${meta.outbox.length} modifiche da inviare` : ""}</p>
      ${syncErr && syncErr !== "offline" ? `<p class="err">${esc(syncErr)}</p>` : ""}
      <button class="btn big" id="m-sync">${icon("sync")}Sincronizza ora</button>
      <button class="btn ghost" id="m-out">Esci</button></section>
    <section class="card"><h2>Installazione</h2><p class="muted">Per averla come un'app: in Safari tocca Condividi › «Aggiungi alla schermata Home».</p></section>
  `);
  $("#m-sync").onclick = () => sync().then(() => { toast(syncErr === "offline" ? "Sei offline" : syncErr || "Dati aggiornati"); renderMore(); updateSyncPill(); });
  $("#m-out").onclick = async () => {
    if (meta.outbox.length && !confirm(`Ci sono ${meta.outbox.length} modifiche non ancora inviate: se esci adesso le perdi. Uscire lo stesso?`)) return;
    store.set("session", null); indexedDB.deleteDatabase("crm-caron"); location.hash = ""; location.reload();
  };
}

/* ---------- avvio ---------- */
async function start() {
  try { await openDb(); await loadAll(); } catch (e) { app().innerHTML = `<p class="empty">Il telefono non permette di salvare i dati (navigazione privata?).</p>`; return; }
  render();
  if (store.get("session")) sync();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && store.get("session")) sync(); });
  window.addEventListener("online", () => store.get("session") && sync());
  setInterval(() => { if (document.visibilityState === "visible" && store.get("session")) sync(); }, 120000);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
start();
