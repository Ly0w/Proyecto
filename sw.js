const CACHE_NAME = 'antigravity-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then(cache => cache.addAll(ASSETS_TO_CACHE))
        .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                .map(key => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

// Network First, falling back to cache strategy
self.addEventListener('fetch', event => {
    // Solo manejamos GET requests
    if (event.request.method !== 'GET') return;
    
    // Ignorar extensiones de chrome etc
    if (!event.request.url.startsWith('http')) return;
    
    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                // Si la red funciona, clonamos y cacheamos la nueva respuesta
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME)
                        .then(cache => {
                            cache.put(event.request, responseToCache);
                        });
                }
                return networkResponse;
            })
            .catch(() => {
                // Si la red falla, buscamos en la caché
                return caches.match(event.request);
            })
    );
});
