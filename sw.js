/* Service worker : rend l'app utilisable hors-ligne.
 * Fichiers statiques : servis depuis le cache, rafraîchis en arrière-plan.
 * Appels Google (Apps Script) : jamais mis en cache.
 * À chaque déploiement, incrémente CACHE_VERSION pour forcer la mise à jour.
 */
const CACHE_VERSION = 'v13';
const CACHE_NAME = `carnet-muscu-${CACHE_VERSION}`;
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './nutrition.js', './steps.js', './sync.js', './config.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;            // Google Apps Script, etc. : réseau direct

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok) caches.open(CACHE_NAME).then((c) => c.put(request, res.clone()));
          return res;
        })
        .catch(() => cached);
      // Pages : réseau d'abord (mise à jour rapide), cache si hors-ligne. Reste : cache d'abord.
      return request.mode === 'navigate' ? network.then((r) => r || cached) : (cached || network);
    }),
  );
});
