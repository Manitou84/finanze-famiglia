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
  fam: '<circle cx="8" cy="8" r="2.6"/><circle cx="16" cy="8" r="2.6"/><path d="M3.5 19c0-3 2-5 4.5-5s4.5 2 4.5 5M11.5 19c0-3 2-5 4.5-5s4.5 2 4.5 5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  cart: '<path d="M3 5h2.5l2 10h10.5l2-7H7"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
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
      <button class="gear" id="gear" aria-label="Impostazioni"><svg viewBox="0 0 24 24">${ICON.gear}</svg></button>
    </header>
    <main id="view"></main>
    <nav class="tabbar">
      <button data-v="home"><svg viewBox="0 0 24 24">${ICON.home}</svg>Riepilogo</button>
      <button data-v="movimenti"><svg viewBox="0 0 24 24">${ICON.list}</svg>Movimenti</button>
      <button class="add" id="addbtn" aria-label="Aggiungi una spesa"><span>+</span></button>
      <button data-v="spesa"><svg viewBox="0 0 24 24">${ICON.cart}</svg>Spesa</button>
      <button data-v="famiglia"><svg viewBox="0 0 24 24">${ICON.fam}</svg>Famiglia</button>
    </nav>`;
  $$(".tabbar [data-v]").forEach(b => b.onclick = () => { S.view = b.dataset.v; render(); window.scrollTo(0, 0); });
  $("#addbtn").onclick = () => openTx();
  $("#gear").onclick = () => { S.view = "altro"; render(); window.scrollTo(0, 0); };
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
  $$(".tabbar [data-v]").forEach(b => b.classList.toggle("on", b.dataset.v === (S.view === "scadenze" ? "home" : S.view)));
  const withMonth = ["home", "movimenti", "scadenze"].includes(S.view);
  $("#mnav").style.display = withMonth ? "" : "none";
  $("#gear").classList.toggle("on", S.view === "altro");
  $("#ttl").textContent = withMonth ? monthName(S.month).replace(/^./, c => c.toUpperCase()) : S.view === "famiglia" ? "Famiglia" : S.view === "spesa" ? "Lista della spesa" : "Impostazioni";
  $("#sub").innerHTML = `${esc(DB.hhName || "")} · ${statusLine()}`;
  ({ home: viewHome, movimenti: viewMovimenti, scadenze: viewScadenze, spesa: viewSpesa, famiglia: viewFamiglia, altro: viewAltro })[S.view]();
  keepAwake();
}

/* Schermo sempre acceso solo nella lista della spesa (Screen Wake Lock: l'iPhone non si spegne finché la lista è aperta;
   si rilascia da solo cambiando scheda, chiudendo l'app o dopo 45 minuti senza toccare nulla). */
let wakeLock = null, wakeTouched = Date.now();
function wakeWanted() { try { return localStorage.getItem("finanze-wake") !== "0"; } catch (e) { return true; } }
async function keepAwake() {
  const want = DB.session && S.view === "spesa" && wakeWanted() && document.visibilityState === "visible" && !$("#lock")
    && Date.now() - wakeTouched < 45 * 60000;
  if (want && !wakeLock && "wakeLock" in navigator) {
    try { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } catch (e) { wakeLock = null; }
  } else if (!want && wakeLock) { try { await wakeLock.release(); } catch (e) { } wakeLock = null; }
}
["touchstart", "click"].forEach(ev => document.addEventListener(ev, () => { wakeTouched = Date.now(); if (S.view === "spesa" && !wakeLock) keepAwake(); }, { passive: true }));
setInterval(keepAwake, 60000);
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
  const up = recurringView(S.month).filter(r => r.status === "attiva" && r.next_due && r.next_due <= in30)
    .concat(autoDeadlines().filter(x => x.due <= in30).map(x => ({ name: `${x.label} ${x.vehicle}`, next_due: x.due, amount: null, auto: true, tag: "auto" })))
    .concat(tripDeadlines().filter(x => x.due <= in30).map(x => ({ name: `${x.label}, ${x.trip}`, next_due: x.due, amount: null, auto: true, tag: "vacanza" })))
    .concat(familyDeadlines().filter(x => x.due <= in30).map(x => ({ name: x.person !== "Famiglia" ? `${x.label}, ${x.person}` : x.label, next_due: x.due, amount: null, auto: true, tag: "famiglia" })))
    .sort((a, b) => a.next_due.localeCompare(b.next_due)).slice(0, 7);
  const acc = balances(); const tot = acc.reduce((s, a) => s + a.balance, 0);
  const sumIO = Math.max(d.income, d.expense) || 1;
  const dl = autoDeadlines();
  $("#view").innerHTML = `
    ${dl.filter(x => x.level).map(x => `<div class="card alert ${x.level === "30" ? "wait" : "late"}"><b>${esc(x.label)} ${esc(x.vehicle)}</b>
      ${x.days < 0 ? `scaduto il ${shortDate(x.due)}` : x.days === 0 ? "scade oggi" : `scade il ${shortDate(x.due)}, tra ${x.days} ${x.days === 1 ? "giorno" : "giorni"}`}</div>`).join("")}
    ${familyDeadlines().filter(x => x.level).map(x => `<div class="card alert ${x.level === "30" ? "wait" : "late"}" data-gofam><b>${esc(x.label)}${x.person !== "Famiglia" ? " di " + esc(x.person) : ""}</b>
      ${x.days < 0 ? `scaduto il ${shortDate(x.due)}` : x.days === 0 ? "scade oggi" : `scade il ${shortDate(x.due)}, tra ${x.days} ${x.days === 1 ? "giorno" : "giorni"}`}</div>`).join("")}
    ${tripsView().filter(t => t.state === "in corso").map(t => `<div class="card alert ok" data-gotrip="${t.id}" style="border-left:5px solid ${t.color}"><b>In vacanza: ${esc(t.name)}</b>
      ${eur(t.spent)} spesi${t.budget ? ` di ${eur(t.budget)}` : ""}${t.per_day ? `, ${eur(t.per_day)} al giorno` : ""} ›</div>`).join("")}
    ${tripDeadlines().filter(x => x.level).map(x => `<div class="card alert ${x.level === "30" ? "wait" : "late"}" data-gotrip="${x.trip_id}"><b>${esc(x.label)}</b> per ${esc(x.trip)}: entro il ${shortDate(x.due)}${x.days > 0 ? `, tra ${x.days} ${x.days === 1 ? "giorno" : "giorni"}` : ""}</div>`).join("")}
    <div class="card hbars"><div class="hb-h"><b>${intro}</b>${d.income ? `<span class="muted">${saved >= 0 ? Math.round(saved / d.income * 100) + "% messo da parte" : "spese oltre le entrate"}</span>` : ""}</div>
      ${[["Entrate", d.income, "var(--in)"], ["Spese", d.expense, "var(--out)"], [saved >= 0 ? "Messo da parte" : "In meno", Math.abs(saved), saved >= 0 ? "var(--accent)" : "var(--out)"]]
        .map(([l, v, c]) => `<div class="hb-row"><span class="hb-l">${l}</span><div class="hb-track"><div style="width:${Math.max(v ? 2 : 0, v / sumIO * 100)}%;background:${c}"></div></div><b class="num">${eur(v)}</b></div>`).join("")}
    </div>
    ${S.month === thisMonth() ? homeKmCard() : ""}
    ${S.month === thisMonth() && new Date().getDate() <= 10 && !S.sumSeen ? homeSummaryCard() : ""}
    ${homeForecastCard()}
    ${homeGoalsCard()}

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
        ${r.next_due < todayIso() ? `<span class="badge late">${r.auto ? "Scaduta" : "Non trovata"}</span>` : ""}${r.auto ? `<span class="badge wait">${r.tag}</span>` : `<b class="num">${eur(r.amount)}</b>`}</div>`).join("")
        : `<p class="muted">Nessuna scadenza nei prossimi 30 giorni.</p>`}
      <button class="btn link" id="all-dl">Tutte le scadenze ›</button>
    </div>

    <div class="card"><h2>Conti</h2>${acc.map(a => `<div class="row acc-w" data-acc="${a.id}"><span class="n">${esc(a.name)}</span><b class="num ${a.balance < 0 ? "out" : ""}">${eur(a.balance)}</b>${canEdit() ? '<span class="muted" style="margin-left:8px">›</span>' : ""}</div>`).join("")}
      <div class="row"><span class="n muted">Totale</span><b class="num">${eur(tot)}</b></div>
      ${fundAccount() ? `<div class="row"><span class="n muted">di cui fondo lavoro (soldi dell'azienda)</span><span class="num muted">${eur(fundAvailable())}</span></div>` : ""}</div>

    <div class="card"><h2>Ultimi movimenti</h2>${d.tx.length ? `<div class="list">${d.tx.slice(0, 5).map(txRow).join("")}</div>
      <button class="btn link" id="all-tx">Tutti i movimenti</button>` : `<p class="muted">Nessun movimento.</p>`}</div>`;
  $$("[data-gofam]").forEach(el => el.onclick = () => { S.view = "famiglia"; S.famTab = "scadenze"; render(); window.scrollTo(0, 0); });
  if ($("#fc-open")) $("#fc-open").onclick = openForecast;
  bindHomeKm();
  if ($("#sum-hide")) $("#sum-hide").onclick = e => { e.stopPropagation(); S.sumSeen = true; render(); };
  if (canEdit()) $$("[data-acc]").forEach(el => el.onclick = () => openBalanceW(el.dataset.acc));
  $$("[data-goal]").forEach(el => el.onclick = () => openGoalW(el.dataset.goal));
  if ($("#g-new")) $("#g-new").onclick = () => openGoalEditW();
  $("#all-dl").onclick = () => { S.view = "scadenze"; render(); window.scrollTo(0, 0); };
  $$("[data-gotrip]").forEach(el => el.onclick = () => { S.view = "famiglia"; S.famTab = "vacanze"; render(); openTripDetail(el.dataset.gotrip); });
  if ($("#all-tx")) $("#all-tx").onclick = () => { S.view = "movimenti"; render(); window.scrollTo(0, 0); };
  bindTxRows(d.tx);
}

/* ==========================================================================
   Previsione e obiettivi (Riepilogo)
   ========================================================================== */
function homeSummaryCard() {
  const m = monthSummary(); if (!m.highlights.length) return "";
  return `<div class="card sum-w"><div class="row" style="padding:0;border:0"><h2 class="n" style="margin:0">Com'è andato ${MESI[+m.month.slice(5) - 1]}</h2>
    <button class="btn link" id="sum-hide">Nascondi</button></div><ul>${m.highlights.map(h => `<li>${esc(h)}</li>`).join("")}</ul></div>`;
}
function homeForecastCard() {
  if (S.month !== thisMonth()) return "";
  const f = forecast(), m = f.months[0]; if (!m) return "";
  const low = m.end < f.settings.threshold;
  return `<div class="card fc-w ${low ? "low" : ""}" id="fc-open"><div class="row" style="padding:0;border:0"><span class="n"><span class="muted" style="font-size:13px">Previsto a fine ${MESI[+m.month.slice(5) - 1]}</span><br>
      <b class="num" style="font-size:24px">${eur(m.end)}</b></span><span class="muted">›</span></div>
    <div class="muted" style="font-size:12px;margin-top:4px">Oggi ${eur(f.balance)}${f.months[1] ? ` · fine ${MESI[+f.months[1].month.slice(5) - 1]} ${eur(f.months[1].end)}` : ""}</div>
    ${f.warning ? `<div class="badge late" style="margin-top:8px">Sotto i ${eur(f.settings.threshold)} a fine ${MESI[+f.warning.month.slice(5) - 1]}</div>` : ""}</div>`;
}
function openForecast() {
  const f = forecast();
  openSheet("Previsione", `
    <div class="card"><div class="muted" style="font-size:13px">Oggi sui conti (${f.accounts.map(a => esc(a.name)).join(", ")})</div><b class="num" style="font-size:24px">${eur(f.balance)}</b></div>
    ${f.months.map((m, i) => `<div class="card"><h2>${i === 0 ? "Resto di " : ""}${MESI[+m.month.slice(5) - 1]} ${m.month.slice(0, 4)}</h2>
      <div class="row"><span class="n">Partenza</span><b class="num">${eur(m.start)}</b></div>
      ${m.income_recurring ? `<div class="row"><span class="n">Entrate ricorrenti</span><b class="num in">+${eur(m.income_recurring)}</b></div>` : ""}
      <div class="row"><span class="n">Entrate abituali</span><b class="num in">+${eur(m.income_usual)}</b></div>
      <div class="row"><span class="n">Spese fisse e scadenze</span><b class="num out">−${eur(m.fixed)}</b></div>
      <div class="row"><span class="n">Spese di tutti i giorni<br><span class="muted" style="font-size:12px">${m.days} gg × ${eur(f.daily)}</span></span><b class="num out">−${eur(m.variable)}</b></div>
      <div class="row"><span class="n"><b>Previsto a fine mese</b></span><b class="num ${m.end < f.settings.threshold ? "out" : ""}">${eur(m.end)}</b></div>
      ${f.goals_monthly ? `<p class="hint">Dopo aver messo da parte per gli obiettivi: ${eur(m.after_goals)}</p>` : ""}
      ${m.items.length ? `<details ${i === 0 ? "open" : ""}><summary>${m.items.length} voci in calendario</summary>${m.items.map(x => `<div class="row"><span class="muted num" style="width:50px">${shortDate(x.date)}</span>
        <span class="n">${esc(x.name)}${x.late ? ' <span class="badge late">in ritardo</span>' : ""}</span><b class="num ${x.amount > 0 ? "in" : ""}">${x.amount == null ? "?" : (x.amount > 0 ? "+" : "−") + eur(Math.abs(x.amount))}</b></div>`).join("")}</details>` : ""}</div>`).join("")}
    <p class="hint">Stima: saldo di oggi, più entrate ricorrenti e abituali, meno spese fisse, scadenze e la media delle spese di tutti i giorni (ultimi ${f.span_days} giorni). Soglia e periodo si cambiano dal Mac.</p>`);
}
function homeGoalsCard() {
  const g = goalsView(), act = g.goals.filter(x => x.status === "attivo");
  if (!act.length && !canEdit()) return "";
  return `<div class="card"><h2>Obiettivi</h2>
    ${act.map(x => `<div class="goal-w" data-goal="${x.id}"><div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:5px"><span>${esc(x.name)}</span>
      <span class="num muted">${eur(x.saved)} di ${eur(x.target)}</span></div>
      <div class="bar"><div style="width:${x.pct}%;background:${x.color}"></div></div>
      <div class="muted" style="font-size:12px;margin-top:4px">${x.late ? `<span class="out">scadenza passata</span>` : x.monthly ? `${eur(x.monthly)} al mese · entro ${shortDate(x.due_date)} ${x.due_date.slice(0, 4)}` : x.left ? `mancano ${eur(x.left)}` : ""}</div></div>`).join("")
      || `<p class="hint">Fondo emergenze, auto nuova, una vacanza: segna cifra e data e ti dico quanto mettere da parte ogni mese.</p>`}
    ${canEdit() ? `<button class="btn link" id="g-new">+ Nuovo obiettivo</button>` : ""}</div>`;
}
function openGoalW(id) {
  const g = goalsView().goals.find(x => x.id === id); if (!g) return;
  const { sheet } = openSheet(g.name, `
    <div class="card" style="text-align:center"><b class="num" style="font-size:28px">${eur(g.saved)}</b><div class="muted">di ${eur(g.target)} · ${Math.round(g.pct)}%</div>
      <div class="bar" style="margin:12px 0 6px"><div style="width:${g.pct}%;background:${g.color}"></div></div>
      <div class="muted" style="font-size:13px">${g.status === "raggiunto" ? "Obiettivo raggiunto 🎉" : g.late ? "Scadenza passata" : g.monthly ? `Servono ${eur(g.monthly)} al mese per ${g.months_left} ${g.months_left === 1 ? "mese" : "mesi"}` : ""}</div></div>
    ${canEdit() && g.status === "attivo" ? `<input class="amount num" id="gw-a" inputmode="decimal" placeholder="0,00" value="${g.monthly ? amountText(g.monthly) : ""}" aria-label="Importo"><div class="amount-line">euro</div>
      <label class="f"><span>Nota (facoltativa)</span><input type="text" id="gw-n"></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px"><button class="btn primary" id="gw-in">Metti da parte</button><button class="btn" id="gw-out">Preleva</button></div>` : ""}
    ${g.moves.length ? `<div class="card"><h2>Movimenti</h2>${g.moves.slice(0, 30).map(m => `<div class="row"><span class="muted num" style="width:50px">${shortDate(m.occurred_on)}</span>
      <span class="n">${esc(m.note || (m.amount > 0 ? "Messo da parte" : "Prelevato"))}<br><span class="muted" style="font-size:12px">${esc(m.updated_by || "")}</span></span>
      <b class="num ${m.amount > 0 ? "in" : "out"}">${m.amount > 0 ? "+" : "−"}${eur(Math.abs(m.amount))}</b>${canEdit() ? `<button class="btn link" data-gd="${m.id}" style="margin-left:8px">✕</button>` : ""}</div>`).join("")}</div>` : ""}
    ${canEdit() ? `<button class="btn wide" id="gw-edit">Modifica obiettivo</button>` : ""}`);
  const reopen = msg => { sheet.remove(); if (msg) toast(msg); openGoalW(id); };
  const move = w => { try { const r = addGoalMove(id, $("#gw-a").value, $("#gw-n").value, w); reopen(r ? `Obiettivo raggiunto! 🎉` : w ? "Prelevato" : "Messo da parte"); } catch (e) { $("#se", sheet).textContent = e.message; } };
  if ($("#gw-in", sheet)) { $("#gw-in", sheet).onclick = () => move(false); $("#gw-out", sheet).onclick = () => move(true); }
  $$("[data-gd]", sheet).forEach(b => b.onclick = () => { if (confirm("Eliminare questo movimento?")) { deleteGoalMove(b.dataset.gd); reopen(); } });
  if ($("#gw-edit", sheet)) $("#gw-edit", sheet).onclick = () => { sheet.remove(); openGoalEditW(DB.t.goals[id]); };
}
function openGoalEditW(g) {
  g = g || { status: "attivo" };
  openSheet(g.id ? "Modifica obiettivo" : "Nuovo obiettivo", `
    <label class="f"><span>Nome</span><input type="text" id="ge-n" value="${esc(g.name)}" placeholder="Es. Fondo emergenze"></label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><label class="f"><span>Cifra (€)</span><input type="text" inputmode="decimal" id="ge-t" value="${g.target ? esc(amountText(g.target)) : ""}"></label>
      <label class="f"><span>Entro il</span><input type="date" id="ge-d" value="${esc(g.due_date || "")}"></label></div>
    ${g.id ? `<label class="f"><span>Stato</span></label><div class="seg" id="ge-s" style="margin-bottom:14px">${[["attivo", "Attivo"], ["raggiunto", "Raggiunto"], ["archiviato", "Archiviato"]].map(([k, l]) => `<button data-s="${k}">${l}</button>`).join("")}</div>`
      : `<label class="f"><span>Già messi da parte (facoltativo)</span><input type="text" inputmode="decimal" id="ge-a" placeholder="0,00"></label>`}
    <label class="f"><span>Note</span><input type="text" id="ge-no" value="${esc(g.notes)}"></label>
    <p class="hint">I versamenti tengono il conto di quanto è già da parte: non spostano soldi tra i conti.</p>`,
    () => { const r = saveGoal({ id: g.id, name: $("#ge-n").value, target: $("#ge-t").value, due_date: $("#ge-d").value, status: st, notes: $("#ge-no").value, start_amount: $("#ge-a") ? $("#ge-a").value : null });
      setTimeout(() => openGoalW(r.id), 0); return "Salvato"; },
    g.id ? { del: { label: "Elimina obiettivo", confirm: `Eliminare «${g.name}» e i suoi movimenti?`, run: () => { deleteGoal(g.id); return "Eliminato"; } } } : {});
  let st = g.status;
  $$("#ge-s button").forEach(b => { b.classList.toggle("on", b.dataset.s === st); b.onclick = () => { st = b.dataset.s; $$("#ge-s button").forEach(x => x.classList.toggle("on", x === b)); }; });
  if (!g.id) setTimeout(() => $("#ge-n").focus(), 250);
}

function openBalanceW(id) {
  const a = balances().find(x => x.id === id); if (!a) return;
  const cash = a.type === "contanti";
  openSheet(a.name, `
    <p class="hint">${cash ? "Quanti contanti avete adesso?" : "Scrivi il saldo disponibile che vedi oggi sull'app della banca."} Lo allineo correggendo il saldo iniziale, senza creare movimenti finti.</p>
    <div class="card"><div class="muted" style="font-size:13px">Secondo l'app</div><b class="num" style="font-size:22px">${eur(a.balance)}</b></div>
    <input class="amount num" id="bw-v" inputmode="decimal" placeholder="0,00" autocomplete="off" aria-label="Saldo di oggi"><div class="amount-line">${cash ? "contanti contati" : "saldo in banca oggi"}</div>
    <p class="hint" id="bw-d"></p>`,
    () => { const d = setAccountBalance(id, $("#bw-v").value); return d ? `Allineato (correzione di ${eur(d)})` : "Coincideva già"; }, { saveLabel: "Allinea" });
  setTimeout(() => $("#bw-v").focus(), 250);
  $("#bw-v").oninput = () => { const v = parseAmount($("#bw-v").value); if (v == null || isNaN(v)) { $("#bw-d").textContent = ""; return; }
    const d = round2(v - a.balance); $("#bw-d").textContent = d === 0 ? "Coincide." : `Differenza: ${d > 0 ? "+" : "−"}${eur(Math.abs(d))}`; };
}

/* ==========================================================================
   Km dell'auto aziendale
   ========================================================================== */
const GIORNI_L = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const dayLabel = iso => { const d = new Date(iso + "T12:00:00"); return `${GIORNI_L[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()]}`; };
const fmtKm = v => v == null ? "—" : new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(v);
function lastSunday() { const t = todayIso(), d = new Date(t + "T12:00:00").getDay(); return d === 0 ? t : addDays(t, -d); }
function homeKmCard() {
  if (!kmMine() || (!rows("work_km").length && !canEdit())) return "";
  const t = todayIso(), dow = new Date(t + "T12:00:00").getDay(), rs = kmRows();
  const todayE = rs.find(r => r.day === t && r.kind === "giorno"), sun = lastSunday();
  const weNeeded = (dow === 0 || dow === 1) && !rs.some(r => r.day === sun && r.kind === "weekend") && rs.length;
  const wk = kmWeek(mondayOf(t)), miss = wk.days.filter(x => x.missing && x.day < t).length;
  const work = dow >= 1 && dow <= 5;
  const main = weNeeded ? `<button class="btn ${dow === 0 ? "primary" : ""} sm" id="km-we">Km weekend</button>`
    : work ? (todayE ? `<button class="btn sm" id="km-today">Oggi ${fmtKm(todayE.day_km)} km ✓</button>` : `<button class="btn primary sm" id="km-today">Km di oggi</button>`)
    : `<button class="btn sm" id="km-today">Segna km</button>`;
  return `<div class="card km-w km-mini"><div class="km-head"><b>Km lavoro</b>
      <span class="muted">sett. ${fmtKm(wk.km)} km${miss ? ` · <span class="out">${miss} da fare</span>` : ""}</span>
      <button class="btn link sm" id="km-week">Settimana ›</button></div>
    <div class="km-btns">${main}${canEdit() ? `<button class="btn sm" id="km-fuel">+ Carburante</button>` : ""}</div></div>`;
}
function bindHomeKm() {
  if ($("#km-today")) $("#km-today").onclick = () => openKm("giorno");
  if ($("#km-we")) $("#km-we").onclick = () => openKm("weekend");
  if ($("#km-week")) $("#km-week").onclick = () => openKmWeek(mondayOf(todayIso()));
  if ($("#km-fuel")) $("#km-fuel").onclick = () => openFuel();
}
function tagField(id, label, values, suggestions, placeholder) {
  return `<label class="f"><span>${label}</span></label><div class="tags" id="${id}">${values.map(v => `<button type="button" class="tag" data-v="${esc(v)}">${esc(v)} ✕</button>`).join("")}
    <input type="text" list="${id}-l" placeholder="${placeholder}" autocomplete="off" enterkeyhint="next"></div>
    <datalist id="${id}-l">${suggestions.map(v => `<option value="${esc(v)}">`).join("")}</datalist>`;
}
function bindTags(root, id) {
  const box = $("#" + id, root), inp = $("input", box);
  const add = () => { kmSplit(inp.value).forEach(v => { if (![...$$(".tag", box)].some(t => t.dataset.v.toLowerCase() === v.toLowerCase()))
      inp.insertAdjacentHTML("beforebegin", `<button type="button" class="tag" data-v="${esc(v)}">${esc(v)} ✕</button>`); }); inp.value = ""; bind(); };
  const bind = () => $$(".tag", box).forEach(t => t.onclick = () => { t.remove(); });
  inp.onkeydown = e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } };
  inp.onchange = add; bind();
  return () => { add(); return $$(".tag", box).map(t => t.dataset.v); };
}
function openKm(kind, day, entry) {
  kind = kind || "giorno";
  const s = kmSettings(), rs = kmRows();
  day = day || (kind === "weekend" ? lastSunday() : todayIso());
  const e = entry || rs.find(r => r.day === day && r.kind === kind) || null;
  const prev = rs.filter(r => r.odometer != null && (r.day < day || (r.day === day && kind === "weekend" && r.kind === "giorno"))).pop();
  const lastDay = rs.filter(r => r.kind === "giorno" && r.day < day).pop();
  const sug = kmSuggestions(), cars = [...new Set((s.cars || []).map(c => c.name))];
  const { sheet } = openSheet(kind === "weekend" ? "Km del weekend" : "Km di lavoro", `
    <label class="f"><span>${kind === "weekend" ? "Domenica" : "Giorno"}</span><input type="date" id="km-d" value="${day}"></label>
    <input class="amount num" id="km-o" inputmode="decimal" placeholder="contachilometri" value="${e && e.odometer != null ? esc(String(e.odometer).replace(".", ",")) : ""}" autocomplete="off" aria-label="Contachilometri">
    <div class="amount-line" id="km-hint">${prev ? `ultima lettura ${fmtKm(prev.odometer)} · ${dayLabel(prev.day)}` : "km del contachilometri"}</div>
    ${kind === "weekend" ? `<p class="hint">Scrivi il contachilometri di domenica sera (o di lunedì mattina, prima di partire). I km del fine settimana non entrano nei km di lavoro.</p>` : `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="f"><span>Da</span><input type="text" id="km-da" value="${esc(e ? e.da : s.da)}"></label>
        <label class="f"><span>Auto</span><select id="km-car">${(cars.includes(carOn(s, day)) ? cars : cars.concat(carOn(s, day))).map(c => `<option ${c === (e ? e.car : carOn(s, day)) ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label></div>
      ${lastDay && !e ? `<button class="btn link" id="km-copy" style="margin:-4px 0 6px">Copia paesi e clienti di ${dayLabel(lastDay.day)}</button>` : ""}
      <div id="km-tags">${tagField("km-a", "A (paesi visitati)", kmSplit(e && e.a), sug.places, "Scrivi un paese e premi Invio")}
      ${tagField("km-c", "Clienti", kmSplit(e && e.clients), sug.clients, "Scrivi un cliente e premi Invio")}</div>
      <details style="margin-top:6px"><summary>Non hai il contachilometri? Scrivi i km del giorno</summary>
        <label class="f" style="margin-top:8px"><span>Km del giorno</span><input type="text" inputmode="decimal" id="km-k" value="${e && e.km != null ? esc(String(e.km).replace(".", ",")) : ""}"></label></details>`}`,
    async () => {
      const r = await saveKm({ kind, day: $("#km-d").value, odometer: $("#km-o").value, km: $("#km-k") ? $("#km-k").value : null,
        da: $("#km-da") ? $("#km-da").value : null, car: $("#km-car") ? $("#km-car").value : null,
        a: getA ? getA().join(", ") : null, clients: getC ? getC().join(", ") : null });
      if (r.warning) alert(r.warning);
      return "Km salvati";
    },
    e ? { del: { label: "Elimina", confirm: "Eliminare questa giornata?", run: () => { deleteKm(e.id); return "Eliminata"; } } } : {});
  let getA = null, getC = null;
  if (kind === "giorno") { getA = bindTags(sheet, "km-a"); getC = bindTags(sheet, "km-c"); }
  const hint = () => { const v = parseAmount($("#km-o", sheet).value); if (prev && v && !isNaN(v)) $("#km-hint", sheet).textContent = `= ${fmtKm(round1(v - prev.odometer))} km ${kind === "weekend" ? "nel fine settimana" : "oggi"} · ultima lettura ${fmtKm(prev.odometer)}`; };
  $("#km-o", sheet).oninput = hint; hint();
  if ($("#km-copy", sheet)) $("#km-copy", sheet).onclick = () => {
    $("#km-tags", sheet).innerHTML = tagField("km-a", "A (paesi visitati)", kmSplit(lastDay.a), sug.places, "Scrivi un paese e premi Invio") + tagField("km-c", "Clienti", kmSplit(lastDay.clients), sug.clients, "Scrivi un cliente e premi Invio");
    getA = bindTags(sheet, "km-a"); getC = bindTags(sheet, "km-c"); $("#km-copy", sheet).remove();
  };
  $("#km-d", sheet).onchange = () => { sheet.remove(); document.body.style.overflow = ""; openKm(kind, $("#km-d", sheet).value); };
  if (!e) setTimeout(() => $("#km-o", sheet).focus(), 250);
}
function openFuel(f, back) {
  const { sheet } = openSheet(f ? "Rifornimento" : "Carburante carta aziendale", `
    <input class="amount num" id="fu-a" inputmode="decimal" placeholder="0,00" autocomplete="off" aria-label="Importo" value="${f ? Number(f.amount).toFixed(2).replace(".", ",") : ""}">
    <div class="amount-line">pagato con la carta carburante dell'azienda</div>
    <label class="f"><span>Giorno del rifornimento</span><input type="date" id="fu-d" value="${f ? f.day : todayIso()}"></label>
    <p class="hint">Va nella riga «Carburante card aziendale» della nota spese, nel giorno indicato. Non è una spesa vostra e non tocca i conti.</p>`,
    () => { saveFuel({ id: f && f.id, amount: $("#fu-a").value, day: $("#fu-d").value }); if (back) setTimeout(back, 50); return "Rifornimento salvato"; },
    f ? { del: { label: "Elimina", confirm: "Eliminare questo rifornimento?", run: () => { deleteFuel(f.id); if (back) setTimeout(back, 50); return "Eliminato"; } } } : {});
  if (!f) setTimeout(() => $("#fu-a", sheet).focus(), 250);
}
function openNotaSpese(month) {
  const cur = todayIso().slice(0, 7), months = [0, 1, 2].map(i => shiftMonth(cur, -i));
  if (!months.includes(month)) month = cur;
  const canShareFiles = !!(navigator.canShare && window.File && navigator.canShare({ files: [new File([""], "x.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })] }));
  const info = m => { const d = notaSpeseData(m), fuel = fuelList().filter(f => f.day.slice(0, 7) === m).reduce((a, f) => a + f.amount, 0);
    return `<div class="pw-stats"><div><span>Settimane</span><b class="num">${d.sheets.map(x => x[0]).join(", ") || "—"}</b></div>
      <div><span>Km di lavoro</span><b class="num">${fmtKm(d.totalKm)}</b></div><div><span>Carburante carta</span><b class="num">${eur(fuel)}</b></div></div>
      ${d.missing.length ? `<p class="out" style="font-size:13px;margin:10px 0 0">Mancano i km di ${d.missing.length} ${d.missing.length === 1 ? "giorno" : "giorni"}: ${d.missing.map(x => shortDate(x)).join(", ")}</p>` : ""}`; };
  const { sheet } = openSheet("Nota spese Excel", `
    <label class="f"><span>Mese</span><select id="ns-m">${months.map(m => `<option value="${m}" ${m === month ? "selected" : ""}>${monthName(m).replace(/^./, c => c.toUpperCase())}</option>`).join("")}</select></label>
    <div class="card" id="ns-info">${info(month)}</div>
    <p class="hint">Lo stesso file che crea il Mac: un foglio per settimana con km, paesi, clienti, spese del Fondo lavoro e carburante della carta aziendale.
      ${canShareFiles ? "Tocca «Invia per email», scegli <b>Mail</b> e scrivi il tuo indirizzo aziendale: il file è già allegato." : ""}</p>
    ${!nsTemplate() ? `<p class="err">Manca il modello: apri il programma sul Mac e vai in «Km e nota spese», poi riprova qui dopo la sincronizzazione.</p>` : ""}
    <button class="btn primary wide" id="ns-send">${canShareFiles ? "Invia per email" : "Scarica il file"}</button>
    ${canShareFiles ? `<button class="btn wide" id="ns-dl" style="margin-top:8px">Salva in File</button>` : ""}`);
  // il file si prepara subito: Safari apre la condivisione solo se parte direttamente dal tocco, senza attese
  let ready = null, gen = 0;
  const prepare = () => { const my = ++gen, m = $("#ns-m", sheet).value; ready = null; $("#se", sheet).textContent = "";
    $$("#ns-send, #ns-dl", sheet).forEach(b => { b.disabled = true; b.dataset.l = b.dataset.l || b.textContent; b.textContent = "Preparo il file…"; });
    buildNotaSpese(m).then(r => { if (my === gen) ready = r; }).catch(e => { if (my === gen) $("#se", sheet).textContent = e.message; })
      .finally(() => { if (my === gen) $$("#ns-send, #ns-dl", sheet).forEach(b => { b.disabled = !ready; b.textContent = b.dataset.l; }); }); };
  $("#ns-m", sheet).onchange = () => { $("#ns-info", sheet).innerHTML = info($("#ns-m", sheet).value); prepare(); };
  const download = r => { const a = document.createElement("a"); a.href = URL.createObjectURL(r.blob); a.download = r.fileName;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); };
  $("#ns-send", sheet).onclick = () => { const r = ready; if (!r) return;
    if (!canShareFiles) return download(r);
    const f = new File([r.blob], r.fileName, { type: r.blob.type });
    navigator.share({ files: [f], title: r.fileName, text: `Nota spese ${monthName($("#ns-m", sheet).value)} – ${r.name}` })
      .catch(err => { if (err.name !== "AbortError") $("#se", sheet).textContent = "Non riesco ad aprire la condivisione: " + err.message; }); };
  if ($("#ns-dl", sheet)) $("#ns-dl", sheet).onclick = () => ready && download(ready);
  if (nsTemplate()) prepare(); else $$("#ns-send, #ns-dl", sheet).forEach(b => b.disabled = true);
}
function openKmWeek(mon) {
  const w = kmWeek(mon), sun = addDays(mon, 6), fuel = fuelList().filter(f => f.day >= mon && f.day <= sun);
  const { sheet } = openSheet(`Settimana ${shortDate(mon)} – ${shortDate(sun)}`, `
    <div class="seg" style="margin-bottom:12px"><button id="kw-prev">‹ Precedente</button><button id="kw-next" ${addDays(mon, 7) > todayIso() ? "disabled" : ""}>Successiva ›</button></div>
    <div class="card"><div class="pw-stats"><div><span>Km di lavoro</span><b class="num">${fmtKm(w.km)}</b></div>
      <div><span>Weekend</span><b class="num">${w.weekend ? fmtKm(w.weekend.private_km) : "—"}</b></div>
      <div><span>Contachilometri dom.</span><b class="num">${w.weekend ? fmtKm(w.weekend.odometer) : "—"}</b></div></div></div>
    <div class="card">${w.days.map(x => `<div class="row km-day" data-d="${x.day}"><span class="n"><b>${dayLabel(x.day)}</b><br>
      <span class="muted" style="font-size:12px">${x.entry ? `${esc(x.entry.a || "—")}${x.entry.clients ? " · " + esc(x.entry.clients) : ""}` : x.missing ? '<span class="out">da completare</span>' : "—"}</span></span>
      <b class="num">${x.entry ? fmtKm(x.entry.day_km) + " km" : ""}</b><span class="muted" style="margin-left:6px">›</span></div>`).join("")}
      <div class="row km-day" data-we="1"><span class="n"><b>Weekend</b><br><span class="muted" style="font-size:12px">${w.weekend ? `contachilometri ${fmtKm(w.weekend.odometer)}` : sun < todayIso() ? '<span class="out">da completare</span>' : "domenica sera"}</span></span>
        <b class="num">${w.weekend ? fmtKm(w.weekend.private_km) + " km" : ""}</b><span class="muted" style="margin-left:6px">›</span></div></div>
    ${fuel.length || canEdit() ? `<div class="card"><h2>⛽ Carburante carta aziendale</h2>${fuel.map(f => `<div class="row fu-it" data-fu="${f.id}"><span class="n">${dayLabel(f.day)}</span>
      <b class="num">${eur(f.amount)}</b><span class="muted" style="margin-left:6px">›</span></div>`).join("") || `<p class="muted" style="margin:0">Nessun rifornimento questa settimana.</p>`}
      ${canEdit() ? `<button class="btn link" id="kw-fuel" style="margin-top:6px">+ Aggiungi rifornimento</button>` : ""}</div>` : ""}
    <button class="btn primary wide" id="kw-xls" style="margin-top:4px">📎 Nota spese Excel</button>`);
  $$(".km-day", sheet).forEach(el => el.onclick = () => { if (!canEdit()) return; sheet.remove(); el.dataset.we ? openKm("weekend", sun) : openKm("giorno", el.dataset.d); });
  $("#kw-xls", sheet).onclick = () => { sheet.remove(); openNotaSpese(addDays(mon, 3).slice(0, 7)); };
  const back = () => openKmWeek(mon);
  $$(".fu-it", sheet).forEach(el => el.onclick = () => { if (!canEdit()) return; sheet.remove(); openFuel(fuel.find(f => f.id === el.dataset.fu), back); });
  if ($("#kw-fuel", sheet)) $("#kw-fuel", sheet).onclick = () => { sheet.remove(); openFuel(null, back); };
  $("#kw-prev", sheet).onclick = () => { sheet.remove(); openKmWeek(addDays(mon, -7)); };
  $("#kw-next", sheet).onclick = () => { sheet.remove(); openKmWeek(addDays(mon, 7)); };
}

/* ==========================================================================
   Movimenti
   ========================================================================== */
function txRow(t) {
  const wk = workKind(t);
  if (wk) return `<div class="tx" data-id="${t.id}"><div class="w"><div class="t">${esc(t.description || (wk === "spesa" ? "Spesa di lavoro" : "Fondo di lavoro"))}</div>
    <div class="s"><span class="chip" style="background:#6B5B9522"><span class="dot" style="background:#6B5B95;width:7px;height:7px"></span>${wk === "spesa" ? "Lavoro · fondo aziendale" : "Fondo aziendale"}</span>
    ${t.updated_by ? `<span>${esc(t.updated_by)}</span>` : ""}</div></div><div class="a num mv">${wk === "spesa" ? "−" : "+"}${eur(t.amount)}</div></div>`;
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
  const wkEdit = t ? workKind(t) : null, fund = fundAccount();
  if (wkEdit) { x.kind = wkEdit; x.account_id = wkEdit === "spesa" ? t.account_id : t.transfer_account_id; x.transfer_account_id = null; x.category_id = null; }
  let work = !!(wkEdit || (preset && preset.work));
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
    ${fund ? `<div class="work-w" id="xwork-w"><label><input type="checkbox" id="xwork" ${work ? "checked" : ""}> <span id="xwork-l"></span></label>
      <label id="xworkr-w" class="sub"><input type="checkbox" id="xworkr"> Ricorda questa descrizione come di lavoro</label></div>` : ""}
    <div id="xcats"></div>
    ${people().length ? `<div id="xper"></div>` : ""}
    ${trips().filter(v => v.status !== "annullata").length ? `<label class="f" id="xtrip-w"><span>Vacanza</span><select id="xtrip">
      ${edit ? "" : `<option value="auto">In base alle date</option>`}<option value="">Nessuna</option>
      ${trips().filter(v => v.status !== "annullata").sort((a, b) => String(b.start_date).localeCompare(String(a.start_date))).map(v => `<option value="${v.id}">${esc(v.name)}${v.status === "bozza" ? " (da decidere)" : ""}</option>`).join("")}</select></label>` : ""}
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
  const tripNow = edit ? (tripMap()[x.id] || "") : "auto";
  let per = txPeople(x), perTouched = edit;
  const drawPer = () => {
    if (!$("#xper")) return;
    if (kind !== "spesa") { $("#xper").innerHTML = ""; return; }
    $("#xper").innerHTML = `<label class="f" style="margin-bottom:4px"><span>Per chi (facoltativo${people().length > 1 ? ", anche più persone" : ""})</span></label>
      <div class="chips">${people().map(p => `<button data-per="${p.id}" class="${per.includes(p.id) ? "on" : ""}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</button>`).join("")}</div>
      ${per.length > 1 ? `<p class="hint" style="margin:-2px 0 10px">Divisa in parti uguali tra ${per.length} persone.</p>` : ""}`;
    $$("#xper [data-per]").forEach(b => b.onclick = () => { const id = b.dataset.per; per = per.includes(id) ? per.filter(x => x !== id) : per.concat(id); perTouched = true; drawPer(); });
  };
  const suggestPer = () => { if (perTouched || kind !== "spesa") return; const p = autoPerson({ description: $("#xd").value }); if (p.join() !== per.join()) { per = p; drawPer(); } };
  const setKind = k => {
    kind = k; $$("#xk button").forEach(b => b.classList.toggle("on", b.dataset.k === k));
    $("#xto-w").style.display = k === "trasferimento" ? "" : "none";
    $("#xacc-l").textContent = k === "trasferimento" ? "Dal conto" : "Conto";
    if (cat && catById(cat) && catById(cat).kind !== k) cat = null;
    if (k === "trasferimento" && $("#xto").value === $("#xacc").value && accs.length > 1) $("#xto").value = accs.find(a => a.id !== $("#xacc").value).id;
    drawCats(); suggest(); drawPer(); if ($("#xtrip-w")) $("#xtrip-w").style.display = k === "spesa" ? "" : "none";
    $("h2", sheet).textContent = edit ? "Movimento" : k === "spesa" ? "Nuova spesa" : k === "entrata" ? "Nuova entrata" : "Trasferimento";
  };
  const setWork = () => {
    if (!$("#xwork-w")) return;
    const can = kind !== "trasferimento"; work = can && $("#xwork").checked;
    $("#xwork-w").style.display = can ? "" : "none";
    $("#xwork-l").textContent = kind === "entrata" ? "Soldi dell'azienda (anticipo o rimborso del fondo)" : "Spesa di lavoro (fondo dell'azienda)";
    $("#xworkr-w").style.display = work && $("#xd").value.trim() ? "" : "none";
    ["#xcats", "#xper", "#xtrip-w", "#xs"].forEach(q => { if ($(q)) $(q).style.display = work ? "none" : (q === "#xtrip-w" && kind !== "spesa" ? "none" : ""); });
  };
  $$("#xk button").forEach(b => b.onclick = () => { setKind(b.dataset.k); setWork(); });
  setKind(kind);
  if ($("#xwork")) { $("#xwork").onchange = setWork; $("#xd").addEventListener("input", setWork); setWork(); }
  if ($("#xtrip")) $("#xtrip").value = tripNow;
  $("#xd").oninput = () => { suggest(); suggestPer(); };
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
        ...(kind === "spesa" && (perTouched && (edit ? per.join() !== txPeople(x).join() : per.length)) ? { person_ids: per } : {}),
        ...(edit && kind !== "spesa" && x.person_id ? { person_ids: [] } : {}),
        ...($("#xwork") && kind !== "trasferimento" ? { work, work_remember: $("#xworkr").checked } : {}),
        ...(x.recurring_id !== undefined && edit ? { recurring_id: x.recurring_id } : {}), ...(preset && preset.recurring_id ? { recurring_id: preset.recurring_id } : {}) });
      if (!work && $("#xtrip") && $("#xtrip").value !== tripNow && $("#xtrip").value !== "auto") setTxTrip(r.id, $("#xtrip").value || null);
      close();
      const rec = !edit && r.recurring_id && DB.t.recurrings[r.recurring_id];
      toast(work ? (edit ? "Movimento di lavoro aggiornato" : "Messo nel fondo di lavoro") : rec ? `Aggiunto e collegato a «${rec.name}»` : edit ? "Movimento aggiornato" : "Aggiunto");
      S.month = r.occurred_on.slice(0, 7); render();
    } catch (err) { $("#xe").textContent = err.message; }
  };
}

/* ==========================================================================
   Spesa
   ========================================================================== */
let shopSuggesting = false;
function viewSpesa() {
  if (!shopSuggesting) { shopSuggesting = true; shopSuggest().then(n => { shopSuggesting = false; if (n && S.view === "spesa" && !$("#sheet")) viewSpesa(); }); }
  const items = shopItems(), todo = items.filter(i => !i.checked_at).sort((a, b) => a.added_on.localeCompare(b.added_on) || String(a.updated_at).localeCompare(String(b.updated_at)));
  const cart = items.filter(i => i.checked_at).sort((a, b) => String(b.checked_at).localeCompare(String(a.checked_at)));
  const prodById = Object.fromEntries(products().map(p => [p.id, p]));
  const dep = i => (prodById[i.product_id] || {}).department || "Altro";
  const byDep = {}; todo.forEach(i => (byDep[dep(i)] = byDep[dep(i)] || []).push(i));
  const deps = SHOP_DEPARTMENTS.filter(d => byDep[d]).concat(Object.keys(byDep).filter(d => !SHOP_DEPARTMENTS.includes(d)));
  const st = productStats(), onList = new Set(todo.map(i => i.product_id));
  const soon = products().filter(p => +p.auto && !onList.has(p.id) && st[p.id].next_due && daysTo(st[p.id].next_due) <= 7)
    .map(p => ({ p, left: daysTo(st[p.id].next_due) })).sort((a, b) => a.left - b.left);
  const paused = shopParams().pause_on_trip && shopPaused();
  const wakeOk = "wakeLock" in navigator;
  $("#view").innerHTML = `
    <label class="wake-row"><span>☀︎ Schermo sempre acceso${wakeOk ? "" : `<br><span class="muted" style="font-size:12px">Serve iOS 18.4 o successivo</span>`}</span>
      <input type="checkbox" class="switch" id="sh-wake" ${wakeWanted() && wakeOk ? "checked" : ""} ${wakeOk ? "" : "disabled"}></label>
    ${paused ? `<div class="card alert wait">Siete in vacanza (${esc(paused.name)}): i suggerimenti automatici sono in pausa.</div>` : ""}
    ${canEdit() ? `<form class="shop-add" id="sa"><input type="text" id="sa-n" list="sa-l" placeholder="Scrivi un prodotto…" autocomplete="off" enterkeyhint="done">
      <button class="btn primary" aria-label="Aggiungi">+</button><datalist id="sa-l">${products().map(p => `<option value="${esc(p.name)}">`).join("")}</datalist></form>
      <button class="scan" id="sh-cat" style="margin-bottom:14px">Scegli dal catalogo (${products().length} prodotti)</button>` : ""}
    ${todo.length ? deps.map(d => `<div class="shop-dep">${esc(d)}</div><div class="card shop-card">${byDep[d].map(i => `<div class="shop-it" data-chk="${i.id}">
        <span class="box"></span><span class="n">${esc(i.name)}${i.qty ? ` <span class="muted">· ${esc(i.qty)}</span>` : ""}${i.source === "suggerito" ? ` <span class="badge wait">suggerito</span>` : ""}</span>
        ${canEdit() ? (i.source === "suggerito" ? `<button class="btn link" data-snz="${i.id}">Ne ho ancora</button>` : `<button class="btn link muted" data-rm="${i.id}" aria-label="Togli">✕</button>`) : ""}</div>`).join("")}</div>`).join("")
      : cart.length ? `<div class="empty">Tutto nel carrello!</div>` : `<div class="card shop-help"><h2>Come funziona</h2><ol>
        <li><b>Aggiungi</b> i prodotti dal catalogo qui sopra, oppure scrivili. Se un prodotto non c'è, lo metto nel catalogo per la volta dopo.</li>
        <li><b>Al supermercato</b> tocca un prodotto quando lo metti nel carrello.</li>
        <li><b>Alla cassa</b> tocca «Ho finito».</li>
        <li>Dopo 3 acquisti imparo ogni quanto lo comprate e lo rimetto in lista da solo, con l'etichetta <span class="badge wait">suggerito</span>.</li></ol></div>`}
    ${cart.length ? `<div class="shop-dep">Nel carrello (${cart.length})</div><div class="card shop-card">${cart.map(i => `<div class="shop-it done" data-unchk="${i.id}">
        <span class="box"></span><span class="n">${esc(i.name)}</span></div>`).join("")}</div>
      ${canEdit() ? `<button class="btn primary wide" id="sh-done" style="margin-bottom:16px">Ho finito</button>` : ""}` : ""}
    ${soon.length ? `<div class="card"><h2>In arrivo</h2>${soon.map(({ p, left }) => `<div class="row"><span class="n">${esc(p.name)}<br>
      <span class="muted" style="font-size:12px">ogni ${st[p.id].interval} gg · ${left <= 0 ? "dovrebbe essere finito" : left === 1 ? "domani" : "tra " + left + " giorni"}</span></span>
      ${canEdit() ? `<button class="btn" data-now="${p.id}" style="padding:6px 14px">+</button>` : ""}</div>`).join("")}</div>` : ""}`;
  if ($("#sh-wake")) $("#sh-wake").onchange = e => { try { localStorage.setItem("finanze-wake", e.target.checked ? "1" : "0"); } catch (x) { } keepAwake(); };
  if ($("#sa")) $("#sa").onsubmit = async e => {
    e.preventDefault(); const v = $("#sa-n").value; if (!v.trim()) return;
    try { const r = await addToList(v); toast(r.exists ? `${r.name} è già in lista` : r.created ? `${r.name} aggiunto (e messo nel catalogo)` : `${r.name} aggiunto`); viewSpesa(); $("#sa-n").focus(); }
    catch (err) { toast(err.message); }
  };
  if ($("#sh-cat")) $("#sh-cat").onclick = () => openShopCatalog();
  $$("[data-chk]").forEach(el => el.onclick = e => { if (e.target.closest("button") || !canEdit()) return; checkItem(el.dataset.chk, true); viewSpesa(); });
  $$("[data-unchk]").forEach(el => el.onclick = () => { if (!canEdit()) return; checkItem(el.dataset.unchk, false); viewSpesa(); });
  $$("[data-rm]").forEach(b => b.onclick = () => { removeItem(b.dataset.rm, false); viewSpesa(); });
  $$("[data-snz]").forEach(b => b.onclick = () => { const u = removeItem(b.dataset.snz, true); toast(u ? `Va bene, lo ripropongo dal ${shortDate(u)}` : "Tolto"); viewSpesa(); });
  $$("[data-now]").forEach(b => b.onclick = async () => { await addToList(DB.t.shop_products[b.dataset.now].name); viewSpesa(); });
  if ($("#sh-done")) $("#sh-done").onclick = () => {
    const n = finishShopping(); viewSpesa();
    const cat = cats().find(c => c.name === "Spesa alimentare" && !c.deleted_at);
    if (confirm(`Spesa finita (${n} prodotti). Vuoi registrare anche l'importo?`)) openTx(null, { kind: "spesa", occurred_on: todayIso(), category_id: cat ? cat.id : null });
  };
}

function openShopCatalog() {
  S.catQ = "";
  const { sheet } = openSheet("Catalogo", `<input type="search" id="cq" placeholder="Cerca nel catalogo" autocomplete="off" style="margin-bottom:12px"><div id="cl"></div>
    <p class="hint">Tocca un prodotto per metterlo in lista (o toglierlo). Prodotti, reparti e cadenze si modificano dal Mac.</p>`);
  const draw = () => {
    const q = shopKey(S.catQ), st = productStats();
    const onList = new Set(shopItems().filter(i => !i.checked_at).map(i => i.product_id));
    const list = products().filter(p => !q || shopKey(p.name).includes(q));
    const byDep = {}; list.forEach(p => (byDep[p.department || "Altro"] = byDep[p.department || "Altro"] || []).push(p));
    const deps = SHOP_DEPARTMENTS.filter(d => byDep[d]).concat(Object.keys(byDep).filter(d => !SHOP_DEPARTMENTS.includes(d)));
    $("#cl", sheet).innerHTML = deps.map(d => `<div class="shop-dep">${esc(d)}</div><div class="card shop-card">${byDep[d].map(p => `<div class="shop-it ${onList.has(p.id) ? "picked" : ""}" data-cp="${p.id}">
      <span class="box"></span><span class="n">${esc(p.name)}${st[p.id] && st[p.id].interval ? `<br><span class="muted" style="font-size:12px">ogni ${st[p.id].interval} gg</span>` : ""}</span>
      ${onList.has(p.id) ? '<span class="badge ok">in lista</span>' : ""}</div>`).join("")}</div>`).join("")
      || `<div class="empty">Nessun prodotto${q ? ` con «${esc(S.catQ)}»` : ""}.${q && canEdit() ? `<br><button class="btn primary" id="cadd" style="margin-top:12px">Aggiungi «${esc(S.catQ)}»</button>` : ""}</div>`;
    $$("[data-cp]", sheet).forEach(el => el.onclick = async () => {
      if (!canEdit()) return;
      const it = shopItems().find(i => !i.checked_at && i.product_id === el.dataset.cp);
      if (it) removeItem(it.id, false); else await addToList(DB.t.shop_products[el.dataset.cp].name);
      draw();
    });
    if ($("#cadd", sheet)) $("#cadd", sheet).onclick = async () => { const r = await addToList(S.catQ); toast(`${r.name} aggiunto (e messo nel catalogo)`); S.catQ = ""; $("#cq", sheet).value = ""; draw(); };
  };
  $("#cq", sheet).oninput = () => { S.catQ = $("#cq", sheet).value; draw(); };
  draw();
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
    <button class="btn link" id="dl-back" style="margin:-6px 0 6px">‹ Riepilogo</button>
    <div class="card"><div class="muted" style="font-size:13px">Spese fisse al mese</div><div class="big out num" style="font-size:26px;font-weight:700">${eur(fixed)}</div></div>
    <div class="card"><h2>Scadenze di ${MESI[+S.month.slice(5) - 1]}</h2>
      ${due.length ? due.map(r => `<div class="row"><span class="muted num" style="width:48px">${shortDate(r.due)}</span>
        <span class="n">${esc(r.name)}<br><span class="badge ${STATE[r.state][1]}">${STATE[r.state][0]}</span></span>
        <span style="text-align:right"><b class="num">${eur(r.amount)}</b><br>${r.state !== "pagata" && canEdit() ? `<button class="btn link" data-reg="${r.id}">Registra</button>` : ""}</span></div>`).join("")
        : `<p class="muted">Nessuna scadenza in questo mese.</p>`}
    </div>
    ${autoDeadlines().length ? `<div class="card"><h2>Auto</h2>${autoDeadlines().map(x => `<div class="row">
      <span class="muted num" style="width:48px">${shortDate(x.due)}</span><span class="n">${esc(x.label)} ${esc(x.vehicle)}</span>
      ${x.level ? `<span class="badge ${x.level === "30" ? "wait" : "late"}">${x.days <= 0 ? (x.days === 0 ? "Oggi" : "Scaduto") : "tra " + x.days + " gg"}</span>` : `<span class="muted" style="font-size:13px">tra ${x.days} gg</span>`}</div>`).join("")}
      <p class="hint" style="margin:8px 0 0">Per segnare un pagamento o cambiare le date usa la sezione Auto sul Mac.</p></div>` : ""}
    ${familyDeadlines().filter(x => x.days <= 60).length ? `<div class="card"><h2>Famiglia</h2>${familyDeadlines().filter(x => x.days <= 60).map(x => `<div class="row" data-gofam>
      <span class="muted num" style="width:48px">${shortDate(x.due)}</span><span class="n">${esc(x.label)}${x.person !== "Famiglia" ? `<br><span class="muted" style="font-size:12px">${esc(x.person)}</span>` : ""}</span>${dueBadgeW(x)}</div>`).join("")}</div>` : ""}
    ${next.length ? `<div class="card"><h2>Più avanti</h2>${next.map(r => `<div class="row"><span class="muted num" style="width:48px">${shortDate(r.next_due)}</span>
      <span class="n">${esc(r.name)}</span><b class="num">${eur(r.amount)}</b></div>`).join("")}</div>` : ""}
    <p class="hint" style="margin:4px">Le spese ricorrenti si gestiscono dal programma sul Mac. Quelle pagate in banca si segnano da sole quando importi l'estratto conto; per le altre usa «Registra».</p>`;
  $$("[data-gofam]").forEach(el => el.onclick = () => { S.view = "famiglia"; S.famTab = "scadenze"; render(); window.scrollTo(0, 0); });
  $("#dl-back").onclick = () => { S.view = "home"; render(); window.scrollTo(0, 0); };
  $$("[data-reg]").forEach(b => b.onclick = async () => {
    const r = DB.t.recurrings[b.dataset.reg];
    if (!confirm(`Registrare il pagamento di «${r.name}» (${eur(r.amount)})?`)) return;
    try { await registerRecurring(r.id, S.month); toast("Pagamento registrato"); render(); } catch (e) { toast(e.message); }
  });
}

/* ==========================================================================
   Famiglia: persone, documenti e visite, paghetta, spese per il 730, ISEE e 730
   ========================================================================== */
const DOC_SUGGEST = ["Carta d'identità", "Passaporto", "Patente", "Tessera sanitaria", "Permesso di soggiorno"];
const VISIT_SUGGEST = ["Pediatra", "Dentista", "Oculista", "Medico di base", "Vaccino", "Ginecologo", "Dermatologo"];
const YD_STATE = { "da fare": "late", "in corso": "wait", "fatto": "ok" };
const longDateW = iso => { const d = new Date(iso + "T12:00:00"); return `${d.getDate()} ${MESI[d.getMonth()]} ${d.getFullYear()}`; };
function dueBadgeW(x) {
  if (x.days == null) return "";
  if (x.level) return `<span class="badge ${x.level === "30" ? "wait" : "late"}">${x.days < 0 ? "Scaduto" : x.days === 0 ? "Oggi" : "tra " + x.days + " gg"}</span>`;
  return `<span class="muted" style="font-size:13px">${x.days < 0 ? "scaduto" : x.days > 400 ? shortDate(x.due || x.due_date) + " " + (x.due || x.due_date).slice(0, 4) : "tra " + x.days + " gg"}</span>`;
}
function openSheet(title, body, onSave, { saveLabel = "Salva", del } = {}) {
  const sheet = document.createElement("div"); sheet.className = "sheet"; sheet.id = "sheet";
  sheet.innerHTML = `<div class="sheet-head"><button class="btn link" id="sx">Chiudi</button><h2>${esc(title)}</h2><span style="width:60px"></span></div>
    ${body}<p class="err" id="se"></p>
    ${del && canEdit() ? `<button class="btn danger wide" id="sdel" style="margin-top:8px">${esc(del.label)}</button>` : ""}
    ${onSave && canEdit() ? `<div class="save-bar"><button class="btn primary wide" id="ss">${esc(saveLabel)}</button></div>` : ""}`;
  document.body.appendChild(sheet); document.body.style.overflow = "hidden";
  const close = () => { sheet.remove(); document.body.style.overflow = ""; render(); };
  $("#sx", sheet).onclick = close;
  const run = async fn => { try { const msg = await fn(); close(); if (msg) toast(msg); } catch (e) { $("#se", sheet).textContent = e.message; } };
  if ($("#ss", sheet)) $("#ss", sheet).onclick = () => run(onSave);
  if ($("#sdel", sheet)) $("#sdel", sheet).onclick = () => confirm(del.confirm) && run(del.run);
  return { sheet, close, run };
}

function viewFamiglia() {
  S.famTab = S.famTab || "persone";
  const ppl = people();
  if (!ppl.length && S.famTab !== "vacanze") {
    $("#view").innerHTML = `<div class="card"><h2>Chi c'è in famiglia?</h2>
      <p class="hint">Aggiungi le persone: poi potrai segnare documenti e visite con le scadenze, vedere quanto si spende per ciascuno,
        tenere la paghetta dei figli e preparare le spese per il 730.</p>
      ${canEdit() ? `<div class="chips" id="qf">${[["Papà", "adulto"], ["Mamma", "adulto"], ["Figlia", "figlio"], ["Figlio", "figlio"]]
        .map(([n, r]) => `<button data-n="${n}" data-r="${r}" class="on">${n}</button>`).join("")}</div>
      <p class="hint">Tocca per togliere chi non serve; i nomi si cambiano dopo.</p>
      <button class="btn primary wide" id="qf-go">Crea</button>
      <button class="btn link" id="qf-one">Oppure aggiungi una persona per volta</button>` : ""}</div>
      <button class="btn link" id="qf-trip">Vai alle vacanze</button>`;
    $("#qf-trip").onclick = () => { S.famTab = "vacanze"; viewFamiglia(); };
    $$("#qf button").forEach(b => b.onclick = () => b.classList.toggle("on"));
    if ($("#qf-go")) $("#qf-go").onclick = () => {
      $$("#qf button.on").forEach(b => savePerson({ name: b.dataset.n, role: b.dataset.r }));
      toast("Famiglia creata"); render();
    };
    if ($("#qf-one")) $("#qf-one").onclick = () => openPersonW();
    return;
  }
  $("#view").innerHTML = `<div class="seg" id="ft" style="margin-bottom:14px">
      <button data-t="persone">Persone</button><button data-t="scadenze">Scadenze</button><button data-t="fisco">730·ISEE</button><button data-t="vacanze">Vacanze</button></div>
    <div id="fbody"></div>`;
  $$("#ft button").forEach(b => { b.classList.toggle("on", b.dataset.t === S.famTab); b.onclick = () => { S.famTab = b.dataset.t; viewFamiglia(); }; });
  ({ persone: famPersone, scadenze: famScadenze, fisco: famFisco, vacanze: famVacanze })[S.famTab]();
}

function famPersone() {
  const y = new Date().getFullYear(), v = peopleView(y);
  $("#fbody").innerHTML = v.people.map(p => {
    const warn = p.items.filter(i => i.level);
    return `<div class="card person-w" data-p="${p.id}" style="border-left:5px solid ${p.color || "var(--accent)"}">
      <div class="row" style="padding:0;border:0"><span class="n"><b style="font-size:17px">${esc(p.name)}</b>
        <span class="muted" style="font-size:13px"> ${p.role === "figlio" ? "figlio/a" : "adulto"}${p.birth_year ? ", " + (y - p.birth_year) + " anni" : ""}</span></span>
        <span class="muted">›</span></div>
      <div class="pw-stats"><div><span>Spese ${y}</span><b class="num">${eur(p.year_total)}</b></div>
        ${p.allowance ? `<div><span>Paghetta</span><b class="num">${eur(p.allowance.balance)}</b></div>` : ""}
        <div><span>Documenti e visite</span><b>${p.items.length}</b></div></div>
      ${warn.map(i => `<div style="margin-top:6px"><span class="badge ${i.level === "30" ? "wait" : "late"}">${esc(i.name)}: ${i.days < 0 ? "scaduto" : i.days === 0 ? "oggi" : "tra " + i.days + " gg"}</span></div>`).join("")}
    </div>`;
  }).join("") + (canEdit() ? `<button class="scan" id="addp">+ Aggiungi una persona</button>` : "");
  $$(".person-w").forEach(el => el.onclick = () => openPersonDetail(el.dataset.p));
  if ($("#addp")) $("#addp").onclick = () => openPersonW();
}

function openPersonW(p) {
  p = p || { role: "adulto" };
  openSheet(p.id ? "Modifica persona" : "Nuova persona", `
    <label class="f"><span>Nome</span><input type="text" id="pn" value="${esc(p.name)}" autocomplete="off"></label>
    <div class="seg" id="pr" style="margin-bottom:14px"><button data-r="adulto">Adulto</button><button data-r="figlio">Figlio/a</button></div>
    <label class="f"><span>Anno di nascita (facoltativo)</span><input type="text" inputmode="numeric" id="pb" value="${esc(p.birth_year || "")}"></label>
    <label class="f"><span>Colore</span></label><div class="chips" id="pc">${PEOPLE_PALETTE.map(c => `<button data-c="${c}" class="${c === p.color ? "on" : ""}"><span class="dot" style="background:${c};width:16px;height:16px"></span></button>`).join("")}</div>
    <label class="f"><span>Note</span><input type="text" id="pno" value="${esc(p.notes)}"></label>
    <p class="hint">Non serve salvare numeri di documento o codice fiscale: bastano tipo e scadenza.</p>`,
    () => { savePerson({ id: p.id, name: $("#pn").value, role: role, birth_year: $("#pb").value, color: color, notes: $("#pno").value }); return p.id ? "Salvato" : "Persona aggiunta"; },
    p.id ? { del: { label: "Elimina persona", confirm: `Eliminare ${p.name}? Documenti, visite e paghetta vengono cancellati; le spese restano ma senza persona.`, run: () => { deletePerson(p.id); return "Eliminata"; } } } : {});
  let role = p.role, color = p.color;
  const setR = r => { role = r; $$("#pr button").forEach(b => b.classList.toggle("on", b.dataset.r === r)); };
  $$("#pr button").forEach(b => b.onclick = () => setR(b.dataset.r)); setR(role);
  $$("#pc button").forEach(b => b.onclick = () => { color = b.dataset.c; $$("#pc button").forEach(x => x.classList.toggle("on", x === b)); });
  if (!p.id) setTimeout(() => $("#pn").focus(), 250);
}

function openPersonDetail(id) {
  const y = new Date().getFullYear();
  const p = peopleView(y).people.find(x => x.id === id); if (!p) return;
  const { sheet, close } = openSheet(p.name, `
    <div class="card"><div class="card-hw"><h2>Documenti e visite</h2></div>
      ${p.items.length ? p.items.map(i => `<div class="row it" data-i="${i.id}"><span class="n">${esc(i.name)}<br>
        <span class="muted" style="font-size:12px">${i.kind === "visita" ? "Visita" : "Documento"}${i.due_date ? " · " + longDateW(i.due_date) : ""}${i.repeat_months ? " · ogni " + i.repeat_months + " mesi" : ""}</span></span>
        ${i.due_date ? dueBadgeW({ days: i.days ?? daysTo(i.due_date), level: i.level, due: i.due_date }) : ""}</div>`).join("") : `<p class="muted">Ancora niente.</p>`}
      ${canEdit() ? `<div style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="ad">+ Documento</button><button class="btn" id="av">+ Visita</button></div>` : ""}</div>
    ${p.allowance ? `<div class="card"><h2>Paghetta</h2>
      <div class="pw-stats"><div><span>Saldo</span><b class="num">${eur(p.allowance.balance)}</b></div><div><span>Ricevuti ${y}</span><b class="num in">${eur(p.allowance.received)}</b></div><div><span>Spesi ${y}</span><b class="num out">${eur(p.allowance.spent)}</b></div></div>
      ${canEdit() ? `<div style="display:flex;gap:8px;margin:10px 0"><button class="btn" data-al="0">+ Ricevuti</button><button class="btn" data-al="1">− Spesi</button></div>` : ""}
      ${p.allowance.entries.slice(0, 15).map(e => `<div class="row"><span class="muted num" style="width:50px">${shortDate(e.occurred_on)}</span><span class="n">${esc(e.note || (e.amount > 0 ? "Paghetta" : "Spesa"))}</span>
        <b class="num ${e.amount > 0 ? "in" : "out"}">${e.amount > 0 ? "+" : "−"}${eur(Math.abs(e.amount))}</b>${canEdit() ? `<button class="btn link" data-ad="${e.id}" aria-label="Elimina" style="margin-left:8px">✕</button>` : ""}</div>`).join("")}</div>` : ""}
    <div class="card"><h2>Spese ${y}: ${eur(p.year_total)}</h2>
      ${p.by_category.length ? p.by_category.slice(0, 8).map(([c, v]) => `<div class="row"><span class="n">${esc(c)}</span><b class="num">${eur(v)}</b></div>`).join("")
        : `<p class="hint">Nessuna spesa collegata. Quando inserisci una spesa scegli «Per chi»: la prossima volta che compare la stessa descrizione viene collegata da sola.</p>`}
      ${Object.keys(p.deductions).length ? `<p class="hint" style="margin-top:10px">Per il 730: ${Object.entries(p.deductions).map(([k, v]) => `${esc(k)} ${eur(v)}`).join(", ")}</p>` : ""}
      ${p.transactions.length ? `<div class="list" style="margin-top:8px">${p.transactions.slice(0, 20).map(txRow).join("")}</div>` : ""}</div>
    ${canEdit() ? `<button class="btn wide" id="pe-ed">Modifica ${esc(p.name)}</button>` : ""}`);
  const reopen = () => { sheet.remove(); openPersonDetail(id); };
  if ($("#ad", sheet)) $("#ad", sheet).onclick = () => { sheet.remove(); openItemW({ kind: "documento", person_id: id }); };
  if ($("#av", sheet)) $("#av", sheet).onclick = () => { sheet.remove(); openItemW({ kind: "visita", person_id: id }); };
  $$(".it", sheet).forEach(el => el.onclick = () => { sheet.remove(); openItemW(DB.t.person_items[el.dataset.i]); });
  $$("[data-al]", sheet).forEach(b => b.onclick = () => { sheet.remove(); openAllowanceW(p, b.dataset.al === "1"); });
  $$("[data-ad]", sheet).forEach(b => b.onclick = e => { e.stopPropagation(); if (confirm("Eliminare questo movimento della paghetta?")) { deleteAllowance(b.dataset.ad); reopen(); } });
  $$(".tx", sheet).forEach(el => el.onclick = () => { sheet.remove(); document.body.style.overflow = ""; openTx(DB.t.transactions[el.dataset.id]); });
  if ($("#pe-ed", sheet)) $("#pe-ed", sheet).onclick = () => { sheet.remove(); openPersonW(DB.t.people[id]); };
}

function openItemW(it) {
  const visit = it.kind === "visita", sugg = visit ? VISIT_SUGGEST : DOC_SUGGEST;
  const p = personById(it.person_id);
  const s = openSheet(`${it.id ? "" : visit ? "Nuova visita" : "Nuovo documento"}${it.id ? it.name : ""}${p ? " · " + p.name : ""}`, `
    ${!it.id ? `<div class="chips" id="isg">${sugg.map(n => `<button data-n="${esc(n)}">${esc(n)}</button>`).join("")}</div>` : ""}
    <label class="f"><span>Nome</span><input type="text" id="in" value="${esc(it.name)}" autocomplete="off"></label>
    <label class="f"><span>${visit ? "Prossima visita" : "Scadenza"}</span><input type="date" id="id" value="${esc(it.due_date || "")}"></label>
    <label class="f"><span>Si ripete ogni (mesi, facoltativo)</span><input type="text" inputmode="numeric" id="ir" value="${esc(it.repeat_months || "")}" placeholder="${visit ? "es. 6 o 12" : "es. 120 per la carta d'identità"}"></label>
    <label class="f"><span>Note</span><input type="text" id="ino" value="${esc(it.notes)}"></label>
    <p class="hint">Promemoria a 30 e 15 giorni e alla scadenza, nel Riepilogo e sul Mac.</p>
    ${it.id && canEdit() ? `<button class="btn wide" id="iren" style="margin-top:6px">${visit ? "Visita fatta: fissa la prossima" : "Rinnovato: nuova scadenza"}</button>` : ""}`,
    () => { savePersonItem({ id: it.id, person_id: it.person_id, kind: it.kind, name: $("#in").value, due_date: $("#id").value, repeat_months: $("#ir").value, notes: $("#ino").value }); return "Salvato"; },
    it.id ? { del: { label: "Elimina", confirm: `Eliminare «${it.name}»?`, run: () => { deletePersonItem(it.id); return "Eliminato"; } } } : {});
  $$("#isg button").forEach(b => b.onclick = () => { $("#in").value = b.dataset.n; $$("#isg button").forEach(x => x.classList.toggle("on", x === b)); });
  if ($("#iren")) $("#iren").onclick = () => {
    const auto = it.repeat_months ? addMonthsIso(todayIso(), it.repeat_months) : "";
    const v = prompt(`Nuova data (aaaa-mm-gg)${auto ? ", proposta tra " + it.repeat_months + " mesi" : ""}`, auto || $("#id").value);
    if (!v) return;
    s.run(() => { const nd = renewPersonItem(it.id, /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null); return "Nuova scadenza: " + longDateW(nd); });
  };
}

function openAllowanceW(p, spent) {
  openSheet(spent ? `Spesa di ${p.name}` : `Paghetta a ${p.name}`, `
    <input class="amount num" id="aa" inputmode="decimal" placeholder="0,00" autocomplete="off" aria-label="Importo in euro"><div class="amount-line">euro</div>
    <label class="f"><span>Nota (facoltativa)</span><input type="text" id="an" placeholder="${spent ? "es. figurine, gelato" : "es. paghetta settimanale, regalo nonni"}"></label>`,
    () => { addAllowance(p.id, $("#aa").value, $("#an").value, spent); return "Registrato"; });
  setTimeout(() => $("#aa").focus(), 250);
}

function famScadenze() {
  const dl = familyDeadlines(), ppl = people();
  $("#fbody").innerHTML = `<div class="card"><h2>Documenti, visite, ISEE e 730</h2>
      ${dl.length ? dl.map(x => `<div class="row fdl" data-id="${x.id}" data-k="${x.kind}"><span class="muted num" style="width:50px">${shortDate(x.due)}</span>
        <span class="n">${esc(x.label)}<br><span class="muted" style="font-size:12px">${esc(x.person)}${x.due.slice(0, 4) !== todayIso().slice(0, 4) ? " · " + x.due.slice(0, 4) : ""}</span></span>${dueBadgeW(x)}</div>`).join("")
        : `<p class="muted">Nessuna scadenza: aggiungi documenti e visite qui sotto.</p>`}</div>
    ${canEdit() ? `<div style="display:flex;gap:8px;margin-bottom:8px"><button class="btn" data-new="documento">+ Documento</button><button class="btn" data-new="visita">+ Visita</button></div>` : ""}`;
  $$(".fdl").forEach(el => el.onclick = () => ["isee", "730"].includes(el.dataset.k) ? openYearlyW(DB.t.yearly_docs[el.dataset.id]) : openItemW(DB.t.person_items[el.dataset.id]));
  $$("[data-new]").forEach(b => b.onclick = () => {
    if (ppl.length === 1) return openItemW({ kind: b.dataset.new, person_id: ppl[0].id });
    const s = openSheet("Per chi?", `<div class="chips">${ppl.map(p => `<button data-p="${p.id}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</button>`).join("")}</div>`);
    $$("[data-p]", s.sheet).forEach(x => x.onclick = () => { s.sheet.remove(); openItemW({ kind: b.dataset.new, person_id: x.dataset.p }); });
  });
}

function famFisco() {
  S.famYear = S.famYear || new Date().getFullYear() - 1;
  const v = peopleView(S.famYear), ppl = people();
  const years = [0, 1, 2].map(i => new Date().getFullYear() - i);
  const per = t => v.people.map(p => [p, p.deductions[t]]).filter(([, x]) => x);
  $("#fbody").innerHTML = `
    <div class="card"><h2>ISEE e 730</h2>
      ${v.yearly_docs.length ? v.yearly_docs.map(d => `<div class="row yd-w" data-id="${d.id}"><span class="n"><b>${d.kind === "isee" ? "ISEE" : "730"} ${d.year}</b><br>
        <span class="muted" style="font-size:12px">${d.status === "fatto" ? (d.done_date ? "fatto il " + longDateW(d.done_date) : "fatto") : d.due_date ? "entro il " + longDateW(d.due_date) : ""}${d.office ? " · " + esc(d.office) : ""}
        ${d.amount != null ? " · " + (d.kind === "isee" ? "valore " + eur(d.amount) : d.amount >= 0 ? "rimborso " + eur(d.amount) : "da pagare " + eur(-d.amount)) : ""}</span></span>
        <span class="badge ${YD_STATE[d.status]}">${d.status}</span></div>`).join("") : `<p class="hint">Segna qui ogni anno ISEE e 730: stato, scadenza, CAF e risultato. Così li ritrovi anno dopo anno.</p>`}
      ${canEdit() ? `<div style="display:flex;gap:8px;margin-top:10px"><button class="btn" data-yd="isee">+ ISEE</button><button class="btn" data-yd="730">+ 730</button></div>` : ""}</div>
    <div class="card"><h2>Spese utili per il 730</h2>
      <div class="seg" id="fy" style="margin-bottom:12px">${years.map(y => `<button data-y="${y}" class="${y === S.famYear ? "on" : ""}">${y}</button>`).join("")}</div>
      ${v.deduct_types.map(t => `<div class="row" style="align-items:flex-start"><span class="n">${esc(t)}${per(t).length ? `<br><span class="muted" style="font-size:12px">${per(t).map(([p, x]) => `${esc(p.name)} ${eur(x)}`).join(" · ")}</span>` : ""}</span>
        <b class="num">${eur(v.deduct_totals[t] || 0)}</b></div>`).join("")}
      <p class="hint" style="margin-top:8px">Indicativo: riconosciute dalla descrizione e dalla categoria. Controlla con il CAF cosa è detraibile.</p>
      <button class="btn" id="x730">Scarica l'elenco (CSV)</button></div>
    ${v.deduct_unassigned.length && ppl.length ? `<div class="card"><h2>Da attribuire (${v.deduct_unassigned.length})</h2>
      <p class="hint">Per chi era la spesa? La prossima volta con la stessa descrizione lo faccio da solo.</p>
      ${v.deduct_unassigned.slice(0, 25).map(t => `<div style="padding:10px 0;border-bottom:1px solid var(--line)">
        <div class="row" style="padding:0;border:0"><span class="muted num" style="width:50px">${shortDate(t.occurred_on)}</span><span class="n">${esc(t.description || catLabel(t.category_id) || "Spesa")}<br>
          <span class="muted" style="font-size:12px">${esc(t.deduct)}</span></span><b class="num">${eur(t.amount)}</b></div>
        ${canEdit() ? `<div class="chips mini" style="margin:8px 0 0">${ppl.map(p => `<button data-as="${t.id}" data-p="${p.id}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</button>`).join("")}
          ${ppl.filter(p => p.role === "figlio").length > 1 ? `<button data-as="${t.id}" data-p="${ppl.filter(p => p.role === "figlio").map(p => p.id).join(",")}">Tutti i figli</button>` : ""}</div>` : ""}</div>`).join("")}</div>` : ""}`;
  $$("#fy button").forEach(b => b.onclick = () => { S.famYear = +b.dataset.y; famFisco(); });
  $$(".yd-w").forEach(el => el.onclick = () => openYearlyW(DB.t.yearly_docs[el.dataset.id]));
  $$("[data-yd]").forEach(b => b.onclick = () => openYearlyW({ kind: b.dataset.yd }));
  $$("[data-as]").forEach(b => b.onclick = () => { const n = setTxPerson(b.dataset.as, b.dataset.p); toast(n > 1 ? `Attribuite ${n} spese uguali` : "Attribuita"); famFisco(); });
  $("#x730").onclick = async () => {
    const r = export730Csv(S.famYear);
    if (!r.count) return toast("Nessuna spesa utile nel " + S.famYear);
    const name = `spese_730_${S.famYear}.csv`, blob = new Blob([r.text], { type: "text/csv" });
    try {
      const f = new File([blob], name, { type: "text/csv" });
      if (navigator.canShare && navigator.canShare({ files: [f] })) return await navigator.share({ files: [f], title: name });
    } catch (e) { if (e.name === "AbortError") return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  };
}

function openYearlyW(d) {
  const isee = d.kind === "isee", nowY = new Date().getFullYear();
  const year = d.year || (isee ? nowY + (new Date().getMonth() >= 9 ? 1 : 0) : nowY + (new Date().getMonth() >= 9 ? 1 : 0));
  const amt = d.amount == null ? "" : amountText(Math.abs(Number(d.amount)));
  openSheet(`${isee ? "ISEE" : "730"}${d.id ? " " + d.year : ""}`, `
    <label class="f"><span>${isee ? "Anno di validità" : "Anno di presentazione"}</span><input type="text" inputmode="numeric" id="yy" value="${year}" ${d.id ? "disabled" : ""}></label>
    ${!isee ? `<p class="hint" id="yh">Il 730 ${year} riguarda le spese del ${year - 1}.</p>` : ""}
    <label class="f"><span>Stato</span></label><div class="seg" id="yst" style="margin-bottom:14px">${["da fare", "in corso", "fatto"].map(s => `<button data-s="${s}">${s}</button>`).join("")}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <label class="f"><span>Scadenza</span><input type="date" id="ydue" value="${esc(d.due_date || "")}"></label>
      <label class="f"><span>Fatto il</span><input type="date" id="ydone" value="${esc(d.done_date || "")}"></label></div>
    ${!d.id ? `<p class="hint">Se lasci vuota la scadenza propongo ${isee ? "il 31 gennaio" : "il 30 settembre"}: controlla ogni anno la data giusta.</p>` : ""}
    ${isee ? `<label class="f"><span>Valore ISEE (facoltativo)</span><input type="text" inputmode="decimal" id="ya" value="${esc(amt)}"></label>`
      : `<label class="f"><span>Risultato (facoltativo)</span></label><div class="seg" id="ydb" style="margin-bottom:8px"><button data-d="0">Rimborso</button><button data-d="1">Da pagare</button></div>
        <label class="f"><input type="text" inputmode="decimal" id="ya" value="${esc(amt)}" placeholder="0,00"></label>`}
    <label class="f"><span>CAF, patronato o commercialista</span><input type="text" id="yo" value="${esc(d.office)}"></label>
    <label class="f"><span>Note</span><input type="text" id="yn" value="${esc(d.notes)}"></label>`,
    async () => { await saveYearlyDoc({ id: d.id, kind: d.kind, year: $("#yy").value, status: st, due_date: $("#ydue").value, done_date: $("#ydone").value,
      amount: $("#ya").value, debt: debt, office: $("#yo").value, notes: $("#yn").value }); return "Salvato"; },
    d.id ? { del: { label: "Elimina", confirm: `Eliminare ${isee ? "l'ISEE" : "il 730"} ${d.year}?`, run: () => { deleteYearlyDoc(d.id); return "Eliminato"; } } } : {});
  let st = d.status || "da fare", debt = d.amount != null && Number(d.amount) < 0;
  const setS = s => { st = s; $$("#yst button").forEach(b => b.classList.toggle("on", b.dataset.s === s)); if (s === "fatto" && !$("#ydone").value) $("#ydone").value = todayIso(); };
  $$("#yst button").forEach(b => b.onclick = () => setS(b.dataset.s)); setS(st);
  const setD = v => { debt = v; $$("#ydb button").forEach(b => b.classList.toggle("on", (b.dataset.d === "1") === v)); };
  $$("#ydb button").forEach(b => b.onclick = () => setD(b.dataset.d === "1")); setD(debt);
  if ($("#yh")) $("#yy").oninput = () => { const y = +$("#yy").value; if (y > 1999) $("#yh").textContent = `Il 730 ${y} riguarda le spese del ${y - 1}.`; };
}

/* ---------- vacanze ---------- */
const TRIP_STATE_W = { "in corso": ["In corso", "ok"], "in programma": ["Confermata", "ok"], "bozza": ["Da decidere", "wait"], "conclusa": ["Conclusa", ""], "annullata": ["Annullata", ""] };
function tripDatesW(t) {
  if (!t.start_date) return "Date da decidere";
  const a = t.start_date, b = t.end_date || a, same = a.slice(0, 4) === b.slice(0, 4);
  return `${shortDate(a)}${same ? "" : " " + a.slice(0, 4)} – ${shortDate(b)} ${b.slice(0, 4)}${t.nights != null ? ` · ${t.nights} ${t.nights === 1 ? "notte" : "notti"}` : ""}`;
}
function famVacanze() {
  const list = tripsView(), dl = tripDeadlines().filter(d => d.level);
  $("#fbody").innerHTML = `
    ${dl.map(d => `<div class="card alert ${d.level === "30" ? "wait" : "late"}"><b>${esc(d.label)}</b> per ${esc(d.trip)}: entro il ${shortDate(d.due)}${d.days > 0 ? `, tra ${d.days} gg` : ""}</div>`).join("")}
    ${list.map(t => { const st = TRIP_STATE_W[t.state], ref = t.budget || t.planned, todo = t.items.filter(i => !i.booked).length;
      return `<div class="card trip-w ${["conclusa", "annullata"].includes(t.state) ? "past" : ""}" data-trip="${t.id}" style="border-top:5px solid ${t.color || "var(--accent)"}">
        <div class="row" style="padding:0;border:0"><span class="n"><span class="badge ${st[1]}">${st[0]}</span>${t.countdown != null ? ` <span class="muted" style="font-size:12px">tra ${t.countdown} gg</span>` : ""}</span><span class="muted">›</span></div>
        <h2 style="margin:8px 0 2px">${esc(t.name)}</h2><div class="muted" style="font-size:13px">${t.destination ? esc(t.destination) + " · " : ""}${tripDatesW(t)}</div>
        ${ref ? `<div class="bar" style="margin:10px 0 4px"><div class="${t.spent > ref ? "over" : ""}" style="width:${Math.min(100, t.spent / ref * 100)}%;${t.spent > ref ? "" : `background:${t.color}`}"></div></div>
          <div class="muted" style="font-size:12px">${eur(t.spent)} di ${eur(ref)} ${t.budget ? "di budget" : "previsti"}</div>` : `<div class="muted" style="font-size:13px;margin-top:6px">${eur(t.spent)} spesi</div>`}
        ${todo && !["conclusa", "annullata"].includes(t.state) ? `<div class="muted" style="font-size:12px;margin-top:4px">${todo} ${todo === 1 ? "voce" : "voci"} da prenotare</div>` : ""}</div>`; }).join("")}
    ${!list.length ? `<div class="card"><h2>Pianifica una vacanza</h2><p class="hint">Ogni vacanza ha la sua scheda con date, budget e voci da prenotare. Quando la confermi,
      le spese fatte tra l'inizio e la fine entrano qui da sole, senza sparire dalle altre sezioni. Le schede restano nello storico.</p></div>` : ""}
    ${canEdit() ? `<button class="scan" id="addtrip">+ Nuova vacanza</button>` : ""}`;
  $$(".trip-w").forEach(el => el.onclick = () => openTripDetail(el.dataset.trip));
  if ($("#addtrip")) $("#addtrip").onclick = () => openTripW();
}
function openTripW(t) {
  t = t || { status: "bozza" };
  const s = openSheet(t.id ? "Modifica vacanza" : "Nuova vacanza", `
    <label class="f"><span>Nome</span><input type="text" id="tn" value="${esc(t.name)}" placeholder="Es. Sardegna 2027" autocomplete="off"></label>
    <label class="f"><span>Destinazione (facoltativa)</span><input type="text" id="td" value="${esc(t.destination)}" autocomplete="off"></label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><label class="f"><span>Partenza</span><input type="date" id="ts" value="${esc(t.start_date || "")}"></label>
      <label class="f"><span>Rientro</span><input type="date" id="te" value="${esc(t.end_date || "")}"></label></div>
    <label class="f"><span>Budget (facoltativo)</span><input type="text" inputmode="decimal" id="tb" value="${t.budget == null ? "" : esc(amountText(t.budget))}" placeholder="0,00"></label>
    <label class="f"><span>Stato</span></label><div class="seg" id="tst" style="margin-bottom:14px"><button data-s="bozza">Da decidere</button><button data-s="confermata">Confermata</button><button data-s="annullata">Annullata</button></div>
    <label class="f"><span>Note</span><input type="text" id="tno" value="${esc(t.notes)}"></label>
    <p class="hint">Confermata: le spese tra partenza e rientro entrano qui da sole (tranne bollette, mutuo, abbonamenti e ricorrenti) e restano visibili anche nel resto dell'app.</p>`,
    () => { const r = saveTrip({ id: t.id, name: $("#tn").value, destination: $("#td").value, start_date: $("#ts").value, end_date: $("#te").value,
      budget: $("#tb").value, status: st, notes: $("#tno").value }); return st === "confermata" && r.count ? `Salvata: ${r.count} spese collegate` : "Salvata"; },
    t.id ? { del: { label: "Elimina vacanza", confirm: `Eliminare «${t.name}»? Le spese restano nei movimenti.`, run: () => { deleteTrip(t.id); return "Eliminata"; } } } : {});
  let st = t.status;
  const setS = v => { st = v; $$("#tst button").forEach(b => b.classList.toggle("on", b.dataset.s === v)); };
  $$("#tst button").forEach(b => b.onclick = () => setS(b.dataset.s)); setS(st);
  $("#ts").onchange = () => { if (!$("#te").value || $("#te").value < $("#ts").value) $("#te").value = $("#ts").value; };
  if (!t.id) setTimeout(() => $("#tn").focus(), 250);
  return s;
}
function openTripDetail(id) {
  const t = tripsView().find(x => x.id === id); if (!t) return;
  const st = TRIP_STATE_W[t.state], ref = t.budget || t.planned, maxC = Math.max(1, ...t.by_category.map(c => c.amount));
  const { sheet } = openSheet(t.name, `
    <div class="card" style="border-left:5px solid ${t.color}"><span class="badge ${st[1]}">${st[0]}</span>${t.countdown != null ? ` <span class="muted" style="font-size:13px">si parte tra ${t.countdown} gg</span>` : ""}
      <div class="muted" style="font-size:13px;margin-top:6px">${t.destination ? esc(t.destination) + " · " : ""}${tripDatesW(t)}</div>
      <div class="pw-stats" style="flex-wrap:wrap"><div><span>Speso</span><b class="num ${ref && t.spent > ref ? "out" : ""}">${eur(t.spent)}</b></div>
        ${t.budget ? `<div><span>Budget</span><b class="num">${eur(t.budget)}</b></div><div><span>${t.spent <= t.budget ? "Restano" : "Oltre"}</span><b class="num ${t.spent > t.budget ? "out" : "in"}">${eur(Math.abs(t.budget - t.spent))}</b></div>` : ""}
        ${t.per_day ? `<div><span>Al giorno</span><b class="num">${eur(t.per_day)}</b></div>` : ""}</div>
      ${t.status === "bozza" && canEdit() ? `<button class="btn primary wide" id="tok" style="margin-top:12px">Conferma la vacanza</button>` : ""}</div>
    <div class="card"><h2>Da prenotare e previste</h2>
      ${t.items.length ? t.items.map(i => `<div class="row"><input type="checkbox" data-tog="${i.id}" ${i.booked ? "checked" : ""} ${canEdit() ? "" : "disabled"} style="width:22px;height:22px;margin:0 10px 0 0;accent-color:var(--accent)">
        <span class="n ti-w" data-ti="${i.id}" style="${i.booked ? "color:var(--muted)" : ""}">${esc(i.name)}${i.due_date && !i.booked ? `<br><span class="muted" style="font-size:12px">entro il ${shortDate(i.due_date)}</span>` : ""}</span>
        <b class="num">${i.amount != null ? eur(i.amount) : ""}</b></div>`).join("") + `<p class="hint" style="margin-top:8px">Prenotato ${eur(t.booked_total)} di ${eur(t.planned)}</p>`
        : `<p class="hint">Volo, alloggio, noleggio, attività: con una data «entro il» ti avviso a 30 e 15 giorni.</p>`}
      ${canEdit() ? `<button class="btn" id="tadd" style="margin-top:6px">+ Voce</button>` : ""}</div>
    ${t.by_category.length ? `<div class="card"><h2>Dove vanno i soldi</h2>${t.by_category.map(c => `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px">
      <span><span class="dot" style="background:${c.color}"></span> ${esc(c.name)}</span><b class="num">${eur(c.amount)}</b></div>
      <div class="bar"><div style="width:${c.amount / maxC * 100}%;background:${c.color}"></div></div></div>`).join("")}
      ${t.spent_before ? `<p class="hint">Di cui ${eur(t.spent_before)} pagati prima della partenza.</p>` : ""}</div>` : ""}
    ${t.candidates.length && canEdit() ? `<div class="card"><h2>Pagate prima di partire?</h2><p class="hint">Sembrano spese di viaggio dei mesi prima: aggiungi quelle di questa vacanza.</p>
      ${t.candidates.map(x => `<div class="row"><span class="muted num" style="width:50px">${shortDate(x.occurred_on)}</span><span class="n">${esc(x.description || "Spesa")}</span>
        <b class="num">${eur(x.amount)}</b><button class="btn" data-inc="${x.id}" style="margin-left:8px;padding:6px 12px">+</button></div>`).join("")}</div>` : ""}
    <div class="card"><h2>Spese della vacanza${t.transactions.length ? ` (${t.transactions.length})` : ""}</h2>
      ${t.transactions.length ? t.transactions.slice().reverse().map(x => `<div class="row"><span class="muted num" style="width:50px">${shortDate(x.occurred_on)}</span>
        <span class="n">${esc(x.description || catLabel(x.category_id) || "Spesa")}</span><b class="num">${eur(x.amount)}</b>
        ${canEdit() ? `<button class="btn link" data-out="${x.id}" style="margin-left:10px">Togli</button>` : ""}</div>`).join("")
        : `<p class="hint">${t.status === "bozza" ? "Compariranno quando la vacanza sarà confermata." : "Le spese tra partenza e rientro compariranno qui da sole."}</p>`}
      ${t.excluded_count ? `<p class="hint" style="margin-top:8px">${t.excluded_count} ${t.excluded_count === 1 ? "spesa tolta" : "spese tolte"}: per rimetterle apri il movimento e scegli la vacanza.</p>` : ""}</div>
    ${canEdit() ? `<button class="btn wide" id="tedit">Modifica vacanza</button>` : ""}`);
  const reopen = msg => { sheet.remove(); if (msg) toast(msg); openTripDetail(id); };
  if ($("#tok", sheet)) $("#tok", sheet).onclick = () => {
    try { const r = saveTrip(Object.assign({}, DB.t.trips[id], { status: "confermata" })); reopen(r.count ? `Confermata: ${r.count} spese collegate` : "Confermata"); }
    catch (e) { toast(e.message); }
  };
  $$("[data-tog]", sheet).forEach(c => c.onchange = () => { toggleTripItem(c.dataset.tog); reopen(); });
  $$("[data-ti]", sheet).forEach(el => el.onclick = () => { if (!canEdit()) return; sheet.remove(); openTripItemW(DB.t.trip_items[el.dataset.ti]); });
  if ($("#tadd", sheet)) $("#tadd", sheet).onclick = () => { sheet.remove(); openTripItemW({ trip_id: id, kind: "trasporto" }); };
  $$("[data-inc]", sheet).forEach(b => b.onclick = () => { setTxTrip(b.dataset.inc, id); reopen("Aggiunta alla vacanza"); });
  $$("[data-out]", sheet).forEach(b => b.onclick = () => { setTxTrip(b.dataset.out, null); reopen("Tolta dalla vacanza (resta nei movimenti)"); });
  if ($("#tedit", sheet)) $("#tedit", sheet).onclick = () => { sheet.remove(); openTripW(DB.t.trips[id]); };
}
function openTripItemW(it) {
  const t = DB.t.trips[it.trip_id];
  openSheet(`${it.id ? it.name : "Nuova voce"} · ${t ? t.name : ""}`, `
    <div class="seg" id="tik" style="margin-bottom:14px">${Object.entries(TRIP_KINDS).map(([k, l]) => `<button data-k="${k}">${l}</button>`).join("")}</div>
    <label class="f"><span>Voce</span><input type="text" id="tin" value="${esc(it.name)}" placeholder="Es. Volo, Hotel, Noleggio auto" autocomplete="off"></label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><label class="f"><span>Costo previsto</span><input type="text" inputmode="decimal" id="tia" value="${it.amount == null ? "" : esc(amountText(it.amount))}" placeholder="0,00"></label>
      <label class="f"><span>Prenotare entro</span><input type="date" id="tid" value="${esc(it.due_date || "")}"></label></div>
    <label style="display:flex;gap:10px;align-items:center;margin:4px 0 14px"><input type="checkbox" id="tib" ${it.booked ? "checked" : ""} style="width:22px;height:22px;accent-color:var(--accent)"> Già prenotato o pagato</label>
    <label class="f"><span>Note</span><input type="text" id="tino" value="${esc(it.notes)}"></label>`,
    () => { saveTripItem({ id: it.id, trip_id: it.trip_id, kind: kind, name: $("#tin").value, amount: $("#tia").value, due_date: $("#tid").value, booked: $("#tib").checked, notes: $("#tino").value });
      setTimeout(() => openTripDetail(it.trip_id), 0); return "Salvata"; },
    it.id ? { del: { label: "Elimina voce", confirm: `Eliminare «${it.name}»?`, run: () => { deleteTripItem(it.id); setTimeout(() => openTripDetail(it.trip_id), 0); return "Eliminata"; } } } : {});
  let kind = it.kind || "altro";
  const setK = v => { kind = v; $$("#tik button").forEach(b => b.classList.toggle("on", b.dataset.k === v)); };
  $$("#tik button").forEach(b => b.onclick = () => setK(b.dataset.k)); setK(kind);
}

/* ==========================================================================
   Altro
   ========================================================================== */
function viewAltro() {
  const set = Object.fromEntries(rows("app_settings").map(r => [r.key, r.value]));
  $("#view").innerHTML = `
    <div class="card"><h2>${esc(DB.members[uid()] || DB.email)}</h2>
      <p class="hint">${esc(DB.email)}, famiglia ${esc(DB.hhName)}, ${({ owner: "amministratore", member: "membro", viewer: "sola lettura" })[DB.role] || ""}</p></div>
    ${fundAccount() ? (() => { const f = fundAccount(), m = thisMonth(), av = fundAvailable();
      let amt = null; try { amt = JSON.parse((DB.t.app_settings[DB.hh + "|work_settings"] || {}).value || "{}").amount; } catch (e) { }
      const sp = round2(rows("transactions").filter(t => t.kind === "trasferimento" && t.transfer_account_id === f.id && t.occurred_on.startsWith(m)).reduce((s, t) => s + Number(t.amount), 0));
      return `<div class="card"><h2>Fondo spese lavoro</h2><div class="row"><span class="n">Disponibile</span><b class="num">${eur(av)}</b></div>
        ${amt ? `<div class="row"><span class="n">Da farsi rimborsare</span><b class="num">${eur(Math.max(0, amt - av))}</b></div>` : ""}
        <div class="row"><span class="n">Speso questo mese</span><b class="num">${eur(sp)}</b></div>
        <p class="hint">Per segnare una spesa di lavoro tocca + e spunta «Spesa di lavoro». La nota spese si prepara dal Mac.</p></div>`; })() : ""}
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
    <div class="card" id="lockcard"></div>
    <div class="card"><h2>Esci</h2><p class="hint">Scollega questo telefono. I dati restano su Supabase.</p><button class="btn danger" id="lo">Esci</button></div>`;
  drawLockCard();
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
    logout(); saveLockCfg({ enabled: false }); renderLogin();
  };
}

/* ==========================================================================
   Blocco con Face ID (passkey del telefono: il volto lo controlla l'iPhone, l'app riceve solo «ok»)
   ========================================================================== */
const LOCK_KEY = "finanze-lock";
function lockCfg() { try { return JSON.parse(localStorage.getItem(LOCK_KEY)) || { enabled: false }; } catch (e) { return { enabled: false }; } }
function saveLockCfg(c) { try { localStorage.setItem(LOCK_KEY, JSON.stringify(c)); } catch (e) { } }
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function lockSupported() {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; }
}
async function enableLock(after) {
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { name: "Finanze di Famiglia", id: location.hostname },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: DB.email || "famiglia", displayName: (DB.members[uid()] || DB.email || "Famiglia") + " · Finanze" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
    timeout: 60000 } });
  saveLockCfg({ enabled: true, credId: b64u(cred.rawId), after });
}
async function verifyLock() {
  const c = lockCfg();
  await navigator.credentials.get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname, timeout: 60000, userVerification: "required",
    allowCredentials: c.credId ? [{ type: "public-key", id: unb64u(c.credId), transports: ["internal"] }] : [] } });
}
function showLock() {
  if ($("#lock")) return;
  document.body.insertAdjacentHTML("beforeend", `<div id="lock" class="lock"><div class="lock-box">
    <img src="apple-touch-icon.png" alt=""><h1>Finanze di Famiglia</h1><p class="muted">Bloccata</p>
    <button class="btn primary wide" id="lock-go">Sblocca con Face ID</button><p class="err" id="lock-err"></p>
    <button class="btn link" id="lock-out" style="margin-top:20px">Non funziona? Esci e accedi con la password</button></div></div>`);
  document.body.style.overflow = "hidden";
  let busy = false;
  const go = async auto => {
    if (busy || !$("#lock")) return; busy = true; $("#lock-err").textContent = "";
    try { await verifyLock(); $("#lock").remove(); document.body.style.overflow = $("#sheet") ? "hidden" : ""; }
    catch (e) { if (!auto && $("#lock-err")) $("#lock-err").textContent = e.name === "NotAllowedError" ? "Annullato o non riconosciuto: tocca di nuovo «Sblocca»" : (e.message || "Non riuscito"); }
    busy = false;
  };
  $("#lock-go").onclick = () => go(false);
  $("#lock-out").onclick = () => {
    const p = pendingCount();
    if (!confirm(p ? `${p} modifiche non sono ancora state inviate: se esci le perdi. Uscire?` : "Uscire? Poi accedi di nuovo con email e password.")) return;
    logout(); saveLockCfg({ enabled: false }); $("#lock").remove(); document.body.style.overflow = ""; renderLogin();
  };
  setTimeout(() => go(true), 350);   // prova subito; se l'iPhone vuole un tocco, c'è il bottone
}
async function drawLockCard() {
  const box = $("#lockcard"); if (!box) return;
  const ok = await lockSupported(), c = lockCfg();
  if (!$("#lockcard")) return;
  box.innerHTML = `<h2>Blocco con Face ID</h2>${ok ? `
    <p class="hint">Quando apri l'app, o ci torni dopo un po', chiede il Face ID prima di mostrare i dati. Vale solo per questo telefono.</p>
    <label class="f"><span>Chiedilo</span><select id="lk-after">${[[0, "Ogni volta che riapri l'app"], [5, "Dopo 5 minuti"], [15, "Dopo 15 minuti"], [60, "Dopo 1 ora"]]
      .map(([v, l]) => `<option value="${v}" ${v === (c.after ?? 5) ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    ${c.enabled ? `<button class="btn" id="lk-save">Salva</button> <button class="btn danger" id="lk-off">Disattiva</button>` : `<button class="btn primary" id="lk-on">Attiva Face ID</button>`}
    <p class="err" id="lk-err"></p>`
    : `<p class="hint">Su questo telefono o browser non è disponibile. Serve un iPhone con Face ID o Touch ID e l'app aperta da Safari o dalla schermata Home.</p>`}`;
  if ($("#lk-on")) $("#lk-on").onclick = async () => {
    try { await enableLock(+$("#lk-after").value); toast("Face ID attivo"); drawLockCard(); }
    catch (e) { $("#lk-err").textContent = e.name === "NotAllowedError" ? "Annullato" : (e.message || "Non riuscito"); }
  };
  if ($("#lk-save")) $("#lk-save").onclick = () => { saveLockCfg(Object.assign(lockCfg(), { after: +$("#lk-after").value })); toast("Salvato"); };
  if ($("#lk-off")) $("#lk-off").onclick = async () => {
    try { await verifyLock(); saveLockCfg({ enabled: false }); toast("Face ID disattivato"); drawLockCard(); }
    catch (e) { $("#lk-err").textContent = "Per disattivarlo serve il Face ID"; }
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
  if (lockCfg().enabled) showLock();
  renderShell();
  const vai = new URLSearchParams(location.search).get("vai");
  if (vai && canEdit()) { history.replaceState(null, "", location.pathname); if (vai === "km") openKm("giorno"); if (vai === "km-weekend") openKm("weekend"); }
  sync().then(() => !$("#sheet") && render());
}
document.addEventListener("visibilitychange", () => {
  const c = lockCfg();
  if (document.visibilityState === "hidden") { try { localStorage.setItem("finanze-hidden-at", String(Date.now())); } catch (e) { } return; }
  if (DB.session && c.enabled && !$("#lock")) {
    let at = 0; try { at = +localStorage.getItem("finanze-hidden-at") || 0; } catch (e) { }
    if (!c.after || Date.now() - at > c.after * 60000) showLock();
  }
  wakeTouched = Date.now(); keepAwake();
  if (DB.session) sync().then(() => !$("#sheet") && render());
});
window.addEventListener("online", () => DB.session && sync().then(() => !$("#sheet") && render()));
setInterval(() => { if (document.visibilityState === "visible" && DB.session && !$("#sheet")) sync().then(render); }, 120000);
setInterval(() => { if (S.view === "spesa" && document.visibilityState === "visible" && DB.session && !$("#sheet") && navigator.onLine) sync().then(() => S.view === "spesa" && !$("#sheet") && render()); }, 15000);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => { });
start();
