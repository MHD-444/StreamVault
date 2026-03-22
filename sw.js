const CACHE = 'streamvault-v4';
const STATIC = [
    '/',
    '/index.html',
    '/style.css',
    '/main.js',
    '/manifest.json'
];

// Install — cache static assets
self.addEventListener('install', e => {e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC)).then(() => self.skipWaiting()));});

// Activate — clean up old caches
self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Fetch — cache first for static, network first for API
self.addEventListener('fetch', e => {
    if (!e.request.url.startsWith('http')) return;
    const url = new URL(e.request.url);

    // Network-first for API and embed sources
    if (url.hostname.includes('themoviedb.org') ||
        url.hostname.includes('primesrc.me') ||
        url.hostname.includes('vidsrc') ||
        url.hostname.includes('embed.su')) {
        e.respondWith(fetch(e.request).catch(() => caches.match(e.request).then(r => r || Response.error())));
        return;
    }

    // Cache-first for everything else
    e.respondWith(
        caches.match(e.request).then(cached => {
            if (cached) return cached;
            return fetch(e.request).then(res => {
                if (res.ok && e.request.method === 'GET' && res.type !== 'opaque') {
                    const clone = res.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone).catch(() => { }));
                }
                return res;
            });
        }).catch(() => {
            // For navigation requests fall back to cached index.html
            if (e.request.mode === 'navigate') { return caches.match('/index.html'); }
            return Response.error();
        })
    );
});