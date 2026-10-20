/* ==========================================================================
   Finanze di Famiglia — web app per iPhone: schermate
   ========================================================================== */
"use strict";

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const MB = MESI.map(m => m.slice(0, 3));
const GG = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const eur = n => fmt.format(n || 0);
const amountText = n => n == null ? "" : String(n).replace(".", ",");
const thisMonth = () => todayIso().slice(0, 7);
const monthName = m => `${MESI[+m.slice(5) - 1]} ${m.slice(0, 4)}`;
const shortDate = iso => `${+iso.slice(8)} ${MB[+iso.slice(5, 7) - 1]}`;
let toastT;
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2800); }
const ICON = {
  home: '<path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  list: '<path d="M5 7h14M5 12h14M5 17h9"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  more: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
  cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
};
const S = { view: "home", month: thisMonth(), search: "" };

/* ==========================================================================
   Accesso
   ========================================================================== */
function renderLogin(mode, msg) {
  const first = mode === "primo", reset = mode === "reset", newpw = mode === "nuova";
  $("#app").innerHTML = `<div class="login">
    <h1>Finanze di Famiglia</h1>
    <p class="lead">${newpw ? "Scegli la nuova password." : first ? "Sei stato invitato? Crea la tua password con l'email dell'invito."
      : reset ? "Ti mandiamo un'email con il link per scegliere una nuova password." : "Accedi con l'utente della tua famiglia."}</p>
    <form id="lf">
      ${newpw ? "" : `<label class="f"><span>Email</span><input type="email" id="le" autocomplete="username" required></label>`}
      ${reset ? "" : `<label class="f"><span>${first || newpw ? "Nuova password (almeno 8 caratteri)" : "Password"}</span>
        <input type="password" id="lp" autocomplete="${first || newpw ? "new-password" : "current-password"}" required></label>`}
      ${first || newpw ? `<label class="f"><span>Ripeti la password</span><input type="password" id="lp2" autocomplete="new-password" required></label>` : ""}
      <p class="err" id="lerr">${esc(msg || "")}</p>
      <button class="btn primary wide" id="lb">${newpw ? "Salva la password" : first ? "Crea la password" : reset ? "Mandami l'email" : "Accedi"}</button>
    </form>
    ${newpw ? "" : `<p style="text-align:center;margin-top:18px;display:grid;gap:4px">
      ${mode ? `<button class="btn link" data-m="">Ho già un account: accedi</button>` : ""}
      ${!first ? `<button class="btn link" data-m="primo">Primo accesso? Crea la tua password</button>` : ""}
      ${!reset ? `<button class="btn link" data-m="reset">Password dimenticata?</button>` : ""}</p>`}
  </div>`;
  $$("[data-m]").forEach(b => b.onclick = () => renderLogin(b.dataset.m));
  $("#lf").onsubmit = async e => {
    e.preventDefault();
    const b = $("#lb"), label = b.textContent; b.disabled = true;
    const fail = m => { b.disabled = false; b.textContent = label; $("#lerr").textContent = m; };
    try {
      if ((first || newpw) && $("#lp").value !== $("#lp2").value) return fail("Le due password non coincidono");
      if ((first || newpw) && $("#lp").value.length < 8) return fail("La password deve avere almeno 8 caratteri");
      if (reset) { b.textContent = "Invio…"; await recover($("#le").value); return renderLogin("", "Email inviata: apri il link che trovi nella posta."); }
      if (newpw) { b.textContent = "Salvataggio…"; await updatePassword($("#lp").value); await enterHousehold(); toast("Password aggiornata"); return renderShell(); }
      if (first) {
        b.textContent = "Creazione dell'account…";
        const r = await signup($("#le").value, $("#lp").value);
        if (r.confirm) return renderLogin("", "Controlla la tua email e apri il link di conferma: poi entri direttamente.");
        return renderShell();
      }
      b.textContent = "Accesso e scaricamento dati…";
      await login($("#le").value, $("#lp").value);
      renderShell();
    } catch (err) {
      fail(err instanceof Offline ? "Nessuna connessione a internet" : /already|registered/i.test(err.message)
        ? "Questa email ha già un account: accedi o recupera la password" : err.message);
    }
  };
}

/* ==========================================================================
   Struttura
   ========================================================================== */
function renderShell() {
  $("#app").innerHTML = `
    <header class="top">
      <div class="t"><h1 id="ttl"></h1><div class="sub" id="sub"></div></div>
      <div class="mnav" id="mnav"><button id="mp" aria-label="Mese precedente">‹</button><button id="mn" aria-label="Mese successivo">›</button></div>
    </header>
    <main id="view"></main>
    <nav class="tabbar">
      <button data-v="home"><svg viewBox="0 0 24 24">${ICON.home}</svg>Riepilogo</button>
      <button data-v="movimenti"><svg viewBox="0 0 24 24">${ICON.list}</svg>Movimenti</button>
      <button class="add" id="addbtn" aria-label="Aggiungi una spesa"><span>+</span></button>
      <button data-v="scadenze"><svg viewBox="0 0 24 24">${ICON.cal}</svg>Scadenze</button>
      <button data-v="altro"><svg viewBox="0 0 24 24">${ICON.more}</svg>Altro</button>
    </nav>`;
  $$(".tabbar [data-v]").forEach(b => b.onclick = () => { S.view = b.dataset.v; render(); window.scrollTo(0, 0); });
  $("#addbtn").onclick = () => openTx();
  $("#mp").onclick = () => { S.month = shiftMonth(S.month, -1); render(); };
  $("#mn").onclick = () => { S.month = shiftMonth(S.month, 1); render(); };
  render();
}

function statusLine() {
  const p = pendingCount();
  if (syncing) return `<span class="dotsync busy"></span>Sincronizzazione…`;
  if (syncError === "offline") return `<span class="dotsync wait"></span>Offline${p ? `, ${p} da inviare` : ""}`;
  if (syncError) return `<span class="dotsync bad"></span>Errore di sincronizzazione`;
  if (p) return `<span class="dotsync wait"></span>${p} da inviare`;
  if (DB.lastSync) { const d = new Date(DB.lastSync); return `<span class="dotsync"></span>Aggiornato alle ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
  return "";
}

function render() {
  if (!$("#view")) return;
  $$(".tabbar [data-v]").forEach(b => b.classList.toggle("on", b.dataset.v === S.view));
  const withMonth = ["home", "movimenti", "scadenze"].includes(S.view);
  $("#mnav").style.visibility = withMonth ? "visible" : "hidden";
  $("#ttl").textContent = withMonth ? monthName(S.month).replace(/^./, c => c.toUpperCase()) : "Altro";
  $("#sub").innerHTML = `${esc(DB.hhName || "")} · ${statusLine()}`;
  ({ home: viewHome, movimenti: viewMovimenti, scadenze: viewScadenze, altro: viewAltro })[S.view]();
}
listeners.add(() => { if ($("#sub")) $("#sub").innerHTML = `${esc(DB.hhName || "")} · ${statusLine()}`; });

/* ==========================================================================
   Riepilogo
   ========================================================================== */
function donut(rows, total) {
  const R = 52, C = 2 * Math.PI * R; let off = 0;
  const arcs = rows.map(r => { const len = total ? r.v / total * C : 0;
    const a = `<circle r="${R}" cx="66" cy="66" fill="none" stroke="${r.color}" stroke-width="20" stroke-dasharray="${Math.max(0, len - 2)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 66 66)"/>`;
    off += len; return a; }).join("");
  return `<svg viewBox="0 0 132 132" width="132" height="132" role="img" aria-label="Spese per categoria">
    <circle r="${R}" cx="66" cy="66" fill="none" stroke="var(--line)" stroke-width="20"/>${arcs}
    <text x="66" y="64" text-anchor="middle" style="font:700 15px var(--round);fill:var(--text)">${eur(total).replace(",00", "")}</text>
    <text x="66" y="82" text-anchor="middle" style="font-size:10px;fill:var(--muted)">spese</text></svg>`;
}

function viewHome() {
  const d = monthData(S.month), isNow = S.month === thisMonth(), mName = MESI[+S.month.slice(5) - 1];
  const saved = round2(d.income - d.expense);
  const intro = isNow ? mName[0].toUpperCase() + mName.slice(1) + " finora" : "A " + mName;
  const sentence = d.income || d.expense
    ? `${intro}: sono entrati <span class="in">${eur(d.income)}</span>, avete speso <span class="out">${eur(d.expense)}</span>${saved >= 0
      ? ` e messo da parte <span class="sv">${eur(saved)}</span>.` : `, ${eur(-saved)} più delle entrate.`}`
    : `${intro}: ancora nessun movimento.`;
  const top = {}; d.tx.filter(t => t.kind === "spesa").forEach(t => { let c = catById(t.category_id); if (c && c.parent_id && catById(c.parent_id)) c = catById(c.parent_id);
    const k = c ? c.id : "none"; top[k] = top[k] || { name: c ? c.name : "Senza categoria", color: c ? c.color : "#94A099", v: 0 }; top[k].v += t.amount; });
  let rowsCat = Object.values(top).sort((a, b) => b.v - a.v);
  if (rowsCat.length > 5) rowsCat = [...rowsCat.slice(0, 5), { name: "Altro", color: "#B8C2BB", v: rowsCat.slice(5).reduce((s, r) => s + r.v, 0) }];
  const ser = series(S.month, 6); const max = Math.max(1, ...ser.flatMap(s => [s.income, s.expense]));
  const buds = cats().filter(c => d.budgets[c.id] != null && !c.deleted_at).map(c => ({ c, b: d.budgets[c.id], s: d.spentAll[c.id] || 0 }))
    .sort((x, y) => y.s / y.b - x.s / x.b);
  const in30 = addDays(todayIso(), 30);
  const up = recurringView(S.month).filter(r => r.status === "attiva" && r.next_due && r.next_due <= in30).sort((a, b) => a.next_due.localeCompare(b.next_due)).slice(0, 6);
  const acc = balances(); const tot = acc.reduce((s, a) => s + a.balance, 0);
  const sumIO = Math.max(d.income, d.expense) || 1;
  $("#view").innerHTML = `
    <p class="hero">${sentence}</p>
    <div class="split"><div style="width:${Math.min(d.expense, d.income || d.expense) / sumIO * 100}%;background:var(--out)"></div>
      <div style="width:${Math.max(0, saved) / sumIO * 100}%;background:var(--in)"></div></div>
    <div class="legend"><span><i class="dot" style="background:var(--out)"></i>Speso</span><span><i class="dot" style="background:var(--in)"></i>Messo da parte</span>
      ${d.income ? `<span>${Math.round(Math.max(0, saved) / d.income * 100)}% risparmiato</span>` : ""}</div>

    <div class="card"><h2>Dove sono andati i soldi</h2>
      ${rowsCat.length ? `<div class="donut-wrap">${donut(rowsCat, d.expense)}<div class="lst">${rowsCat.map(r => `<div class="row" style="padding:6px 0">
        <span class="dot" style="background:${r.color}"></span><span class="n">${esc(r.name)}</span><b class="num">${eur(r.v).replace(",00", "")}</b></div>`).join("")}</div></div>`
        : `<p class="muted">Nessuna spesa ${isNow ? "per ora" : "in questo mese"}.</p>`}
    </div>

    <div class="card"><h2>Ultimi 6 mesi</h2>
      <div class="chart">${ser.map(s => `<div class="m ${s.month === S.month ? "cur" : ""}">
        <div class="bars"><div style="height:${s.income / max * 100}%;background:var(--in)"></div><div style="height:${s.expense / max * 100}%;background:var(--out)"></div></div>
        <span class="lbl">${MB[+s.month.slice(5) - 1]}</span></div>`).join("")}</div>
      <div class="legend" style="margin:10px 0 0"><span><i class="dot" style="background:var(--in)"></i>Entrate</span><span><i class="dot" style="background:var(--out)"></i>Spese</span></div>
    </div>

    ${buds.length ? `<div class="card"><h2>Budget</h2>${buds.map(({ c, b, s }) => { const pct = Math.min(100, s / b * 100);
      return `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:5px">
        <span>${esc(c.name)}</span><span class="num ${s > b ? "out" : "muted"}">${eur(s)} di ${eur(b)}</span></div>
        <div class="bar"><div class="${s > b ? "over" : pct >= 80 ? "warn" : ""}" style="width:${pct}%"></div></div></div>`; }).join("")}</div>` : ""}

    <div class="card"><h2>Prossime scadenze</h2>
      ${up.length ? up.map(r => `<div class="row"><span class="muted num" style="width:50px">${shortDate(r.next_due)}</span><span class="n">${esc(r.name)}</span>
        ${r.next_due < todayIso() ? '<span class="badge late">Non trovata</span>' : ""}<b class="num">${eur(r.amount)}</b></div>`).join("")
        : `<p class="muted">Nessuna scadenza nei prossimi 30 giorni.</p>`}
    </div>

    <div class="card"><h2>Conti</h2>${acc.map(a => `<div class="row"><span class="n">${esc(a.name)}</span><b class="num ${a.balance < 0 ? "out" : ""}">${eur(a.balance)}</b></div>`).join("")}
      <div class="row"><span class="n muted">Totale</span><b class="num">${eur(tot)}</b></div></div>

    <div class="card"><h2>Ultimi movimenti</h2>${d.tx.length ? `<div class="list">${d.tx.slice(0, 5).map(txRow).join("")}</div>
      <button class="btn link" id="all-tx">Tutti i movimenti</button>` : `<p class="muted">Nessun movimento.</p>`}</div>`;
  if ($("#all-tx")) $("#all-tx").onclick = () => { S.view = "movimenti"; render(); window.scrollTo(0, 0); };
  bindTxRows(d.tx);
}

/* ==========================================================================
   Movimenti
   ========================================================================== */
function txRow(t) {
  const c = catById(t.category_id); const tr = t.kind === "trasferimento";
  const color = tr ? "#3C6A8C" : c ? c.color : "#94A099";
  const acc = DB.t.accounts[t.account_id], to = DB.t.accounts[t.transfer_account_id];
  const title = tr ? `${acc ? acc.name : "?"} → ${to ? to.name : "?"}` : t.description || (c ? c.name : t.kind === "entrata" ? "Entrata" : "Spesa");
  const sign = t.kind === "entrata" ? "+" : t.kind === "spesa" ? "−" : "";
  return `<div class="tx" data-id="${t.id}"><div class="w"><div class="t">${esc(title)}</div>
    <div class="s"><span class="chip" style="background:${color}22"><span class="dot" style="background:${color};width:7px;height:7px"></span>${esc(tr ? "Trasferimento" : c ? catLabel(c.id) : "Senza categoria")}</span>
    ${t.updated_by ? `<span>${esc(t.updated_by)}</span>` : ""}</div></div>
    <div class="a num ${t.kind === "entrata" ? "in" : t.kind === "spesa" ? "out" : "mv"}">${sign}${eur(t.amount)}</div></div>`;
}
function bindTxRows(list) { $$("#view .tx").forEach(el => el.onclick = () => openTx(list.find(t => t.id === el.dataset.id))); }

function viewMovimenti() {
  const d = monthData(S.month); const q = S.search.trim().toLowerCase();
  const list = d.tx.filter(t => !q || [t.description, catLabel(t.category_id), amountText(t.amount)].some(x => String(x || "").toLowerCase().includes(q)));
  const days = {}; list.forEach(t => (days[t.occurred_on] = days[t.occurred_on] || []).push(t));
  $("#view").innerHTML = `
    <input type="search" id="q" placeholder="Cerca" value="${esc(S.search)}" style="margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;font-size:14px;margin:0 4px 12px" class="muted">
      <span>Entrate <b class="in num">${eur(d.income)}</b></span><span>Spese <b class="out num">${eur(d.expense)}</b></span></div>
    ${Object.keys(days).length ? Object.entries(days).map(([day, txs]) => { const dt = new Date(day + "T12:00:00");
      return `<div class="day"><div class="dcol"><div class="dnum">${dt.getDate()}</div><div class="dname">${GG[dt.getDay()]}</div></div>
        <div class="list">${txs.map(txRow).join("")}</div></div>`; }).join("")
      : `<div class="empty">${d.tx.length ? "Nessun movimento trovato." : "Nessun movimento in " + MESI[+S.month.slice(5) - 1] + ".<br>Tocca + per aggiungerne uno."}</div>`}`;
  const q$ = $("#q"); q$.oninput = () => { S.search = q$.value; const p = q$.selectionStart; viewMovimenti(); const n = $("#q"); n.focus(); n.setSelectionRange(p, p); };
  bindTxRows(d.tx);
}

/* ---------- inserimento / modifica ---------- */
function openTx(t, preset) {
  if (!canEdit()) { if (!t) toast("Il tuo utente può solo consultare i dati"); if (!t) return; }
  const edit = !!t;
  const accs = balances();
  if (!accs.length) { toast("Non ci sono conti: aspetta la sincronizzazione"); sync(); return; }
  const x = t ? { ...t } : Object.assign({ kind: "spesa", occurred_on: S.month === thisMonth() ? todayIso() : S.month + "-01",
    account_id: (accs.find(a => a.type === "contanti") || accs[0]).id }, preset || {});
  let kind = x.kind, cat = x.category_id || null, catTouched = edit && !!cat;
  const sheet = document.createElement("div"); sheet.className = "sheet"; sheet.id = "sheet";
  sheet.innerHTML = `
    <div class="sheet-head"><button class="btn link" id="xc">Annulla</button><h2>${edit ? "Movimento" : "Nuova spesa"}</h2><span style="width:60px"></span></div>
    ${!edit ? `<button class="scan" id="scan"><svg viewBox="0 0 24 24">${ICON.cam}</svg>Scansiona lo scontrino</button>
      <input type="file" accept="image/*" capture="environment" id="scanf" hidden>` : ""}
    <div class="seg" id="xk" style="margin-bottom:6px"><button data-k="spesa">Spesa</button><button data-k="entrata">Entrata</button><button data-k="trasferimento">Trasferimento</button></div>
    <input class="amount num" id="xa" inputmode="decimal" placeholder="0,00" value="${esc(amountText(x.amount))}" autocomplete="off" aria-label="Importo in euro">
    <div class="amount-line">euro</div>
    <label class="f"><span>Descrizione</span><input type="text" id="xd" value="${esc(x.description)}" placeholder="Es. Esselunga, farmacia, pizzeria" autocomplete="off"></label>
    <div class="sugg" id="xs"></div>
    <div id="xcats"></div>
    <div id="xto-w"><label class="f"><span>Verso il conto</span><select id="xto">${accs.map(a => `<option value="${a.id}" ${a.id === x.transfer_account_id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <label class="f"><span id="xacc-l">Conto</span><select id="xacc">${accs.map(a => `<option value="${a.id}" ${a.id === x.account_id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
      <label class="f"><span>Data</span><input type="date" id="xdt" value="${x.occurred_on}"></label>
    </div>
    ${edit && x.updated_by ? `<p class="hint">Ultima modifica di ${esc(x.updated_by)}</p>` : ""}
    <p class="err" id="xe"></p>
    ${edit && canEdit() ? `<button class="btn danger wide" id="xdel" style="margin-top:8px">Elimina movimento</button>` : ""}
    <div class="save-bar">${canEdit() ? `<button class="btn primary wide" id="xsave">${edit ? "Salva" : "Aggiungi"}</button>` : `<button class="btn wide" id="xclose">Chiudi</button>`}</div>`;
  document.body.appendChild(sheet);
  document.body.style.overflow = "hidden";
  const close = () => { sheet.remove(); document.body.style.overflow = ""; };

  const drawCats = () => {
    if (kind === "trasferimento") { $("#xcats").innerHTML = ""; return; }
    const tree = catTree(kind);
    const sel = cat && catById(cat); const parent = sel ? (sel.parent_id ? sel.parent_id : sel.id) : null;
    const node = tree.find(n => n.c.id === parent);
    $("#xcats").innerHTML = `<label class="f" style="margin-bottom:4px"><span>Categoria</span></label>
      <div class="chips">${tree.map(({ c }) => `<button data-c="${c.id}" class="${c.id === parent ? "on" : ""}"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</button>`).join("")}</div>
      ${node && node.kids.length ? `<div class="chips sub"><button data-c="${node.c.id}" class="${cat === node.c.id ? "on" : ""}">Tutto ${esc(node.c.name)}</button>
        ${node.kids.map(k => `<button data-c="${k.id}" class="${k.id === cat ? "on" : ""}"><span class="dot" style="background:${k.color}"></span>${esc(k.name)}</button>`).join("")}</div>` : ""}`;
    $$("#xcats [data-c]").forEach(b => b.onclick = () => { cat = b.dataset.c; catTouched = true; $("#xs").textContent = ""; drawCats(); });
  };
  const suggest = () => {
    if (catTouched || kind === "trasferimento") return;
    const id = suggestCategory($("#xd").value, kind);
    if (id) { cat = id; $("#xs").textContent = "Categoria proposta in automatico: " + catLabel(id); drawCats(); }
  };
  const setKind = k => {
    kind = k; $$("#xk button").forEach(b => b.classList.toggle("on", b.dataset.k === k));
    $("#xto-w").style.display = k === "trasferimento" ? "" : "none";
    $("#xacc-l").textContent = k === "trasferimento" ? "Dal conto" : "Conto";
    if (cat && catById(cat) && catById(cat).kind !== k) cat = null;
    if (k === "trasferimento" && $("#xto").value === $("#xacc").value && accs.length > 1) $("#xto").value = accs.find(a => a.id !== $("#xacc").value).id;
    drawCats(); suggest();
    $("h2", sheet).textContent = edit ? "Movimento" : k === "spesa" ? "Nuova spesa" : k === "entrata" ? "Nuova entrata" : "Trasferimento";
  };
  $$("#xk button").forEach(b => b.onclick = () => setKind(b.dataset.k));
  setKind(kind);
  $("#xd").oninput = suggest;
  $("#xc").onclick = close;
  if ($("#xclose")) $("#xclose").onclick = close;
  if (!edit) setTimeout(() => $("#xa").focus(), 250);

  if ($("#scan")) {
    $("#scan").onclick = () => $("#scanf").click();
    $("#scanf").onchange = async () => {
      const f = $("#scanf").files[0]; if (!f) return;
      const btn = $("#scan"); btn.disabled = true;
      try {
        const r = await SCONTRINO.read(f, msg => { btn.textContent = msg; });
        const found = [];
        if (r.amount) { $("#xa").value = amountText(r.amount.toFixed(2)); found.push("importo"); }
        if (r.date) { $("#xdt").value = r.date; found.push("data"); }
        if (r.merchant && !$("#xd").value) { $("#xd").value = r.merchant; found.push("esercente"); }
        const id = suggestCategory(r.text, "spesa");
        if (id && !catTouched) { cat = id; $("#xs").textContent = "Categoria proposta dallo scontrino: " + catLabel(id); drawCats(); } else suggest();
        btn.innerHTML = `<svg viewBox="0 0 24 24">${ICON.cam}</svg>${found.length ? "Letto: " + found.join(", ") + ". Controlla e salva" : "Non sono riuscito a leggerlo: inserisci a mano"}`;
        if (!r.amount) $("#xa").focus();
      } catch (err) {
        btn.innerHTML = `<svg viewBox="0 0 24 24">${ICON.cam}</svg>${esc(err.message || "Lettura non riuscita")}`;
      } finally { btn.disabled = false; $("#scanf").value = ""; }   // la foto non viene conservata
    };
  }
  if ($("#xdel")) $("#xdel").onclick = () => {
    if (!confirm("Eliminare questo movimento?")) return;
    deleteTransaction(x.id); close(); toast("Movimento eliminato"); render();
  };
  if ($("#xsave")) $("#xsave").onclick = async () => {
    try {
      const r = await saveTransaction({ id: x.id, kind, amount: $("#xa").value, occurred_on: $("#xdt").value, account_id: $("#xacc").value,
        category_id: cat, transfer_account_id: kind === "trasferimento" ? $("#xto").value : null, description: $("#xd").value,
        ...(x.recurring_id !== undefined && edit ? { recurring_id: x.recurring_id } : {}), ...(preset && preset.recurring_id ? { recurring_id: preset.recurring_id } : {}) });
      close();
      const rec = !edit && r.recurring_id && DB.t.recurrings[r.recurring_id];
      toast(rec ? `Aggiunto e collegato a «${rec.name}»` : edit ? "Movimento aggiornato" : "Aggiunto");
      S.month = r.occurred_on.slice(0, 7); render();
    } catch (err) { $("#xe").textContent = err.message; }
  };
}

/* ==========================================================================
   Scadenze
   ========================================================================== */
function viewScadenze() {
  const v = recurringView(S.month).filter(r => r.status === "attiva");
  const due = v.filter(r => r.due).sort((a, b) => a.due.localeCompare(b.due));
  const fixed = v.filter(r => r.kind === "spesa").reduce((s, r) => s + r.monthly, 0);
  const STATE = { pagata: ["Pagata", "ok"], in_arrivo: ["In arrivo", "wait"], in_ritardo: ["Non trovata", "late"] };
  const in60 = addDays(todayIso(), 60);
  const next = v.filter(r => r.next_due && r.next_due <= in60 && !due.some(d => d.id === r.id && d.due === r.next_due))
    .sort((a, b) => a.next_due.localeCompare(b.next_due));
  $("#view").innerHTML = `
    <div class="card"><div class="muted" style="font-size:13px">Spese fisse al mese</div><div class="big out num" style="font-size:26px;font-weight:700">${eur(fixed)}</div></div>
    <div class="card"><h2>Scadenze di ${MESI[+S.month.slice(5) - 1]}</h2>
      ${due.length ? due.map(r => `<div class="row"><span class="muted num" style="width:48px">${shortDate(r.due)}</span>
        <span class="n">${esc(r.name)}<br><span class="badge ${STATE[r.state][1]}">${STATE[r.state][0]}</span></span>
        <span style="text-align:right"><b class="num">${eur(r.amount)}</b><br>${r.state !== "pagata" && canEdit() ? `<button class="btn link" data-reg="${r.id}">Registra</button>` : ""}</span></div>`).join("")
        : `<p class="muted">Nessuna scadenza in questo mese.</p>`}
    </div>
    ${next.length ? `<div class="card"><h2>Più avanti</h2>${next.map(r => `<div class="row"><span class="muted num" style="width:48px">${shortDate(r.next_due)}</span>
      <span class="n">${esc(r.name)}</span><b class="num">${eur(r.amount)}</b></div>`).join("")}</div>` : ""}
    <p class="hint" style="margin:4px">Le spese ricorrenti si gestiscono dal programma sul Mac. Quelle pagate in banca si segnano da sole quando importi l'estratto conto; per le altre usa «Registra».</p>`;
  $$("[data-reg]").forEach(b => b.onclick = async () => {
    const r = DB.t.recurrings[b.dataset.reg];
    if (!confirm(`Registrare il pagamento di «${r.name}» (${eur(r.amount)})?`)) return;
    try { await registerRecurring(r.id, S.month); toast("Pagamento registrato"); render(); } catch (e) { toast(e.message); }
  });
}

/* ==========================================================================
   Altro
   ========================================================================== */
function viewAltro() {
  const set = Object.fromEntries(rows("app_settings").map(r => [r.key, r.value]));
  $("#view").innerHTML = `
    <div class="card"><h2>${esc(DB.members[uid()] || DB.email)}</h2>
      <p class="hint">${esc(DB.email)}, famiglia ${esc(DB.hhName)}, ${({ owner: "amministratore", member: "membro", viewer: "sola lettura" })[DB.role] || ""}</p></div>
    <div class="card"><h2>Sincronizzazione</h2>
      <p class="hint">${statusLine()}${syncError && syncError !== "offline" ? `<br><span class="err">${esc(syncError)}</span>` : ""}</p>
      <p class="hint">Le spese inserite qui senza rete restano nel telefono e partono da sole appena torna la connessione.</p>
      <button class="btn" id="sn">Aggiorna adesso</button></div>
    <div class="card"><h2>Cambia password</h2>
      <label class="f"><span>Nuova password (almeno 8 caratteri)</span><input type="password" id="p1" autocomplete="new-password"></label>
      <label class="f"><span>Ripeti la password</span><input type="password" id="p2" autocomplete="new-password"></label>
      <p class="err" id="pe"></p><button class="btn" id="ps">Cambia password</button></div>
    <div class="card"><h2>Installare l'app</h2><div class="help-body"><ol>
      <li>Apri questa pagina con <b>Safari</b>${set.acc_app_url ? ` (${esc(set.acc_app_url)})` : ""}.</li>
      <li>Tocca <b>Condividi</b> (quadrato con la freccia) e poi <b>Aggiungi alla schermata Home</b>.</li>
      <li>Da lì si apre a schermo intero, come un'app.</li></ol></div></div>
    <div class="card"><h2>Esci</h2><p class="hint">Scollega questo telefono. I dati restano su Supabase.</p><button class="btn danger" id="lo">Esci</button></div>`;
  $("#sn").onclick = async () => { await sync(); toast(syncError === "offline" ? "Sei offline" : syncError || "Dati aggiornati"); render(); };
  $("#ps").onclick = async () => {
    const a = $("#p1").value, b = $("#p2").value;
    if (a.length < 8) return $("#pe").textContent = "Almeno 8 caratteri";
    if (a !== b) return $("#pe").textContent = "Le due password non coincidono";
    try { await updatePassword(a); $("#p1").value = $("#p2").value = ""; $("#pe").textContent = ""; toast("Password cambiata"); }
    catch (e) { $("#pe").textContent = e instanceof Offline ? "Serve la connessione a internet" : /different/i.test(e.message) ? "Deve essere diversa da quella attuale" : e.message; }
  };
  $("#lo").onclick = () => {
    const p = pendingCount();
    if (p && !confirm(`${p} modifiche non sono ancora state inviate: se esci le perdi. Uscire lo stesso?`)) return;
    logout(); renderLogin();
  };
}

/* ==========================================================================
   Avvio
   ========================================================================== */
async function start() {
  try {
    const link = await sessionFromLink();
    if (link === "recovery") return renderLogin("nuova");
    if (link) { await enterHousehold(); toast("Benvenuto!"); }
  } catch (e) { return renderLogin("", e.message); }
  if (!DB.session || !DB.hh) return renderLogin();
  renderShell();
  sync().then(render);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && DB.session) sync().then(() => !$("#sheet") && render()); });
window.addEventListener("online", () => DB.session && sync().then(() => !$("#sheet") && render()));
setInterval(() => { if (document.visibilityState === "visible" && DB.session && !$("#sheet")) sync().then(render); }, 120000);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => { });
start();
