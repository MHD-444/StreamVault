const CACHE = 'streamvault-v1';
const STATIC = [
    '/',
    '/index.html',
    '/style.css',
    '/main.js',
    '/manifest.json',
    '/logo192.png',
    '/logo512.png',
    'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=DM+Sans:wght@300;400;500&display=swap'
];

// Install — cache static assets
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.addAll(STATIC))
            .then(() => self.skipWaiting())
    );
});

// Activate — clean up old caches
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys
                .filter(k => k !== CACHE)
                .map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch — cache first for static, network first for API
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);
    if (url.hostname.includes('themoviedb.org') ||
        url.hostname.includes('primesrc.me') ||
        url.hostname.includes('vidsrc') ||
        url.hostname.includes('embed.su')) {
        e.respondWith(
            fetch(e.request)
                .catch(() => caches.match(e.request))
        );
        return;
    }

    // Cache-first for everything else (fonts, css, js, images)
    e.respondWith(
        caches.match(e.request)
            .then(cached => cached || fetch(e.request)
                .then(res => {
                    if (res.ok && e.request.method === 'GET') {
                        const clone = res.clone();
                        caches.open(CACHE).then(c => c.put(e.request, clone));
                    }
                    return res;
                })
            )
    );
});