/* Cagómetro service worker — app shell (network-first) + actualización controlada */
const CACHE = "cagometro-20261105-192909";
const ASSETS = [
  "./", "./index.html", "./styles.css",
  "./app.js", "./store.js", "./firebase.js", "./i18n.js", "./funfacts.js", "./recap.js", "./recap-player.js",
  "./firebase-bundle.js",
  "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png",
  "./assets/bristol-1.png", "./assets/bristol-2.png", "./assets/bristol-3.png",
  "./assets/bristol-4.png", "./assets/bristol-5.png", "./assets/bristol-6.png",
  "./assets/bristol-7.png",
  "./assets/heatmap-promo.jpg"
];

self.addEventListener("install", e => {
  // Precarga el shell, pero NO hace skipWaiting automático: el cliente decide
  // cuándo activar la versión nueva (evita servir un shell mezclado/a medias).
  // `cache:"reload"`: se salta la caché HTTP del navegador (GitHub Pages sirve con max-age=600): sin esto, un móvil que abrió la app hace menos de 10 min
  // guardaría en la caché NUEVA los archivos VIEJOS y la actualización no se vería hasta pasado ese rato.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: "reload" })))).catch(()=>{}));
});

self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin !== location.origin) return;   // Firebase/Google CDN → directo a red
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then(res => {          // revalida con el servidor (barato: 304) en vez de fiarse de la caché HTTP de 10 min
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});
