const CACHE = 'streamvault-v18';
const STATIC = [
    '/',
    '/index.html',
    '/style.css',
    '/main.js',
    '/manifest.json',
    'assets/streamvault.png',
    'assets/logo32.png',
    'assets/logo192.png',
    'assets/logo512.png'
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(cache =>
            Promise.all(STATIC.map(url => {
                return fetch(new Request(url, { cache: 'no-cache' })).catch(() => {
                    console.warn(`SW: Failed to precache ${url}`);
                    return new Response('', { status: 404 });
                }).then(response => {
                    if (!response || response.status !== 200 || response.status >= 400) {return null;}
                    return cache.put(url, response.clone());
                });
            })).then(results => {
                console.log(`SW: Pre-cached ${results.filter(Boolean).length}/${STATIC.length} assets`);
            }).catch(err => console.error('SW install failed:', err))).then(() => self.skipWaiting())
    );
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
    const EMBED_HOSTS = ['primesrc.me', 'vidsrc.me', 'vidsrc.to', 'embed.su', '2embed.cc', 'moviesapi.club', 'vidsrcme.ru'];
    if (EMBED_HOSTS.some(h => url.hostname.includes(h))) {
        e.respondWith(fetch(request).catch(() => Response.error()));
        return;
    }
    if (request.mode === 'navigate') {
        e.respondWith(fetch(request).catch(() => caches.match('index.html').then(r => r || Response.error())));
        return;
    }

    e.respondWith(
        caches.open(CACHE).then(cache =>
            caches.match(request).then(cached => {
                if (cached) return cached;
                return fetch(request).then(response => {
                    if (response && response.status === 200) {
                        const clone = response.clone();
                        caches.open(CACHE).then(c => c.put(request, clone));
                    }
                    return response;
                }).catch(() => {
                    if (request.mode === 'navigate') { return caches.match('index.html'); }
                    if (request.destination === 'image') { return caches.match('assets/streamvault.png'); }
                    if (request.destination === 'style' || request.destination === 'script') { return caches.match(request.url.replace(/\?.*$/, '')); }
                    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
                });
            })
        )
    );
});