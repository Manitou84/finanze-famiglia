/* Finanze di Famiglia — rende la web app apribile anche senza rete.
   I dati non passano di qui: vanno a Supabase e restano nel telefono. */
const CACHE = "finanze-v9";
const FILES = ["./", "index.html", "style.css", "app.js", "dati.js", "scontrino.js", "config.js", "regole_predefinite.json",
  "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys()
  .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;   // Supabase e lettore scontrini: sempre in rete
  // prima la rete (gli aggiornamenti arrivano subito), se manca la copia salvata
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});
