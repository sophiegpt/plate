// Offline support: cache the whole app on install, serve it cache-first.
// Bump VERSION whenever any file changes, or phones keep the old copy.
// Only this site's own files are cached; calls to Anthropic and the Garmin relay
// always go to the network.
const VERSION = '1.0.1';
const CACHE = `plate-${VERSION}`;
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/util.js',
  './js/ui.js',
  './js/nutrition.js',
  './js/photos.js',
  './js/ai.js',
  './js/garmin.js',
  './js/vendor/anthropic.js',
  './js/views/today.js',
  './js/views/log.js',
  './js/views/trends.js',
  './js/views/body.js',
  './js/views/settings.js',
  './js/views/about.js',
  './js/views/welcome.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/favicon.svg',
];

// cache: 'reload' skips the HTTP cache (GitHub Pages serves max-age=600), so an update
// never mixes old and new files.
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('plate-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page asks for this when the user taps "Update".
self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    }),
  );
});
