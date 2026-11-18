/* ==========================================================================
   Lettura dello scontrino: testo riconosciuto dalla foto -> importo, data, esercente.
   Pensato per i "documenti commerciali" italiani (TOTALE COMPLESSIVO, IMPORTO PAGATO…).
   ========================================================================== */
"use strict";

const SCONTRINO = (() => {
  // importo con 2 decimali, anche con spazi o lettere lette male (O al posto di 0)
  const AMOUNT = /(\d{1,3}(?:[.\s]\d{3})*|\d+)\s?[,.]\s?(\d{2})(?!\d)/g;
  const fixOcr = s => s.replace(/(?<=\d)[oO](?=\d|\b)/g, "0").replace(/(?<=\d)[lI|](?=\d)/g, "1");
  const toNum = (int, dec) => parseFloat(int.replace(/[.\s]/g, "") + "." + dec);

  // parole che indicano la riga del totale, dalla più affidabile
  const TOTAL_KEYS = [
    /totale\s*complessivo/i, /importo\s*pagato/i, /totale\s*(?:euro|eur|€)/i, /tot(?:ale)?\.?\s*da\s*pagare/i,
    /pagamento\s*(?:elettronico|carta|bancomat|pos)/i, /(?<!sub)(?<!sub\s)totale/i, /\btot\b/i,
  ];
  const NOT_TOTAL = /(sub\s?totale|iva|imponibile|resto|sconto|risparmio|punti|aliquota|di cui)/i;

  function amountsIn(line) {
    const out = []; let m; AMOUNT.lastIndex = 0;
    while ((m = AMOUNT.exec(line))) out.push(toNum(m[1], m[2]));
    return out;
  }

  function findTotal(lines) {
    for (const key of TOTAL_KEYS) {
      for (let i = 0; i < lines.length; i++) {
        if (!key.test(lines[i]) || NOT_TOTAL.test(lines[i])) continue;
        // importo sulla stessa riga, altrimenti su quella successiva
        const here = amountsIn(lines[i]);
        if (here.length) return here[here.length - 1];
        const next = lines[i + 1] ? amountsIn(lines[i + 1]) : [];
        if (next.length) return next[next.length - 1];
      }
    }
    // ripiego: l'importo più ricorrente tra i più alti (spesso compare 2-3 volte: totale, pagato, carta)
    const all = lines.filter(l => !NOT_TOTAL.test(l)).flatMap(amountsIn).filter(n => n > 0 && n < 10000);
    if (!all.length) return null;
    const count = {}; all.forEach(n => count[n] = (count[n] || 0) + 1);
    const repeated = Object.keys(count).map(Number).filter(n => count[n] > 1);
    return repeated.length ? Math.max(...repeated) : Math.max(...all);
  }

  function findDate(text, today) {
    const re = /\b(\d{1,2})\s?[\/\-.]\s?(\d{1,2})\s?[\/\-.]\s?(\d{4}|\d{2})\b/g;
    let m; const found = [];
    while ((m = re.exec(text))) {
      let [, d, mo, y] = m.map(Number);
      if (y < 100) y += 2000;
      if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2015) continue;
      const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (iso <= today) found.push(iso);
    }
    return found.length ? found.sort().reverse()[0] : null;
  }

  const SKIP_NAME = /(documento|commerciale|scontrino|fiscale|vendita|prestazione|p\.?\s?iva|partita|c\.?\s?f\.?|tel|via |viale|piazza|corso|www|http|cassa|operatore|descrizione|prezzo|benvenut|grazie|^\W*$)/i;
  function findMerchant(lines) {
    for (const l of lines.slice(0, 6)) {
      const clean = l.replace(/[^\p{L}\p{N}&'.\- ]/gu, " ").replace(/\s+/g, " ").trim();
      const letters = (clean.match(/\p{L}/gu) || []).length;
      if (letters >= 3 && letters / clean.replace(/ /g, "").length > 0.6 && !SKIP_NAME.test(clean)) {
        // Esselunga SPA -> Esselunga
        return clean.replace(/\b\d{3,}\b/g, " ").replace(/\b(s\.?p\.?a\.?|s\.?r\.?l\.?|s\.?n\.?c\.?|s\.?a\.?s\.?)\b\.?/gi, "").trim()
          .toLowerCase().replace(/(^|\s)\p{L}/gu, c => c.toUpperCase());
      }
    }
    return null;
  }

  function parse(text, today) {
    const fixed = fixOcr(text || "");
    const lines = fixed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    return { amount: findTotal(lines), date: findDate(fixed, today || new Date().toISOString().slice(0, 10)),
      merchant: findMerchant(lines), text: fixed };
  }

  // Foto -> immagine più leggibile: ridimensionata, in scala di grigi, con più contrasto
  async function prepare(file) {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const px = ctx.getImageData(0, 0, c.width, c.height); const d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = Math.max(0, Math.min(255, (g - 128) * 1.6 + 140));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(px, 0, 0);
    return c;
  }

  let libLoading;
  function loadLib() {
    if (window.Tesseract) return Promise.resolve();
    libLoading = libLoading || new Promise((ok, ko) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      s.onload = ok; s.onerror = () => { libLoading = null; ko(new Error("Serve internet la prima volta per scaricare il lettore di scontrini")); };
      document.head.appendChild(s);
    });
    return libLoading;
  }

  // Legge la foto sul telefono (niente viene inviato altrove) e restituisce i dati trovati
  async function read(file, onProgress) {
    await loadLib();
    onProgress && onProgress("Preparo la foto…");
    const canvas = await prepare(file);
    const worker = await Tesseract.createWorker("ita", 1, {
      logger: m => { if (m.status === "recognizing text" && onProgress) onProgress(`Leggo lo scontrino… ${Math.round(m.progress * 100)}%`); },
    });
    try {
      const { data } = await worker.recognize(canvas);
      return parse(data.text);
    } finally {
      await worker.terminate();
    }
  }

  return { parse, read };
})();
if (typeof module !== "undefined") module.exports = SCONTRINO;
