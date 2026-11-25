// LIFE VI service worker: keeps a copy of the app's own files so it opens offline. It never reads or sends user data.
const CACHE = 'life-vi-dev'; // the release workflow stamps the version in, so every release gets a fresh cache
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/app.css', './js/app.js', './js/logic.js', './js/version.js',
  './icons/logo-clear.svg', './icons/favicon.svg', './icons/favicon-32.png', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
  './fonts/barlow-condensed-600.woff2', './fonts/barlow-condensed-700.woff2', './fonts/barlow-condensed-800.woff2',
  './fonts/barlow-semi-condensed-500.woff2', './fonts/barlow-semi-condensed-600.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Serve from the cache straight away and refresh it in the background, so updates land on the next launch
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    });
    if (hit) {
      e.waitUntil(fresh.catch(() => {}));
      return hit;
    }
    return fresh.catch(() => (req.mode === 'navigate' ? cache.match('./index.html') : Response.error()));
  }));
});
