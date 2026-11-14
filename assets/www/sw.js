// sw.js - Service Worker for https://rabit.megadeveloper.site/
const CACHE_NAME = 'arnouba-game-v14';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css?v=14',
    './game.js?v=14',
    './manifest.json',
    './assets/assets_data.js?v=14',
    './assets/icon-192.png',
    './assets/icon-512.png',
    './assets/favicon.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)).catch(() => {})
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // Never cache api.php requests!
    if (event.request.url.includes('api.php')) {
        return;
    }
    event.respondWith(
        caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
});
