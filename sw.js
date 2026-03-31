const CACHE = 'streamvault-v9';
const STATIC = [
    '/',
    '/index.html',
    '/style.css',
    '/main.js',
    '/manifest.json',
    'assets/StreamVault.png',
    'assets/logo32.png',
    'assets/logo192.png',
    'assets/logo512.png'
];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
    const { request } = e;
    const url = new URL(request.url);

    if (!request.url.startsWith('http')) return;
    if (url.pathname.startsWith('/api')) {
        e.respondWith(fetch(request));
        return;
    }

    const isExternal = url.hostname !== self.location.hostname;
    if (isExternal) {
        e.respondWith(fetch(request).catch(() => Response.error()));
        return;
    }

    if (request.mode === 'navigate') {
        e.respondWith(fetch(request).catch(() => caches.match('/index.html').then(r => r || Response.error())));
        return;
    }

    e.respondWith(
        caches.match(request).then(cached => {
            const fetchPromise = fetch(request).then(response => {
                if (!response || response.status !== 200 || response.type === 'opaque') {
                    return response;
                }
                const responseClone = response.clone();
                e.waitUntil(caches.open(CACHE).then(cache => cache.put(request, responseClone))); return response;
            }).catch(() => {
                if (request.destination === 'image') {
                    return caches.match('assets/StreamVault.png');
                }
                return Response.error();
            });
            return cached || fetchPromise;
        })
    );
});