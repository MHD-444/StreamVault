const CACHE = 'streamvault-v5';
const STATIC = ['/', '/index.html', '/style.css', '/main.js', '/manifest.json'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
    const { request } = e;
    const url = new URL(request.url);

    // Skip non-http and browser extension requests
    if (!request.url.startsWith('http')) return;

    // Network-only for third-party APIs and embeds
    const isExternal = url.hostname !== self.location.hostname;
    if (isExternal) {
        e.respondWith(fetch(request).catch(() => Response.error()));
        return;
    }

    // Navigation requests (page loads) — always serve index.html
    if (request.mode === 'navigate') {
        e.respondWith(fetch(request).catch(() => caches.match('/index.html').then(r => r || Response.error())));
        return;
    }

    // Static assets — cache first, network fallback
    e.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached;
            return fetch(request).then(response => {
                if (!response || response.status !== 200 || response.type === 'opaque') {
                    return response || Response.error();
                }
                const clone = response.clone();
                caches.open(CACHE).then(c => c.put(request, clone));
                return response;
            }).catch(() => Response.error());
        })
    );
});