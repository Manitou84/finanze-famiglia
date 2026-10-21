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
  vehicles: ["id", "household_id", "name", "model", "plate", "insurance_company", "insurance_months", "bollo_due",
    "insurance_due", "revision_due", "status", "notes", "sort_order", "version", "updated_at", "updated_by", "deleted_at"],
  people: ["id", "household_id", "name", "role", "color", "birth_year", "notes", "sort_order", "version", "updated_at", "updated_by", "deleted_at"],
  person_items: ["id", "household_id", "person_id", "kind", "name", "due_date", "repeat_months", "notes", "version", "updated_at", "updated_by", "deleted_at"],
  allowance: ["id", "household_id", "person_id", "amount", "occurred_on", "note", "version", "updated_at", "updated_by", "deleted_at"],
  yearly_docs: ["id", "household_id", "kind", "year", "status", "due_date", "done_date", "amount", "office", "notes", "version", "updated_at", "updated_by", "deleted_at"],
  trips: ["id", "household_id", "name", "destination", "start_date", "end_date", "status", "budget", "color", "notes", "included", "excluded",
    "version", "updated_at", "updated_by", "deleted_at"],
  trip_items: ["id", "household_id", "trip_id", "kind", "name", "amount", "booked", "due_date", "notes", "sort_order", "version", "updated_at", "updated_by", "deleted_at"],
  shop_products: ["id", "household_id", "name", "department", "store", "interval_days", "lead_days", "auto", "snooze_until", "notes", "sort_order",
    "version", "updated_at", "updated_by", "deleted_at"],
  shop_purchases: ["id", "household_id", "product_id", "bought_on", "version", "updated_at", "updated_by", "deleted_at"],
  shop_list: ["id", "household_id", "product_id", "name", "qty", "source", "added_on", "checked_at", "purchase_id", "version", "updated_at", "updated_by", "deleted_at"],
  goals: ["id", "household_id", "name", "target", "due_date", "status", "color", "trip_id", "notes", "sort_order", "version", "updated_at", "updated_by", "deleted_at"],
  goal_moves: ["id", "household_id", "goal_id", "amount", "occurred_on", "note", "version", "updated_at", "updated_by", "deleted_at"],
  work_km: ["id", "household_id", "day", "kind", "odometer", "km", "da", "a", "car", "clients", "notes", "version", "updated_at", "updated_by", "deleted_at"],
  transactions: ["id", "household_id", "account_id", "category_id", "kind", "amount", "occurred_on", "description",
    "transfer_account_id", "created_by", "recurring_id", "external_id", "vehicle_id", "person_id", "person_ids", "version", "updated_at", "updated_by", "deleted_at"],
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
      const hh = await req("GET", "/rest/v1/households", { token: tk, params: { select: "name", id: "eq." + DB.hh } });
      if (hh && hh[0] && hh[0].name) DB.hhName = hh[0].name;   // nome della famiglia sempre aggiornato
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
  if ("vehicle_id" in d) row.vehicle_id = d.vehicle_id || null;
  else if (!d.id) row.vehicle_id = autoVehicle(row);
  if ("person_ids" in d || "person_id" in d) {
    const ids = peopleList("person_ids" in d ? d.person_ids : d.person_id); Object.assign(row, peopleFields(ids));
    if (row.description && (ids.length || d.id)) learnPerson(row.description, ids);
  } else if (!d.id) Object.assign(row, peopleFields(autoPerson(row)));
  const fund = fundAccount();
  if (d.work && fund && ["spesa", "entrata"].includes(d.kind)) {
    applyWork(row, fund.id);
    if (d.work_remember && row.description) learnWork(row.description, d.kind, true);
  } else if (d.id && d.work === false && d.work_remember && row.description) learnWork(row.description, d.kind, false);
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
function allBalances() {
  const tx = rows("transactions");
  return rows("accounts").sort((a, b) => a.sort_order - b.sort_order).map(a => ({ ...a, balance: round2(a.opening_balance + tx.reduce((s, t) =>
    s + (t.account_id === a.id ? (t.kind === "entrata" ? t.amount : -t.amount) : t.transfer_account_id === a.id ? t.amount : 0), 0)) }));
}

const balances = () => allBalances().filter(a => a.type !== "fondo");   // il fondo di lavoro non è un conto vero

/* ---------- fondo spese di lavoro (stesse regole del Mac: api_lavoro.py) ---------- */
const fundAccount = () => rows("accounts").find(a => a.type === "fondo") || null;
function workKind(t) {
  const f = fundAccount(); if (!f || t.kind !== "trasferimento") return null;
  return t.transfer_account_id === f.id ? "spesa" : t.account_id === f.id ? "entrata" : null;
}
function fundAvailable() { const f = allBalances().find(a => a.type === "fondo"); return f ? round2(-f.balance) : null; }
function workRules() { const r = DB.t.app_settings[DB.hh + "|work_rules"]; try { return r && r.value ? JSON.parse(r.value) : {}; } catch (e) { return {}; } }
function learnWork(description, kind, on) {
  const p = learnPattern(String(description || "").split(" · ")[0]); if (!p) return;
  const rules = workRules();
  if (on && rules[p] !== kind) rules[p] = kind; else if (!on && p in rules) delete rules[p]; else return;
  write("app_settings", { key: "work_rules", value: JSON.stringify(rules) });
}
function applyWork(row, fundId) {
  if (row.kind === "spesa") Object.assign(row, { kind: "trasferimento", transfer_account_id: fundId });
  else if (row.kind === "entrata") { const acc = row.account_id; Object.assign(row, { kind: "trasferimento", account_id: fundId, transfer_account_id: acc }); }
  return Object.assign(row, { category_id: null, recurring_id: null, vehicle_id: null, person_id: null, person_ids: null });
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

/* ---------- auto (stesse regole del Mac) ---------- */
const PUBLIC = ["trenitalia", "italo", "trenord", "atm milano", "mycicero", "aps holding", "taxi", "uber", "freenow",
  "free now", "enjoy", "share now", "autobus", "metro", "flixbus", "itabus"];
const CAR_WORDS = ["eni ", "enilive", "q8", "tamoil", "esso", "agip", "api-ip", "ip ", "carburant", "benzina", "gasolio",
  "distributore", "gpl", "metano", "self service", "ricarica auto", "officina", "gommista", "tagliando", "revisione",
  "carrozzeria", "ricambi", "lavaggio", "pneumatic", "meccanic", "elettrauto", "autostrade", "pedaggio", "parcheggio",
  "easypark", "parking", "bollo auto"];
const activeVehicles = () => rows("vehicles").filter(v => v.status === "attiva").sort((a, b) => a.sort_order - b.sort_order);
const STOP_WORDS = ["assicurazioni", "assicurazione", "italia", "spa", "srl", "group", "gruppo", "compagnia", "di", "the"];
function companyHit(company, t) {
  if (!company) return false;
  const c = norm(company).trim(); if (c && t.includes(c)) return true;
  return c.split(" ").filter(w => w.length >= 4 && !STOP_WORDS.includes(w)).some(w => t.includes(" " + w)) &&
    ["assicuraz", "polizz", "rca", "rc auto", "premio", "rata"].some(k => t.includes(k));
}
function vehicleRule(t, vehicles) {
  let rules = {}; try { rules = JSON.parse((DB.t.app_settings[DB.hh + "|vehicle_rules"] || {}).value || "{}"); } catch (e) { }
  const ids = new Set(vehicles.map(v => v.id));
  const hits = Object.keys(rules).filter(p => t.includes(p) && ids.has(rules[p])).sort((a, b) => b.length - a.length);
  return hits.length ? rules[hits[0]] : null;
}
function isCarExpense(tx, vehicles) {
  if (tx.kind !== "spesa") return false;
  const t = norm(tx.description);
  if (t.includes("imposta di bollo") || PUBLIC.some(w => t.includes(w)) || t.includes("telepass")) return false;
  if (vehicles.some(v => companyHit(v.insurance_company, t)) || vehicleRule(t, vehicles)) return true;
  if (t.includes("bollo auto") || t.includes("tassa automobilistica")) return true;
  const c = catById(tx.category_id);
  if (!c) return CAR_WORDS.some(w => t.includes(w));
  const p = c.parent_id && catById(c.parent_id);
  const names = [c.name, p && p.name].map(n => norm(n || ""));
  return names.some(n => n.trim() === "auto e trasporti") || ["carburant", "benzin", "gasolio", "rifornim", "manutenz", "officina", "pedagg", "parchegg", "autostrad", "bollo"].some(w => names.some(n => n.includes(w)));
}
function autoVehicle(tx) {
  const vs = activeVehicles();
  if (!vs.length || !isCarExpense(tx, vs)) return null;
  const t = norm(tx.description), ruled = vehicleRule(t, vs);
  if (ruled) return ruled;
  if (vs.length === 1) return vs[0].id;
  const hits = vs.filter(v => companyHit(v.insurance_company, t));
  return hits.length === 1 ? hits[0].id : null;
}
function autoDeadlines() {
  const today = new Date(todayIso() + "T12:00:00");
  const out = [];
  for (const v of activeVehicles()) for (const [f, label] of [["bollo_due", "Bollo"], ["insurance_due", "Assicurazione"], ["revision_due", "Revisione"]]) {
    if (!v[f]) continue;
    const days = Math.round((new Date(v[f] + "T12:00:00") - today) / 864e5);
    out.push({ vehicle: v.name, label, due: v[f], days, level: days <= 0 ? "scaduta" : days <= 15 ? "15" : days <= 30 ? "30" : null });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}


/* ---------- famiglia: persone, documenti, visite, paghetta, ISEE e 730 (stesse regole del Mac) ---------- */
const PERSON_RULES = "person_rules";
// una spesa può essere per più persone: person_ids «id1,id2», person_id la prima (stesse regole del Mac)
const peopleList = v => [...new Set((Array.isArray(v) ? v : String(v || "").split(",")).map(x => String(x || "").trim()).filter(Boolean))];
const txPeople = t => peopleList(t.person_ids).length ? peopleList(t.person_ids) : t.person_id ? [t.person_id] : [];
const peopleFields = ids => { ids = peopleList(ids); return { person_id: ids[0] || null, person_ids: ids.length > 1 ? ids.join(",") : null }; };
const PEOPLE_PALETTE = ["#2E5E4E", "#9A3F5C", "#E3A73A", "#2F5F8A", "#7F77DD", "#D85A30"];
const DEDUCT = [
  ["Spese sanitarie", ["farmacia", "parafarmacia", "medico", "dentist", "odontoiatr", "ottica", "ospedale", "ticket",
    "analisi", "poliambulatorio", "fisioterap", "ambulatorio", "asst", "visita", "occhiali"]],
  ["Istruzione", ["scuola", "mensa scolastica", "mensa", "asilo", "nido", "iscrizione", "gita scolastica",
    "libri scolastici", "università", "universita"]],
  ["Sport dei figli", ["ginnastica", "danza", "piscina", "nuoto", "calcio", "palestra", "pallavolo", "basket",
    "tennis", "judo", "karate", "rugby", "scherma", "atletica", "asd ", "ssd "]],
];
const people = () => rows("people").sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
const personById = id => { const p = DB.t.people[id]; return p && !p.deleted_at ? p : null; };
const dlLevel = days => days == null ? null : days <= 0 ? "scaduta" : days <= 15 ? "15" : days <= 30 ? "30" : null;
const daysTo = iso => Math.round((new Date(iso + "T12:00:00") - new Date(todayIso() + "T12:00:00")) / 864e5);
function addMonthsIso(iso, n) {
  const [y, m, d] = iso.split("-").map(Number); const i = y * 12 + m - 1 + n, yy = Math.floor(i / 12), mm = i % 12 + 1;
  return `${yy}-${pad2(mm)}-${pad2(Math.min(d, new Date(yy, mm, 0).getDate()))}`;
}
function deductionType(description, categoryId) {
  const t = norm(description);
  for (const [label, words] of DEDUCT) if (words.some(w => t.includes(w))) return label;
  const c = catById(categoryId), p = c && c.parent_id && catById(c.parent_id);
  return ((p || c || {}).name || "").toLowerCase() === "salute" ? "Spese sanitarie" : null;
}
function personRules() {
  const r = DB.t.app_settings[DB.hh + "|" + PERSON_RULES];
  try { return r && r.value ? JSON.parse(r.value) : {}; } catch (e) { return {}; }
}
function autoPerson(tx) {
  const rules = personRules(), t = norm(tx.description);
  const hits = Object.keys(rules).filter(p => t.includes(p)).sort((a, b) => b.length - a.length);
  return hits.length ? peopleList(rules[hits[0]]).filter(id => personById(id)) : [];
}
function learnPerson(description, personId) {
  const p = learnPattern(String(description || "").split(" · ")[0]); if (!p) return;
  const rules = personRules(), v = peopleList(personId).join(",");
  if (v) { if (rules[p] === v) return; rules[p] = v; }
  else if (p in rules) delete rules[p]; else return;
  write("app_settings", { key: PERSON_RULES, value: JSON.stringify(rules) });
}
function guard() { if (!canEdit()) throw new Error("Il tuo utente può solo consultare i dati"); }
function savePerson(d) {
  guard();
  const name = (d.name || "").trim(); if (!name) throw new Error("Inserisci il nome");
  const by = d.birth_year ? Number(d.birth_year) : null;
  if (by != null && !(by >= 1900 && by <= new Date().getFullYear())) throw new Error("Anno di nascita non valido");
  const row = { id: d.id || uuid4(), name, role: d.role === "figlio" ? "figlio" : "adulto", birth_year: by,
    notes: (d.notes || "").trim() || null, deleted_at: null };
  if (d.id) { if (d.color) row.color = d.color; }
  else { const n = Math.max(0, ...rows("people").map(p => p.sort_order || 0)) + 1; row.sort_order = n; row.color = d.color || PEOPLE_PALETTE[(n - 1) % PEOPLE_PALETTE.length]; }
  return write("people", row);
}
function deletePerson(id) {
  guard();
  for (const t of rows("transactions")) if (txPeople(t).includes(id)) write("transactions", { id: t.id, ...peopleFields(txPeople(t).filter(x => x !== id)) });
  for (const tbl of ["person_items", "allowance"]) for (const r of rows(tbl)) if (r.person_id === id) write(tbl, { id: r.id, deleted_at: nowIso() });
  write("people", { id, deleted_at: nowIso() });
}
function setTxPerson(txId, personId) {
  guard(); const t = DB.t.transactions[txId];
  const ids = peopleList(personId);
  write("transactions", { id: txId, ...peopleFields(ids) });
  if (!t || !t.description) return 1;
  learnPerson(t.description, ids);
  let n = 1; const pat = learnPattern(String(t.description).split(" · ")[0]);   // anche le altre spese uguali ancora senza persona
  if (ids.length && pat) for (const o of rows("transactions"))
    if (o.id !== txId && o.kind === "spesa" && !o.person_id && learnPattern(String(o.description || "").split(" · ")[0]) === pat) { write("transactions", { id: o.id, ...peopleFields(ids) }); n++; }
  return n;
}
function savePersonItem(d) {
  guard();
  const name = (d.name || "").trim(); if (!name || !d.person_id) throw new Error("Inserisci il nome (es. Carta d'identità, Pediatra)");
  const rep = Number(d.repeat_months) || null;
  return write("person_items", { id: d.id || uuid4(), person_id: d.person_id, kind: d.kind === "visita" ? "visita" : "documento",
    name, due_date: d.due_date || null, repeat_months: rep, notes: (d.notes || "").trim() || null, deleted_at: null });
}
function deletePersonItem(id) { guard(); write("person_items", { id, deleted_at: nowIso() }); }
function renewPersonItem(id, nextDue) {
  guard(); const it = DB.t.person_items[id]; if (!it) throw new Error("Voce non trovata");
  const nd = nextDue || (it.repeat_months ? addMonthsIso(todayIso(), it.repeat_months) : null);
  if (!nd) throw new Error("Indica la nuova scadenza");
  write("person_items", { id, due_date: nd }); return nd;
}
function familyDeadlines() {
  const out = [];
  for (const i of rows("person_items")) {
    const p = personById(i.person_id); if (!p || !i.due_date) continue;
    const days = daysTo(i.due_date);
    out.push({ id: i.id, person_id: p.id, person: p.name, label: i.name, kind: i.kind, due: i.due_date, days, level: dlLevel(days) });
  }
  for (const d of rows("yearly_docs")) if (d.status !== "fatto" && d.due_date) {
    const days = daysTo(d.due_date);
    out.push({ id: d.id, person_id: null, person: "Famiglia", label: (d.kind === "isee" ? "ISEE " : "730 ") + d.year, kind: d.kind, due: d.due_date, days, level: dlLevel(days) });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}
async function saveYearlyDoc(d) {
  guard();
  if (!["isee", "730"].includes(d.kind)) throw new Error("Tipo non valido");
  const year = Number(d.year); if (!(year >= 2000 && year <= 2100)) throw new Error("Anno non valido");
  let amount = d.amount === "" || d.amount == null ? null : parseAmount(d.amount);
  if (d.kind === "730" && amount != null && d.debt) amount = -Math.abs(amount);
  let due = d.due_date || null;
  if (!due && !d.id) due = d.kind === "isee" ? `${year}-01-31` : `${year}-09-30`;
  const status = ["da fare", "in corso", "fatto"].includes(d.status) ? d.status : "da fare";
  const done = status === "fatto" ? (d.done_date || todayIso()) : (d.done_date || null);
  const id = d.id || await uuid5([DB.hh, "yd", d.kind, String(year)].join(":"));
  return write("yearly_docs", { id, kind: d.kind, year, status, due_date: due, done_date: done, amount,
    office: (d.office || "").trim() || null, notes: (d.notes || "").trim() || null, deleted_at: null });
}
function deleteYearlyDoc(id) { guard(); write("yearly_docs", { id, deleted_at: nowIso() }); }
function deductTotals(year) {
  const tot = {};
  for (const t of rows("transactions")) if (t.kind === "spesa" && t.occurred_on.startsWith(year + "-")) {
    const k = deductionType(t.description, t.category_id); if (k) tot[k] = Math.round(((tot[k] || 0) + Number(t.amount)) * 100) / 100;
  }
  return tot;
}
function yearlyDocs() {
  return rows("yearly_docs").sort((a, b) => (b.year - a.year) || a.kind.localeCompare(b.kind)).map(d => {
    const x = Object.assign({}, d, { amount: d.amount == null ? null : Number(d.amount) });
    if (d.kind === "730") { x.expenses_year = d.year - 1; x.expenses = deductTotals(d.year - 1); }
    x.days = d.due_date ? daysTo(d.due_date) : null; x.level = d.status !== "fatto" ? dlLevel(x.days) : null;
    return x;
  });
}
function addAllowance(personId, amount, note, spent) {
  guard(); const v = parseAmount(amount); if (!v) throw new Error("Inserisci l'importo");
  write("allowance", { id: uuid4(), person_id: personId, amount: spent ? -Math.abs(v) : Math.abs(v), occurred_on: todayIso(),
    note: (note || "").trim() || null, deleted_at: null });
}
function deleteAllowance(id) { guard(); write("allowance", { id, deleted_at: nowIso() }); }
function peopleView(year) {
  const y = String(year);
  const txs = rows("transactions").filter(t => t.kind === "spesa" && t.occurred_on.startsWith(y + "-"))
    .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on))
    .map(t => Object.assign({}, t, { amount: Number(t.amount), deduct: deductionType(t.description, t.category_id) }));
  const dl = Object.fromEntries(familyDeadlines().map(d => [d.id, d]));
  const allow = rows("allowance").sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || String(b.updated_at).localeCompare(String(a.updated_at)));
  const r2 = v => Math.round(v * 100) / 100;
  const ppl = people().map(p => {
    const mine = txs.filter(t => txPeople(t).includes(p.id)).map(t => Object.assign({}, t, { amount: r2(t.amount / txPeople(t).length), shared: txPeople(t).length })), byCat = {}, ded = {};
    for (const t of mine) {
      const c = catById(t.category_id), k = c ? c.name : "Senza categoria"; byCat[k] = r2((byCat[k] || 0) + t.amount);
      if (t.deduct) ded[t.deduct] = r2((ded[t.deduct] || 0) + t.amount);
    }
    const x = Object.assign({}, p, {
      items: rows("person_items").filter(i => i.person_id === p.id)
        .sort((a, b) => (a.due_date ? 0 : 1) - (b.due_date ? 0 : 1) || String(a.due_date).localeCompare(String(b.due_date)))
        .map(i => Object.assign({}, i, dl[i.id] ? { days: dl[i.id].days, level: dl[i.id].level } : {})),
      year_total: r2(mine.reduce((s, t) => s + t.amount, 0)), by_category: Object.entries(byCat).sort((a, b) => b[1] - a[1]),
      transactions: mine.slice(0, 80), deductions: ded });
    if (p.role === "figlio") {
      const a = allow.filter(e => e.person_id === p.id).map(e => Object.assign({}, e, { amount: Number(e.amount) }));
      const iny = a.filter(e => e.occurred_on.startsWith(y + "-"));
      x.allowance = { balance: r2(a.reduce((s, e) => s + e.amount, 0)), received: r2(iny.filter(e => e.amount > 0).reduce((s, e) => s + e.amount, 0)),
        spent: r2(-iny.filter(e => e.amount < 0).reduce((s, e) => s + e.amount, 0)), entries: a.slice(0, 60) };
    }
    return x;
  });
  const totals = {};
  for (const t of txs) if (t.deduct) totals[t.deduct] = r2((totals[t.deduct] || 0) + t.amount);
  return { year: Number(year), people: ppl, deadlines: familyDeadlines(), deduct_totals: totals, yearly_docs: yearlyDocs(),
    deduct_unassigned: txs.filter(t => t.deduct && !txPeople(t).length).slice(0, 100), deduct_types: DEDUCT.map(d => d[0]) };
}
function export730Csv(year) {
  const names = Object.fromEntries(people().map(p => [p.id, p.name]));
  const acc = id => (DB.t.accounts[id] || {}).name || "";
  const lines = [["Data", "Persona", "Tipo", "Descrizione", "Importo", "Pagato con"]];
  for (const t of rows("transactions").filter(t => t.kind === "spesa" && t.occurred_on.startsWith(year + "-")).sort((a, b) => a.occurred_on.localeCompare(b.occurred_on))) {
    const k = deductionType(t.description, t.category_id); if (!k) continue;
    const d = t.occurred_on;
    const ppl = txPeople(t).length ? txPeople(t) : [null];
    for (const pid of ppl) lines.push([`${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`, names[pid] || "da indicare", k,
      (t.description || "") + (ppl.length > 1 ? ` (quota di ${ppl.length})` : ""), (Number(t.amount) / ppl.length).toFixed(2).replace(".", ","), acc(t.account_id)]);
  }
  return { count: lines.length - 1, text: "﻿" + lines.map(r => r.map(v => /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(";")).join("\r\n") };
}


/* ---------- vacanze (stesse regole del Mac) ---------- */
const TRIP_KINDS = { trasporto: "Viaggio", alloggio: "Alloggio", attivita: "Attività", altro: "Altro" };
const TRIP_COLORS = ["#378ADD", "#1D9E75", "#D85A30", "#7F77DD", "#BA7517", "#D4537E"];
const HOME_CATEGORIES = ["bollette", "casa e mutuo/affitto", "assicurazioni", "banca e tasse", "abbonamenti"];
const PREPAID = ["volo", "voli", "ryanair", "easyjet", "wizz", "ita airways", "alitalia", "vueling", "lufthansa", "airfrance",
  "booking", "airbnb", "expedia", "edreams", "volagratis", "lastminute", "hotel", "albergo", "b&b", "agriturismo",
  "residence", "campeggio", "camping", "villaggio", "trenitalia", "italo", "traghett", "moby", "tirrenia",
  "grimaldi", "gnv", "corsica ferries", "noleggio", "rent a car", "hertz", "europcar", "avis", "sixt",
  "agenzia viaggi", "caparra", "skipass", "parcheggio aeroporto"];
const jsonIds = v => { try { return new Set(JSON.parse(v || "[]")); } catch (e) { return new Set(); } };
const trips = () => rows("trips");
function homeCats() {
  const all = Object.values(DB.t.categories);
  const tops = new Set(all.filter(c => HOME_CATEGORIES.includes(c.name.toLowerCase())).map(c => c.id));
  all.forEach(c => { if (tops.has(c.parent_id)) tops.add(c.id); });
  return tops;
}
function tripMap() {
  const out = {}, live = trips().filter(t => t.status !== "annullata");
  for (const t of live) for (const i of jsonIds(t.included)) if (!(i in out)) out[i] = t.id;
  const conf = live.filter(t => t.status === "confermata" && t.start_date && t.end_date).sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (conf.length) {
    const home = homeCats(), exc = Object.fromEntries(conf.map(t => [t.id, jsonIds(t.excluded)]));
    for (const x of rows("transactions")) {
      if (x.kind !== "spesa" || x.recurring_id || x.id in out || home.has(x.category_id)) continue;
      const t = conf.find(t => t.start_date <= x.occurred_on && x.occurred_on <= t.end_date && !exc[t.id].has(x.id));
      if (t) out[x.id] = t.id;
    }
  }
  return out;
}
function autoTripOf(tx) {
  if (!tx || tx.kind !== "spesa" || tx.recurring_id || homeCats().has(tx.category_id)) return null;
  return trips().filter(t => t.status === "confermata" && t.start_date && t.end_date && t.start_date <= tx.occurred_on && tx.occurred_on <= t.end_date)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0] || null;
}
function setTxTrip(txId, tripId) {
  guard(); const auto = autoTripOf(DB.t.transactions[txId]);
  for (const t of trips()) {
    const inc = jsonIds(t.included), exc = jsonIds(t.excluded), i0 = [...inc].sort().join(), e0 = [...exc].sort().join();
    inc.delete(txId);
    if (t.id === tripId) { exc.delete(txId); if (!(auto && auto.id === t.id)) inc.add(txId); }
    else if (auto && auto.id === t.id) exc.add(txId);
    if ([...inc].sort().join() !== i0 || [...exc].sort().join() !== e0)
      write("trips", { id: t.id, included: JSON.stringify([...inc].sort()), excluded: JSON.stringify([...exc].sort()) });
  }
}
function saveTrip(d) {
  guard();
  const name = (d.name || "").trim(); if (!name) throw new Error("Dai un nome alla vacanza (es. Sardegna 2027)");
  const start = d.start_date || null, end = d.end_date || null;
  if (start && end && end < start) throw new Error("La fine viene prima dell'inizio");
  const status = ["bozza", "confermata", "annullata"].includes(d.status) ? d.status : "bozza";
  if (status === "confermata" && !(start && end)) throw new Error("Per confermare la vacanza servono le date di inizio e fine");
  const budget = d.budget === "" || d.budget == null ? null : parseAmount(d.budget);
  const row = { id: d.id || uuid4(), name, destination: (d.destination || "").trim() || null, start_date: start, end_date: end, status, budget,
    notes: (d.notes || "").trim() || null, deleted_at: null };
  if (!d.id) { row.color = d.color || TRIP_COLORS[Object.keys(DB.t.trips).length % TRIP_COLORS.length]; row.included = "[]"; row.excluded = "[]"; }
  else if (d.color) row.color = d.color;
  write("trips", row);
  const m = tripMap(); return { id: row.id, count: Object.values(m).filter(v => v === row.id).length };
}
function deleteTrip(id) {
  guard();
  for (const i of rows("trip_items")) if (i.trip_id === id) write("trip_items", { id: i.id, deleted_at: nowIso() });
  write("trips", { id, deleted_at: nowIso() });
}
function saveTripItem(d) {
  guard();
  const name = (d.name || "").trim(); if (!name || !d.trip_id) throw new Error("Scrivi la voce (es. Volo, Hotel, Noleggio auto)");
  const amount = d.amount === "" || d.amount == null ? null : parseAmount(d.amount);
  const row = { id: d.id || uuid4(), trip_id: d.trip_id, kind: d.kind in TRIP_KINDS ? d.kind : "altro", name, amount, booked: d.booked ? 1 : 0,
    due_date: d.due_date || null, notes: (d.notes || "").trim() || null, deleted_at: null };
  if (!d.id) row.sort_order = Math.max(0, ...rows("trip_items").filter(i => i.trip_id === d.trip_id).map(i => i.sort_order || 0)) + 1;
  return write("trip_items", row);
}
function toggleTripItem(id) { guard(); const i = DB.t.trip_items[id]; write("trip_items", { id, booked: i.booked ? 0 : 1 }); }
function deleteTripItem(id) { guard(); write("trip_items", { id, deleted_at: nowIso() }); }
function tripDeadlines() {
  const live = Object.fromEntries(trips().filter(t => t.status !== "annullata").map(t => [t.id, t]));
  return rows("trip_items").filter(i => !i.booked && i.due_date && live[i.trip_id]).map(i => {
    const days = daysTo(i.due_date);
    return { id: i.id, trip_id: i.trip_id, trip: live[i.trip_id].name, label: i.name, due: i.due_date, days, level: dlLevel(days) };
  }).sort((a, b) => a.due.localeCompare(b.due));
}
function tripsView() {
  const today = todayIso(), m = tripMap(), r2 = v => Math.round(v * 100) / 100;
  const allTx = rows("transactions");
  const out = trips().map(t => {
    const mine = allTx.filter(x => m[x.id] === t.id).map(x => Object.assign({}, x, { amount: Number(x.amount) })).sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));
    const spent = r2(mine.reduce((s, x) => s + x.amount, 0)), byCat = {};
    for (const x of mine) {
      let c = catById(x.category_id); if (c && c.parent_id && catById(c.parent_id)) c = catById(c.parent_id);
      const k = c ? c.name : "Senza categoria"; byCat[k] = byCat[k] || { name: k, color: c ? c.color : "#94A099", amount: 0 }; byCat[k].amount = r2(byCat[k].amount + x.amount);
    }
    const items = rows("trip_items").filter(i => i.trip_id === t.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map(i => Object.assign({}, i, { amount: i.amount == null ? null : Number(i.amount) }));
    const s = t.start_date, e = t.end_date;
    const state = t.status === "annullata" ? "annullata" : t.status === "bozza" ? "bozza" : e && e < today ? "conclusa" : s && s <= today ? "in corso" : "in programma";
    const days = s && e ? daysTo(e) - daysTo(s) + 1 : null;
    const during = mine.filter(x => !s || x.occurred_on >= s);
    let cands = [];
    if (s && state !== "annullata") {
      const lo = addMonthsIso(s, -9);
      cands = allTx.filter(x => x.kind === "spesa" && !x.recurring_id && !(x.id in m) && x.occurred_on >= lo && x.occurred_on < s && (
        ((catById(x.category_id) || {}).name || "").toLowerCase() === "viaggi" || PREPAID.some(w => norm(x.description).includes(w))))
        .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on)).slice(0, 12);
    }
    return Object.assign({}, t, { budget: t.budget == null ? null : Number(t.budget), state, days, nights: days ? days - 1 : null, spent,
      spent_before: r2(mine.filter(x => s && x.occurred_on < s).reduce((a, x) => a + x.amount, 0)),
      per_day: days && during.length ? r2(during.reduce((a, x) => a + x.amount, 0) / days) : null,
      planned: r2(items.reduce((a, i) => a + (i.amount || 0), 0)), booked_total: r2(items.filter(i => i.booked).reduce((a, i) => a + (i.amount || 0), 0)),
      by_category: Object.values(byCat).sort((a, b) => b.amount - a.amount), transactions: mine, items, candidates: cands,
      excluded_count: jsonIds(t.excluded).size, countdown: s && state === "in programma" ? daysTo(s) : null });
  });
  const order = { "in corso": 0, "in programma": 1, "bozza": 2 };
  const ahead = out.filter(t => t.state in order).sort((a, b) => (order[a.state] - order[b.state]) || String(a.start_date || "9999").localeCompare(String(b.start_date || "9999")));
  const past = out.filter(t => !(t.state in order)).sort((a, b) => String(b.start_date || "").localeCompare(String(a.start_date || "")));
  return ahead.concat(past);
}

/* ---------- lista della spesa (stesse regole del Mac: api_spesa.py) ---------- */
const SHOP_DEFAULTS = { min_purchases: 3, history: 8, lead_frequent: 1, lead_rare: 3, rare_after: 14, snooze_pct: 50, pause_on_trip: 1 };
const SHOP_DEPARTMENTS = ["Frutta e verdura", "Pane e forno", "Latte e formaggi", "Carne e pesce", "Salumi", "Dispensa", "Colazione",
  "Surgelati", "Bevande", "Casa e pulizia", "Igiene persona", "Bambini", "Animali", "Altro"];
const shopKey = s => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
function shopParams() {
  const r = DB.t.app_settings[DB.hh + "|shop_params"], p = Object.assign({}, SHOP_DEFAULTS);
  try { const j = JSON.parse(r && r.value || "{}"); for (const k in SHOP_DEFAULTS) if (k in j) p[k] = parseInt(j[k], 10); } catch (e) { }
  return p;
}
const products = () => rows("shop_products").sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
const shopItems = () => rows("shop_list");
function cadenceOf(dates, p) {
  const days = [...new Set(dates)].sort();
  if (days.length < Math.max(2, p.min_purchases)) return null;
  const last = days.slice(-(p.history + 1));
  const gaps = last.slice(1).map((d, i) => daysTo(d) - daysTo(last[i])).filter(g => g > 0).sort((a, b) => a - b);
  if (!gaps.length) return null;
  const m = gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;
  return Math.max(1, Math.floor(m + 0.5));   // stesso arrotondamento del Mac: i suggerimenti hanno lo stesso id
}
function productStats() {
  const p = shopParams(), buys = {};
  for (const b of rows("shop_purchases")) (buys[b.product_id] = buys[b.product_id] || []).push(b.bought_on);
  const out = {};
  for (const x of products()) {
    const dates = [...new Set(buys[x.id] || [])].sort(), learned = cadenceOf(dates, p);
    const interval = x.interval_days || learned, last = dates[dates.length - 1] || null;
    let lead = x.lead_days != null ? x.lead_days : interval && interval >= p.rare_after ? p.lead_rare : p.lead_frequent;
    lead = Math.min(lead, Math.max(0, (interval || 1) - 1));
    out[x.id] = { purchases: dates.length, last, learned, interval, source: x.interval_days ? "manuale" : learned ? "calcolata" : null, lead,
      next_due: last && interval ? addDaysIso(last, interval) : null, missing: interval ? 0 : Math.max(0, p.min_purchases - dates.length) };
  }
  return out;
}
function addDaysIso(iso, n) { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoDate(d); }
function shopPaused() {
  const t = todayIso();
  return trips().find(x => x.status === "confermata" && x.start_date <= t && x.end_date >= t) || null;
}
async function shopSuggest() {
  if (!canEdit() || !DB.hh) return 0;
  const p = shopParams(); if (p.pause_on_trip && shopPaused()) return 0;
  const onList = new Set(shopItems().filter(i => !i.checked_at && i.product_id).map(i => i.product_id));
  const st = productStats(), today = todayIso(); let n = 0;
  for (const x of products()) {
    const s = st[x.id];
    if (+x.auto === 0 || onList.has(x.id) || !s.next_due) continue;
    if (x.snooze_until && today < x.snooze_until) continue;
    if (today < addDaysIso(s.next_due, -s.lead)) continue;
    const id = await uuid5([DB.hh, "sugg", x.id, s.next_due].join(":"));
    if (DB.t.shop_list[id]) continue;
    write("shop_list", { id, product_id: x.id, name: x.name, qty: null, source: "suggerito", added_on: today, checked_at: null, purchase_id: null, deleted_at: null });
    n++;
  }
  return n;
}
const SHOP_KEYWORDS = [["Frutta e verdura", "mele pere banane arance limoni frutta verdura insalata pomodori patate cipolle carote zucchine melanzane peperoni aglio basilico prezzemolo funghi fragole kiwi uva pesche"], ["Pane e forno", "pane panini piadine grissini crackers fette biscottate focaccia pizza base"], ["Latte e formaggi", "latte yogurt burro formaggio mozzarella parmigiano grana ricotta stracchino panna uova"], ["Carne e pesce", "pollo tacchino manzo maiale macinato bistecca salsiccia pesce tonno fresco salmone merluzzo"], ["Salumi", "prosciutto salame mortadella bresaola speck wurstel"], ["Dispensa", "pasta riso farina zucchero sale olio aceto passata pelati sugo legumi ceci fagioli lenticchie tonno scatola maionese ketchup spezie dado"], ["Colazione", "caffè caffe tè te the cereali biscotti marmellata nutella miele cacao"], ["Surgelati", "surgelati gelato bastoncini piselli spinaci minestrone"], ["Bevande", "acqua succo bibita coca birra vino aranciata"], ["Casa e pulizia", "detersivo ammorbidente candeggina sgrassatore piatti pastiglie lavastoviglie spugne carta scottex sacchetti spazzatura alluminio pellicola"], ["Igiene persona", "shampoo bagnoschiuma sapone dentifricio spazzolino deodorante carta igienica assorbenti rasoi cotone crema"], ["Bambini", "pannolini salviette omogeneizzati merendine"], ["Animali", "crocchette scatolette lettiera"]];
function guessDepartment(name) {
  const t = " " + shopKey(name) + " "; let best = null;
  for (const [dep, words] of SHOP_KEYWORDS) for (const w of words.split(" ")) if (t.includes(" " + w) && (!best || w.length > best[1])) best = [dep, w.length];
  return best ? best[0] : "Altro";
}
async function addToList(name, qty) {
  guard();
  let label = String(name || "").trim().replace(/\s+/g, " "); if (!label) throw new Error("Scrivi cosa comprare");
  let prod = products().find(x => shopKey(x.name) === shopKey(label)), created = false;
  if (!prod) {   // prodotto nuovo: entra anche nel catalogo (stesso id che userebbe il Mac)
    label = label[0].toUpperCase() + label.slice(1);
    const id = await uuid5([DB.hh, "prod", shopKey(label)].join(":"));
    prod = write("shop_products", { id, name: label, department: guessDepartment(label), auto: 1,
      sort_order: Math.max(0, ...rows("shop_products").map(x => x.sort_order || 0)) + 1, deleted_at: null });
    created = true;
  }
  const exists = shopItems().find(i => !i.checked_at && i.product_id === prod.id);
  if (exists) return { exists: true, name: exists.name };
  write("shop_list", { id: uuid4(), product_id: prod.id, name: prod.name, qty: (qty || "").trim() || null,
    source: "manuale", added_on: todayIso(), checked_at: null, purchase_id: null, deleted_at: null });
  return { name: prod.name, created };
}
function checkItem(id, checked) {
  guard(); const it = DB.t.shop_list[id]; if (!it) return;
  if (checked && !it.checked_at) {
    let pid = null;
    if (it.product_id) { pid = uuid4(); write("shop_purchases", { id: pid, product_id: it.product_id, bought_on: todayIso(), deleted_at: null });
      write("shop_products", { id: it.product_id, snooze_until: null }); }
    write("shop_list", { id, checked_at: nowIso(), purchase_id: pid });
  } else if (!checked && it.checked_at) {
    if (it.purchase_id) write("shop_purchases", { id: it.purchase_id, deleted_at: nowIso() });
    write("shop_list", { id, checked_at: null, purchase_id: null });
  }
}
function removeItem(id, snooze) {
  guard(); const it = DB.t.shop_list[id]; if (!it) return null;
  let until = null;
  if (snooze && it.product_id) {
    const s = productStats()[it.product_id], step = Math.max(1, Math.floor(((s && s.interval) || 7) * shopParams().snooze_pct / 100 + 0.5));
    until = addDaysIso(todayIso(), step); write("shop_products", { id: it.product_id, snooze_until: until });
  }
  write("shop_list", { id, deleted_at: nowIso() });
  return until;
}
function finishShopping() {
  guard(); const done = shopItems().filter(i => i.checked_at);
  for (const i of done) write("shop_list", { id: i.id, deleted_at: nowIso() });
  return done.length;
}


/* ---------- obiettivi di risparmio (stesse regole del Mac: api_obiettivi.py) ---------- */
const GOAL_COLORS = ["#2E5E4E", "#378ADD", "#D85A30", "#7F77DD", "#BA7517", "#D4537E", "#1D9E75"];
function monthsBetween(a, b) {
  const [ay, am, ad] = a.split("-").map(Number), [by, bm, bd] = b.split("-").map(Number);
  return Math.max(1, (by - ay) * 12 + (bm - am) + (bd >= ad ? 1 : 0));
}
function goalsView() {
  const today = todayIso(), saved = {};
  for (const m of rows("goal_moves")) saved[m.goal_id] = (saved[m.goal_id] || 0) + Number(m.amount);
  const ord = { attivo: 0, raggiunto: 1, archiviato: 2 };
  const goals = rows("goals").map(g => {
    const target = Number(g.target), sv = round2(saved[g.id] || 0), left = round2(Math.max(0, target - sv));
    const x = Object.assign({}, g, { target, saved: sv, left, pct: target ? Math.min(100, sv / target * 100) : 0, monthly: null, months_left: null, late: false,
      moves: rows("goal_moves").filter(m => m.goal_id === g.id).map(m => Object.assign({}, m, { amount: Number(m.amount) }))
        .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || String(b.updated_at).localeCompare(String(a.updated_at))) });
    if (g.due_date && left > 0 && g.status === "attivo") {
      if (g.due_date < today) x.late = true;
      else { x.months_left = monthsBetween(today, g.due_date); x.monthly = round2(left / x.months_left); }
    }
    return x;
  }).sort((a, b) => (ord[a.status] - ord[b.status]) || String(a.due_date || "9999").localeCompare(String(b.due_date || "9999")));
  const act = goals.filter(g => g.status === "attivo");
  return { goals, monthly_total: round2(act.reduce((s, g) => s + (g.monthly || 0), 0)),
    saved_total: round2(act.reduce((s, g) => s + g.saved, 0)), target_total: round2(act.reduce((s, g) => s + g.target, 0)) };
}
function saveGoal(d) {
  guard();
  const name = (d.name || "").trim(); if (!name) throw new Error("Dai un nome all'obiettivo (es. Fondo emergenze)");
  const target = parseAmount(d.target); if (!target || target <= 0) throw new Error("Indica quanto volete mettere da parte");
  const status = ["attivo", "raggiunto", "archiviato"].includes(d.status) ? d.status : "attivo";
  const row = { id: d.id || uuid4(), name, target, due_date: d.due_date || null, status, notes: (d.notes || "").trim() || null, deleted_at: null };
  if (!d.id) { const n = Object.keys(DB.t.goals).length; row.color = GOAL_COLORS[n % GOAL_COLORS.length]; row.sort_order = n + 1; row.trip_id = null; }
  write("goals", row);
  const start = d.start_amount ? parseAmount(d.start_amount) : null;
  if (start && !d.id) write("goal_moves", { id: uuid4(), goal_id: row.id, amount: start, occurred_on: todayIso(), note: "Già da parte", deleted_at: null });
  return row;
}
function deleteGoal(id) {
  guard();
  for (const m of rows("goal_moves")) if (m.goal_id === id) write("goal_moves", { id: m.id, deleted_at: nowIso() });
  write("goals", { id, deleted_at: nowIso() });
}
function addGoalMove(goalId, amount, note, withdraw) {
  guard(); let v = parseAmount(amount); if (!v) throw new Error("Inserisci l'importo");
  v = withdraw ? -Math.abs(v) : Math.abs(v);
  write("goal_moves", { id: uuid4(), goal_id: goalId, amount: v, occurred_on: todayIso(), note: (note || "").trim() || null, deleted_at: null });
  const g = DB.t.goals[goalId], saved = rows("goal_moves").filter(m => m.goal_id === goalId).reduce((s, m) => s + Number(m.amount), 0);
  const reached = g.status === "attivo" && saved >= Number(g.target);
  if (reached) write("goals", { id: goalId, status: "raggiunto" });
  return reached;
}
function deleteGoalMove(id) { guard(); write("goal_moves", { id, deleted_at: nowIso() }); }

/* ---------- previsione di fine mese (stesse regole del Mac: api_previsione.py) ---------- */
const LIQUID = ["conto", "carta", "contanti"];
const CAR_TYPES = [
  ["Carburante", ["eni ", "enilive", "q8", "tamoil", "esso", "agip", "api-ip", "ip ", "carburant", "benzina", "gasolio", "distributore", "gpl", "metano", "self service", "ricarica auto", "fuel", "stazione", "shell", "repsol", "totalerg", "totalenergies", "erg ", "kuwait", "beyfin", "petrol", "rifornim", "carbur"]],
  ["Manutenzione", ["officina", "gommista", "tagliando", "revisione", "carrozzeria", "ricambi", "lavaggio", "norauto", "midas", "pneumatic", "meccanic", "elettrauto"]],
  ["Assicurazione", ["assicuraz", "polizz", "rca", "unipol", "allianz", "axa", "zurich", "genertel", "linear", "prima.it", "verti", "conte.it"]],
  ["Bollo", ["bollo auto", "tassa automobilistica", "bollo "]],
  ["Pedaggi e parcheggi", ["autostrade", "telepass", "pedaggio", "parcheggio", "easypark", "parking", "unipolmove"]],
];
function expenseType(text) {
  const t = norm(text); if (t.includes("imposta di bollo")) return null;
  for (const [label, words] of CAR_TYPES) if (words.some(w => t.includes(w))) return label;
  return "Altro";
}
function forecastSettings() {
  const r = DB.t.app_settings[DB.hh + "|forecast_settings"], s = { threshold: 200, days: 90, months: 3 };
  try { const j = JSON.parse(r && r.value || "{}"); for (const k in s) if (k in j) s[k] = parseInt(j[k], 10); } catch (e) { }
  return s;
}
function forecast() {
  const today = todayIso(), cur = today.slice(0, 7), st = forecastSettings();
  const tx = rows("transactions").map(t => Object.assign({}, t, { amount: Number(t.amount) }));
  const accs = rows("accounts").sort((a, b) => a.sort_order - b.sort_order).map(a => ({ ...a, balance: round2(Number(a.opening_balance) + tx.filter(t => t.occurred_on <= today)
    .reduce((s, t) => s + (t.account_id === a.id ? (t.kind === "entrata" ? t.amount : -t.amount) : t.kind === "trasferimento" && t.transfer_account_id === a.id ? t.amount : 0), 0)) }));
  const liquid = accs.filter(a => LIQUID.includes(a.type));
  const active = rows("recurrings").filter(r => r.status === "attiva").map(r => Object.assign({}, r, { amount: Number(r.amount) }));
  const recKeys = active.filter(r => r.kind === "spesa" && r.match_text).map(r => norm(r.match_text).trim()).filter(k => k.length >= 3);
  const tmap = tripMap(), since = addDays(today, -st.days);
  const first = tx.reduce((m, t) => !m || t.occurred_on < m ? t.occurred_on : m, null);
  const variable = tx.filter(t => t.kind === "spesa" && !t.recurring_id && t.occurred_on > since && t.occurred_on <= today && !(t.id in tmap) && !recKeys.some(k => norm(t.description).includes(k)));
  let span = st.days; if (first) span = Math.max(30, Math.min(st.days, daysTo(today) - daysTo(first) + 1));
  const daily = variable.length ? round2(variable.reduce((s, t) => s + t.amount, 0) / span) : 0;
  const m3 = shiftMonth(cur, -3), byM = {};
  for (const t of tx) if (t.kind === "entrata" && !t.recurring_id && t.occurred_on >= m3 + "-01" && t.occurred_on <= today) byM[t.occurred_on.slice(0, 7)] = (byM[t.occurred_on.slice(0, 7)] || 0) + t.amount;
  const full = [1, 2, 3].map(i => byM[shiftMonth(cur, -i)] || 0).sort((a, b) => a - b);
  const usual = full.some(Boolean) ? round2(full[1]) : 0, gotNow = round2(byM[cur] || 0);
  const covered = words => active.some(r => words.some(w => (r.name + " " + (r.match_text || "")).toLowerCase().includes(w)));
  const vtx = tx.filter(t => t.vehicle_id && t.kind === "spesa").sort((a, b) => b.occurred_on.localeCompare(a.occurred_on));
  const carEvents = [];
  for (const v of activeVehicles()) for (const [f, label, kind, words] of [["bollo_due", "Bollo", "Bollo", ["bollo"]], ["insurance_due", "Assicurazione", "Assicurazione", ["assicuraz", "rc auto", "rca", "polizza"]], ["revision_due", "Revisione", "Manutenzione", ["revisione"]]]) {
    if (!v[f] || (f === "insurance_due" && (+v.insurance_months || 12) < 6)) continue;   // a rate: già nelle spese di ogni mese
    const w2 = f === "insurance_due" && v.insurance_company ? words.concat([v.insurance_company.toLowerCase()]) : words;
    if (covered(w2)) continue;
    const last = vtx.find(t => t.vehicle_id === v.id && expenseType(t.description) === kind && (f !== "revision_due" || (t.description || "").toLowerCase().includes("revision")));
    carEvents.push({ date: v[f], name: `${label} ${v.name}`, amount: last ? last.amount : null, tag: "auto" });
  }
  const tripItems = rows("trip_items").filter(i => !i.booked && i.amount != null && i.due_date && trips().some(t => t.id === i.trip_id && t.status !== "annullata"));
  const goalsMonthly = goalsView().monthly_total;
  const months = []; let bal = round2(liquid.reduce((s, a) => s + a.balance, 0)); const startBal = bal;
  for (let i = 0; i < st.months; i++) {
    const m = shiftMonth(cur, i), mStart = m + "-01", mEnd = `${m}-${pad2(new Date(+m.slice(0, 4), +m.slice(5), 0).getDate())}`;
    const from = i === 0 ? addDays(today, 1) : mStart, items = [];
    for (const r of active) {
      if (!isDue(r, m) || r.start_month.slice(0, 7) > m) continue;
      const d = dueDate(r, m);
      if (i === 0 && paidTx(d, linkedTx(r.id))) continue;
      const sign = r.kind === "entrata" ? 1 : -1;
      items.push({ date: d, name: r.name, amount: sign * r.amount, tag: sign > 0 ? "entrata" : "ricorrente", late: i === 0 && d < today });
    }
    for (const e of carEvents) if (mStart <= e.date && e.date <= mEnd && (i > 0 || e.date >= today)) items.push({ date: e.date, name: e.name, amount: e.amount ? -e.amount : null, tag: "auto", estimated: true });
    for (const t of tripItems) if (mStart <= t.due_date && t.due_date <= mEnd) items.push({ date: t.due_date, name: `${t.name} (${DB.t.trips[t.trip_id].name})`, amount: -Number(t.amount), tag: "vacanza" });
    const daysLeft = mEnd >= from ? daysTo(mEnd) - daysTo(from) + 1 : 0;
    const varOut = round2(daily * daysLeft), incMore = round2(Math.max(0, usual - (i === 0 ? gotNow : 0)));
    const recIn = round2(items.filter(x => x.amount > 0).reduce((s, x) => s + x.amount, 0));
    const fixed = round2(-items.filter(x => x.amount != null && x.amount < 0).reduce((s, x) => s + x.amount, 0));
    const end = round2(bal + recIn + incMore - fixed - varOut);
    months.push({ month: m, start: bal, income_recurring: recIn, income_usual: incMore, fixed, variable: varOut, days: daysLeft, end,
      after_goals: round2(end - goalsMonthly * (i + 1)), items: items.sort((a, b) => a.date.localeCompare(b.date)), unknown: items.filter(x => x.amount == null).map(x => x.name) });
    bal = end;
  }
  const warn = months.find(m => m.end < st.threshold);
  return { balance: startBal, accounts: liquid, work_available: fundAvailable(), daily, span_days: span, usual_income: usual, income_now: gotNow, months, settings: st, goals_monthly: goalsMonthly,
    warning: warn ? { month: warn.month, end: warn.end } : null };
}

/* ---------- saldo reale di un conto (stessa regola del Mac: corregge il saldo iniziale) ---------- */
function setAccountBalance(accountId, value) {
  guard();
  const target = parseAmount(value); if (target == null || isNaN(target)) throw new Error("Scrivi il saldo di oggi");
  const a = DB.t.accounts[accountId]; if (!a) throw new Error("Conto non trovato");
  const today = todayIso();
  const moved = rows("transactions").filter(t => t.occurred_on <= today).reduce((s, t) => s + (t.account_id === accountId
    ? (t.kind === "entrata" ? Number(t.amount) : -Number(t.amount)) : t.kind === "trasferimento" && t.transfer_account_id === accountId ? Number(t.amount) : 0), 0);
  const diff = round2(target - (Number(a.opening_balance) + moved));
  write("accounts", { id: accountId, opening_balance: round2(Number(a.opening_balance) + diff) });
  return diff;
}


/* ---------- com'è andato il mese (stesse regole del Mac: api_mese.py) ---------- */
function monthSummary(month) {
  month = month || shiftMonth(todayIso().slice(0, 7), -1);
  const [a, b] = monthBounds(month), p3 = monthBounds(shiftMonth(month, -3))[0];
  const tx = rows("transactions").filter(t => ["spesa", "entrata"].includes(t.kind) && t.occurred_on >= p3 && t.occurred_on < b).map(t => ({ ...t, amount: Number(t.amount) }));
  const cur = tx.filter(t => t.occurred_on >= a), prev = tx.filter(t => t.occurred_on < a);
  const sum = (r, k) => round2(r.filter(t => t.kind === k).reduce((s, t) => s + t.amount, 0));
  const inc = sum(cur, "entrata"), exp = sum(cur, "spesa"), saved = round2(inc - exp);
  const mp = [...new Set(prev.map(t => t.occurred_on.slice(0, 7)))], n = mp.length || 1;
  const avgExp = mp.length ? round2(sum(prev, "spesa") / n) : null;
  const topOf = id => { const c = catById(id); return c && c.parent_id && catById(c.parent_id) ? catById(c.parent_id) : c; };
  const byTop = rs => { const o = {}; rs.filter(t => t.kind === "spesa").forEach(t => { const c = topOf(t.category_id), k = c ? c.id : "none";
    o[k] = o[k] || { name: c ? c.name : "Senza categoria", color: c ? c.color : "#94A099", amount: 0 }; o[k].amount = round2(o[k].amount + t.amount); }); return o; };
  const nc = byTop(cur), pc = byTop(prev);
  const cats = [...new Set([...Object.keys(nc), ...Object.keys(pc)])].map(k => { const e = { ...(nc[k] || { ...pc[k], amount: 0 }) };
    e.avg = mp.length ? round2(((pc[k] || {}).amount || 0) / n) : null; e.diff = mp.length ? round2(e.amount - (e.avg || 0)) : null; return e; })
    .sort((x, y) => y.amount - x.amount);
  const moved = cats.filter(c => c.diff != null && Math.abs(c.diff) >= 20 && (!c.avg || Math.abs(c.diff) / c.avg >= 0.15));
  const worse = moved.filter(c => c.diff > 0).sort((x, y) => y.diff - x.diff).slice(0, 3), better = moved.filter(c => c.diff < 0).sort((x, y) => x.diff - y.diff).slice(0, 3);
  const md = monthData(month), bud = Object.entries(md.budgets).map(([k, v]) => ({ name: (catById(k) || {}).name || "?", budget: Number(v), spent: md.spentAll[k] || 0 }));
  const over = bud.filter(x => x.spent > x.budget);
  const goals = round2(rows("goal_moves").filter(m => m.occurred_on >= a && m.occurred_on < b).reduce((s, m) => s + Number(m.amount), 0));
  const fund = fundAccount();
  const workSpent = fund ? round2(rows("transactions").filter(t => t.kind === "trasferimento" && t.transfer_account_id === fund.id && t.occurred_on >= a && t.occurred_on < b).reduce((s, t) => s + Number(t.amount), 0)) : 0;
  const E = v => eur(Math.abs(v)), name = MESI_DATI[+month.slice(5) - 1], hl = [];
  if (inc || exp) hl.push(`A ${name} sono entrati ${E(inc)} e avete speso ${E(exp)}: ${saved >= 0 && inc ? `messo da parte ${E(saved)} (il ${Math.round(saved / inc * 100)}%)` : `${E(saved)} più delle entrate`}.`);
  if (avgExp) { const d = exp - avgExp; hl.push(Math.abs(d) >= Math.max(30, avgExp * 0.05) ? `Avete speso ${E(d)} ${d > 0 ? "in più" : "in meno"} della media dei mesi precedenti.` : "Le spese sono in linea con la media dei mesi precedenti."); }
  if (worse.length) hl.push(`Spese aumentate: ${worse.map(c => `${c.name} (+${E(c.diff)})`).join(", ")}.`);
  if (better.length) hl.push(`Spese diminuite: ${better.map(c => `${c.name} (−${E(c.diff)})`).join(", ")}.`);
  if (bud.length) hl.push(`Budget: ${over.length ? `${over.length} su ${bud.length} sforati (${over.map(x => x.name).join(", ")})` : "tutti rispettati 👏"}.`);
  if (goals) hl.push(`Per gli obiettivi avete messo da parte ${E(goals)}.`);
  if (workSpent) hl.push(`Spese di lavoro: ${E(workSpent)}, da segnare nella nota spese.`);
  return { month, income: inc, expense: exp, saved, avg_expense: avgExp, categories: cats.slice(0, 8), worse, better, budgets: bud, over, goals, work_spent: workSpent, highlights: hl };
}
const MESI_DATI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];


/* ---------- km dell'auto aziendale (stesse regole del Mac: api_km.py) ---------- */
const KM_DEFAULTS = { da: "San Martino di Lupari", cars: [{ name: "Peugeot 308 SW", from: "2000-01-01" }], name: "ALBERTO GUIZZO" };
function kmSettings() {
  const r = DB.t.app_settings[DB.hh + "|km_settings"], s = JSON.parse(JSON.stringify(KM_DEFAULTS));
  try { Object.assign(s, JSON.parse(r && r.value || "{}")); } catch (e) { }
  return s;
}
function carOn(s, day) {
  const cars = (s.cars || KM_DEFAULTS.cars).slice().sort((a, b) => a.from.localeCompare(b.from));
  let name = cars[0].name; for (const c of cars) if (c.from <= day) name = c.name; return name;
}
const kmSplit = v => String(v || "").split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
function kmRows() {
  const rs = rows("work_km").map(r => ({ ...r, odometer: r.odometer == null ? null : Number(r.odometer), km: r.km == null ? null : Number(r.km) }))
    .sort((a, b) => a.day.localeCompare(b.day) || (a.kind === "weekend") - (b.kind === "weekend"));
  let last = null, lastWork = null;
  for (const r of rs) {
    r.day_km = null;
    if (r.kind === "giorno") {
      if (r.km != null) r.day_km = r.km; else if (r.odometer != null && last != null) r.day_km = round1(r.odometer - last);
      if (r.odometer != null) last = lastWork = r.odometer;
    } else { r.private_km = r.odometer != null && lastWork != null ? round1(r.odometer - lastWork) : null; if (r.odometer != null) last = r.odometer; }
  }
  return rs;
}
const round1 = n => Math.round(n * 10) / 10;
async function saveKm(d) {
  guard();
  const kind = d.kind === "weekend" ? "weekend" : "giorno", day = d.day || todayIso();
  const odo = d.odometer === "" || d.odometer == null ? null : parseAmount(d.odometer), km = d.km === "" || d.km == null ? null : parseAmount(d.km);
  if (odo == null && km == null) throw new Error("Scrivi i km del contachilometri");
  if ((odo != null && isNaN(odo)) || (km != null && isNaN(km))) throw new Error("Numero non valido");
  const s = kmSettings(), id = await uuid5([DB.hh, "km", kind, day].join(":"));
  const prev = kmRows().filter(r => r.odometer != null && (r.day < day || (r.day === day && kind === "weekend" && r.kind === "giorno"))).pop();
  const row = { id, day, kind, odometer: odo, km, deleted_at: null };
  if (kind === "giorno") Object.assign(row, { da: (d.da || s.da).trim(), a: [...new Set(kmSplit(d.a))].join(", ") || null,
    car: (d.car || carOn(s, day)).trim(), clients: [...new Set(kmSplit(d.clients))].join(", ") || null, notes: (d.notes || "").trim() || null });
  write("work_km", row);
  return { warning: odo != null && prev && odo < prev.odometer ? `Il contachilometri è più basso dell'ultima lettura (${prev.odometer}): controlla il numero` : null };
}
function deleteKm(id) { guard(); write("work_km", { id, deleted_at: nowIso() }); }
function kmWeek(monIso) {
  const rs = kmRows(), by = {}; rs.forEach(r => by[r.day + "|" + r.kind] = r);
  const first = rs.length ? rs[0].day : "9999";   // i giorni prima di cominciare non sono «mancanti»
  const days = [0, 1, 2, 3, 4].map(i => { const d = addDays(monIso, i); return { day: d, entry: by[d + "|giorno"] || null, missing: !by[d + "|giorno"] && d <= todayIso() && d > first }; });
  return { monday: monIso, days, weekend: by[addDays(monIso, 6) + "|weekend"] || null, km: round1(days.reduce((s, x) => s + ((x.entry || {}).day_km || 0), 0)) };
}
const mondayOf = iso => { const d = new Date(iso + "T12:00:00"); return addDays(iso, -((d.getDay() + 6) % 7)); };
function kmSuggestions() {
  const places = {}, clients = {};
  for (const r of rows("work_km")) { kmSplit(r.a).forEach(p => places[p.toLowerCase()] = p); kmSplit(r.clients).forEach(c => clients[c.toLowerCase()] = c); }
  const sort = o => Object.values(o).sort((a, b) => a.localeCompare(b, "it"));
  return { places: sort(places), clients: sort(clients) };
}
