/* ==========================================================================
   Finanze di Famiglia — web app: dati nel telefono + sincronizzazione Supabase
   Stesse regole del programma per Mac:
     * i dati restano nel telefono e si usano anche offline
     * ogni modifica alza version e updated_at e va in coda per l'invio
     * vince la modifica più recente; le novità si scaricano in base a synced_at
   ========================================================================== */
"use strict";

const TABLES = {
  accounts: ["id", "household_id", "name", "type", "opening_balance", "sort_order", "version", "updated_at", "updated_by", "deleted_at"],
  categories: ["id", "household_id", "parent_id", "name", "kind", "color", "icon", "sort_order", "version", "updated_at", "updated_by", "deleted_at"],
  recurrings: ["id", "household_id", "name", "kind", "amount", "category_id", "account_id", "frequency", "start_month", "due_day",
    "match_text", "status", "notes", "version", "updated_at", "updated_by", "deleted_at"],
  category_rules: ["id", "household_id", "pattern", "category_id", "kind", "version", "updated_at", "updated_by", "deleted_at"],
  transactions: ["id", "household_id", "account_id", "category_id", "kind", "amount", "occurred_on", "description",
    "transfer_account_id", "created_by", "recurring_id", "external_id", "version", "updated_at", "updated_by", "deleted_at"],
  budgets: ["id", "household_id", "category_id", "month", "amount", "version", "updated_at", "updated_by", "deleted_at"],
  app_settings: ["household_id", "key", "value", "version", "updated_at", "updated_by"],
};
const PK = t => t === "app_settings" ? ["household_id", "key"] : ["id"];
const keyOf = (t, r) => PK(t).map(k => r[k]).join("|");
const SEED_NS = "6f1c2a52-8a51-4d2e-9a43-3f6b2a1e9c10";   // uguale al programma per Mac
const STORE_KEY = "finanze-famiglia-v1";

/* ---------- archivio locale ---------- */
const emptyDb = () => ({ session: null, hh: null, hhName: null, role: null, email: null, members: {},
  t: Object.fromEntries(Object.keys(TABLES).map(k => [k, {}])), cursors: {}, outbox: {}, lastSync: null });
let DB;
try { DB = JSON.parse(localStorage.getItem(STORE_KEY)) || emptyDb(); } catch (e) { DB = emptyDb(); }
for (const k of Object.keys(TABLES)) DB.t[k] = DB.t[k] || {};
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(DB)); } catch (e) { console.warn(e); } }
const rows = t => Object.values(DB.t[t]).filter(r => !r.deleted_at);

/* ---------- utilità ---------- */
const nowIso = () => new Date().toISOString().replace("Z", "+00:00");
const uuid4 = () => crypto.randomUUID ? crypto.randomUUID() :
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
async function uuid5(name) {
  const ns = SEED_NS.replace(/-/g, "").match(/../g).map(h => parseInt(h, 16));
  const bytes = new Uint8Array([...ns, ...new TextEncoder().encode(name)]);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes)).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
const norm = t => " " + String(t || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}_&.'+@]+/gu, " ").replace(/\s+/g, " ").trim() + " ";
function learnPattern(desc) {
  const t = norm(desc).replace(/\d+/g, " ").replace(/\s+/g, " ").trim();
  return t.length >= 3 && t.length <= 40 ? t : null;
}
const pad2 = n => String(n).padStart(2, "0");
const isoDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayIso = () => isoDate(new Date());
function monthBounds(m) { const [y, mm] = m.split("-").map(Number); return [`${m}-01`, mm === 12 ? `${y + 1}-01-01` : `${y}-${pad2(mm + 1)}-01`]; }
function shiftMonth(m, d) { const [y, mm] = m.split("-").map(Number); const i = y * 12 + mm - 1 + d; return `${Math.floor(i / 12)}-${pad2(i % 12 + 1)}`; }
const round2 = n => Math.round(n * 100) / 100;

/* ---------- Supabase ---------- */
class Offline extends Error { }
class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
async function req(method, path, { body, token, params, prefer } = {}) {
  let url = CONFIG.supabaseUrl + path;
  if (params) url += (url.includes("?") ? "&" : "?") + new URLSearchParams(params).toString();
  const headers = { apikey: CONFIG.supabaseKey, "Content-Type": "application/json", Authorization: "Bearer " + (token || CONFIG.supabaseKey) };
  if (prefer) headers.Prefer = prefer;
  let r;
  try { r = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch (e) { throw new Offline("offline"); }
  const text = await r.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) { }
  if (!r.ok) throw new ApiError(r.status, (j && (j.error_description || j.msg || j.message || j.error)) || text || ("Errore " + r.status));
  return j;
}
const appUrl = () => location.origin + location.pathname;

function setSession(s) {
  s.expires_at_local = Date.now() + (Number(s.expires_in || 3600) - 120) * 1000;
  DB.session = s; save();
}
async function token() {
  if (!DB.session) throw new ApiError(401, "Non sei collegato");
  if (Date.now() >= DB.session.expires_at_local) {
    try { setSession(await req("POST", "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: DB.session.refresh_token } })); }
    catch (e) { if (e instanceof Offline) throw e; throw new ApiError(401, "Sessione scaduta: esci e accedi di nuovo"); }
  }
  return DB.session.access_token;
}
const uid = () => DB.session && DB.session.user && DB.session.user.id;

/* ---------- accesso ---------- */
async function enterHousehold() {
  const tk = DB.session.access_token;
  try { await req("POST", "/rest/v1/rpc/claim_invites", { body: {}, token: tk }); } catch (e) { if (e instanceof Offline) throw e; }
  const m = await req("GET", "/rest/v1/household_members", { token: tk,
    params: { select: "household_id,role,display_name,households(name)", user_id: "eq." + uid() } });
  if (!m || !m.length) { DB.session = null; save(); throw new ApiError(403, "Questo utente non fa parte di nessuna famiglia: chiedi all'amministratore di invitarti"); }
  if (DB.hh && DB.hh !== m[0].household_id) { const s = DB.session; DB = emptyDb(); DB.session = s; }
  DB.hh = m[0].household_id; DB.hhName = (m[0].households || {}).name || "Famiglia"; DB.role = m[0].role;
  DB.email = DB.session.user.email; save();
  await sync();
}
async function login(email, password) {
  try { setSession(await req("POST", "/auth/v1/token?grant_type=password", { body: { email: email.trim().toLowerCase(), password } })); }
  catch (e) {
    if (e instanceof Offline) throw new Error("Nessuna connessione a internet");
    if (/confirm/i.test(e.message)) throw new Error("Prima conferma l'email: apri il link che ti è arrivato");
    throw new Error("Email o password non corrette");
  }
  await enterHousehold();
}
async function signup(email, password) {
  const r = await req("POST", "/auth/v1/signup?redirect_to=" + encodeURIComponent(appUrl()), { body: { email: email.trim().toLowerCase(), password } });
  if (r && r.access_token) { setSession(r); await enterHousehold(); return { done: true }; }
  return { confirm: true };
}
const recover = email => req("POST", "/auth/v1/recover?redirect_to=" + encodeURIComponent(appUrl()), { body: { email: email.trim().toLowerCase() } });
async function updatePassword(pw) { await req("PUT", "/auth/v1/user", { body: { password: pw }, token: await token() }); }
/* link ricevuti per email (conferma account o nuova password): #access_token=…&type=… */
async function sessionFromLink() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.get("access_token")) return null;
  history.replaceState(null, "", location.pathname);
  const s = { access_token: h.get("access_token"), refresh_token: h.get("refresh_token"), expires_in: h.get("expires_in") || 3600 };
  s.user = await req("GET", "/auth/v1/user", { token: s.access_token });
  setSession(s);
  return h.get("type") || "login";
}
function logout() { const pending = Object.keys(DB.outbox).length; DB = emptyDb(); save(); return pending; }

/* ---------- sincronizzazione ---------- */
let syncing = null, syncError = null, syncTimer = null;
const listeners = new Set();
const notify = () => listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } });

function sync() {
  if (!DB.session || !DB.hh) return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    notify();
    try {
      const tk = await token();
      const mem = await req("GET", "/rest/v1/household_members", { token: tk, params: { select: "user_id,display_name,role", household_id: "eq." + DB.hh } });
      DB.members = Object.fromEntries(mem.map(m => [m.user_id, m.display_name || "?"]));
      const me = mem.find(m => m.user_id === uid()); if (me) DB.role = me.role;
      for (const t of Object.keys(TABLES)) await pull(t, tk);
      await push(tk);
      DB.lastSync = nowIso(); syncError = null;
    } catch (e) {
      syncError = e instanceof Offline ? "offline" :
        (/does not exist|Could not find|schema cache/.test(e.message) ? "Il database Supabase va aggiornato (vedi Aiuto sul Mac)" : e.message);
    } finally { save(); syncing = null; notify(); }
  })();
  return syncing;
}
async function pull(t, tk) {
  let cursor = DB.cursors[t], first = true;
  for (; ;) {
    const params = { select: TABLES[t].concat("synced_at").join(","), household_id: "eq." + DB.hh, order: "synced_at.asc", limit: "1000" };
    if (cursor) { const since = new Date(new Date(cursor).getTime() - (first ? 10000 : 0)); params.synced_at = "gt." + since.toISOString(); }
    first = false;
    const list = await req("GET", "/rest/v1/" + t, { token: tk, params });
    if (!list.length) break;
    for (const r of list) {
      const k = keyOf(t, r); const mine = DB.outbox[t + "|" + k];
      if (mine && new Date(mine.updated_at) >= new Date(r.updated_at)) continue;   // la mia modifica è più recente
      const { synced_at, ...row } = r; DB.t[t][k] = row;
      if (mine) delete DB.outbox[t + "|" + k];
    }
    cursor = list[list.length - 1].synced_at;
    if (list.length < 1000) break;
  }
  if (cursor) DB.cursors[t] = cursor;
}
async function push(tk) {
  for (const t of Object.keys(TABLES)) {
    const items = Object.entries(DB.outbox).filter(([k]) => k.startsWith(t + "|"));
    if (!items.length) continue;
    const body = items.map(([, r]) => Object.fromEntries(TABLES[t].map(c => [c, r[c] ?? null])));
    await req("POST", `/rest/v1/${t}?on_conflict=${PK(t).join(",")}`, { body, token: tk, prefer: "resolution=merge-duplicates,return=minimal" });
    for (const [k, r] of items) if (DB.outbox[k] && DB.outbox[k].updated_at === r.updated_at) delete DB.outbox[k];
  }
}
function scheduleSync(ms = 800) { clearTimeout(syncTimer); syncTimer = setTimeout(sync, ms); }
const pendingCount = () => Object.keys(DB.outbox).length;
const canEdit = () => DB.role === "owner" || DB.role === "member";

/* ---------- scrittura ---------- */
function write(t, data) {
  const k = keyOf(t, Object.assign({ household_id: DB.hh }, data));
  const cur = DB.t[t][k];
  const row = Object.assign({}, cur || {}, data, { household_id: DB.hh, version: (cur ? cur.version || 1 : 0) + 1,
    updated_at: nowIso(), updated_by: DB.members[uid()] || DB.email || "iPhone" });
  DB.t[t][k] = row; DB.outbox[t + "|" + k] = row; save(); scheduleSync();
  return row;
}

/* ---------- categorie e regole ---------- */
let DEFAULT_RULES = [];
fetch("regole_predefinite.json").then(r => r.json()).then(j => {
  DEFAULT_RULES = []; for (const kind of ["spesa", "entrata"]) for (const [name, words] of Object.entries(j[kind] || {})) DEFAULT_RULES.push({ kind, name, words });
}).catch(() => { });
const cats = () => Object.values(DB.t.categories).sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
const catById = id => DB.t.categories[id];
function catTree(kind) {
  const list = cats().filter(c => c.kind === kind && !c.deleted_at);
  const tops = list.filter(c => !c.parent_id || !list.some(p => p.id === c.parent_id));
  return tops.map(p => ({ c: p, kids: list.filter(c => c.parent_id === p.id) }));
}
function catLabel(id) { const c = catById(id); if (!c) return ""; const p = c.parent_id && catById(c.parent_id); return p ? `${p.name} › ${c.name}` : c.name; }
function suggestCategory(text, kind) {
  const t = norm(text); if (t.trim().length < 2) return null;
  const learned = rows("category_rules").filter(r => r.kind === kind && catById(r.category_id) && !catById(r.category_id).deleted_at && t.includes(r.pattern));
  if (learned.length) return learned.sort((a, b) => b.pattern.length - a.pattern.length)[0].category_id;
  let best = null;
  for (const g of DEFAULT_RULES) if (g.kind === kind) {
    const c = cats().find(c => !c.deleted_at && c.kind === kind && c.name.toLowerCase() === g.name.toLowerCase());
    if (!c) continue;
    for (const w of g.words) if (t.includes(w) && (!best || w.length > best.len)) best = { id: c.id, len: w.length };
  }
  return best && best.id;
}
async function learn(description, categoryId, kind) {
  const p = learnPattern(description);
  if (!p || !categoryId || !["spesa", "entrata"].includes(kind)) return;
  const id = await uuid5([DB.hh, "rule", kind, p].join(":"));
  const cur = DB.t.category_rules[id];
  if (cur && cur.category_id === categoryId && !cur.deleted_at) return;
  write("category_rules", { id, pattern: p, category_id: categoryId, kind, deleted_at: null });
}

/* ---------- movimenti ---------- */
async function saveTransaction(d) {
  if (!canEdit()) throw new Error("Il tuo utente può solo consultare i dati");
  const amount = parseAmount(d.amount);
  if (!amount || amount <= 0) throw new Error("Inserisci un importo maggiore di zero");
  if (!d.account_id) throw new Error("Scegli il conto");
  if (!["spesa", "entrata", "trasferimento"].includes(d.kind)) throw new Error("Tipo non valido");
  const row = { id: d.id || uuid4(), kind: d.kind, amount, occurred_on: d.occurred_on || todayIso(), account_id: d.account_id,
    description: (d.description || "").trim() || null, category_id: null, transfer_account_id: null };
  if (d.kind === "trasferimento") {
    if (!d.transfer_account_id || d.transfer_account_id === d.account_id) throw new Error("Scegli un conto di destinazione diverso");
    row.transfer_account_id = d.transfer_account_id;
  } else row.category_id = d.category_id || null;
  if (!d.id) row.created_by = uid();
  if ("recurring_id" in d) row.recurring_id = d.recurring_id || null;
  if (!d.id && !row.recurring_id) row.recurring_id = autoLink(row);
  write("transactions", row);
  if (row.category_id && row.description) await learn(row.description, row.category_id, row.kind);
  return row;
}
function deleteTransaction(id) { if (!canEdit()) throw new Error("Sola lettura"); write("transactions", { id, deleted_at: nowIso() }); }
function parseAmount(v) {
  if (v == null || v === "") return null;
  let s = String(v).replace(/[€\s]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s); return isFinite(n) ? round2(n) : NaN;
}

/* ---------- riepilogo del mese ---------- */
function monthData(month) {
  const [a, b] = monthBounds(month);
  const tx = rows("transactions").filter(t => t.occurred_on >= a && t.occurred_on < b)
    .sort((x, y) => y.occurred_on.localeCompare(x.occurred_on) || y.updated_at.localeCompare(x.updated_at));
  const income = round2(tx.filter(t => t.kind === "entrata").reduce((s, t) => s + t.amount, 0));
  const expense = round2(tx.filter(t => t.kind === "spesa").reduce((s, t) => s + t.amount, 0));
  const spent = {}; tx.filter(t => t.kind === "spesa").forEach(t => spent[t.category_id] = round2((spent[t.category_id] || 0) + t.amount));
  const spentAll = Object.assign({}, spent);
  for (const [id, v] of Object.entries(spent)) { const c = catById(id); if (c && c.parent_id) spentAll[c.parent_id] = round2((spentAll[c.parent_id] || 0) + v); }
  const budgets = Object.fromEntries(rows("budgets").filter(r => r.month === a).map(r => [r.category_id, r.amount]));
  return { tx, income, expense, spent, spentAll, budgets };
}
function series(month, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = shiftMonth(month, -i); const [a, b] = monthBounds(m);
    const tx = rows("transactions").filter(t => t.occurred_on >= a && t.occurred_on < b);
    out.push({ month: m, income: tx.filter(t => t.kind === "entrata").reduce((s, t) => s + t.amount, 0),
      expense: tx.filter(t => t.kind === "spesa").reduce((s, t) => s + t.amount, 0) });
  }
  return out;
}
function balances() {
  const tx = rows("transactions");
  return rows("accounts").sort((a, b) => a.sort_order - b.sort_order).map(a => ({ ...a, balance: round2(a.opening_balance + tx.reduce((s, t) =>
    s + (t.account_id === a.id ? (t.kind === "entrata" ? t.amount : -t.amount) : t.transfer_account_id === a.id ? t.amount : 0), 0)) }));
}

/* ---------- ricorrenti (stesse regole del Mac) ---------- */
const FREQ_MONTHS = { mensile: 1, bimestrale: 2, trimestrale: 3, semestrale: 6, annuale: 12 };
const midx = m => { const [y, mm] = m.slice(0, 7).split("-").map(Number); return y * 12 + mm - 1; };
const monthOf = i => `${Math.floor(i / 12)}-${pad2(i % 12 + 1)}`;
const isDue = (r, m) => { const d = midx(m) - midx(r.start_month); return d >= 0 && d % FREQ_MONTHS[r.frequency] === 0; };
function dueDate(r, m) { const [y, mm] = m.split("-").map(Number); const last = new Date(y, mm, 0).getDate(); return `${m}-${pad2(Math.min(r.due_day, last))}`; }
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoDate(d); };
const linkedTx = id => rows("transactions").filter(t => t.recurring_id === id).sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));
const paidTx = (due, linked) => linked.find(t => t.occurred_on >= addDays(due, -20) && t.occurred_on <= addDays(due, 25));
function recurringView(month) {
  const today = todayIso();
  return rows("recurrings").map(r => {
    const lk = linkedTx(r.id); const v = { ...r, monthly: round2(r.amount / FREQ_MONTHS[r.frequency]) };
    v.due = v.state = v.paid_tx = null;
    if (r.status === "attiva" && isDue(r, month)) {
      v.due = dueDate(r, month); const t = paidTx(v.due, lk); v.paid_tx = t && t.id;
      v.state = t ? "pagata" : today > addDays(v.due, 5) ? "in_ritardo" : "in_arrivo";
    }
    v.next_due = null;
    if (r.status === "attiva") {
      let i = Math.max(midx(r.start_month), midx(today) - 1);
      for (let k = 0; k < 30; k++, i++) { const m = monthOf(i); if (!isDue(r, m)) continue;
        const d = dueDate(r, m); if (!paidTx(d, lk) && d >= addDays(today, -25)) { v.next_due = d; break; } }
    }
    return v;
  });
}
function autoLink(tx) {
  if (!["spesa", "entrata"].includes(tx.kind)) return null;
  const text = norm(tx.description);
  for (const r of rows("recurrings")) {
    const key = r.match_text ? norm(r.match_text).trim() : null;
    if (r.status !== "attiva" || r.kind !== tx.kind || !key || !text.includes(key)) continue;
    if (Math.abs(r.amount - tx.amount) > Math.max(2, r.amount * 0.35)) continue;
    for (const back of [0, 1, -1]) {
      const m = monthOf(midx(tx.occurred_on) + back); if (!isDue(r, m)) continue;
      const due = dueDate(r, m);
      const days = Math.abs((new Date(tx.occurred_on) - new Date(due)) / 864e5);
      if (days <= 25 && !paidTx(due, linkedTx(r.id))) return r.id;
    }
  }
  return null;
}
async function registerRecurring(id, month) {
  const r = DB.t.recurrings[id];
  const acc = r.account_id || (balances().find(a => a.type === "contanti") || balances()[0] || {}).id;
  return saveTransaction({ kind: r.kind, amount: r.amount, occurred_on: dueDate(r, month), account_id: acc,
    category_id: r.category_id, description: r.name, recurring_id: id });
}
