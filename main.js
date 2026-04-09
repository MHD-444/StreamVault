const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/';
const PRIME_BASE = 'https://primesrc.me/embed';

let API_KEY = localStorage.getItem('tmdb_api_key') || '';
let homeLoaded = false;
let heroItems = [];
let heroIndex = 0;
let heroItem = null;
let heroInterval = null;
let currentShow = null;
let currentSeason = 1;
let searchDebounce = null;
let _pendingEp = null;
let watchTimer = null;
let watchStart = null;
let _pendingTimestamp = 0;
let savedScrollY = 0;
let loadedIds = new Set();
let _activeTabId = 'tab-home';
let currentSource = 'primesrc';
let currentEmbed = { type: null, imdb: null, tmdbId: null, season: null, episode: null };
let currentPage = 1;
let currentSection = null;
let isLoadingMore = false;
let hasMorePages = true;
let isFullscreen = false;
let allResults = [];
let activeGenre = 'all';
let autoplayTimer = null;
let suggestionCache = {};
let importReplaceMode = false;
let _toastTimer = null;
let _toastUndoFn = null;
let _detailAbortController = null;
let pendingWatchTogetherStartAt = null;

// ─── SAFE UTILS ───
function safeClick(id) {
    const el = document.getElementById(id);
    if (el) el.click();
}

function safeFocus(id) {
    const el = document.getElementById(id);
    if (el) el.focus();
}

// ─── STORAGE MODULE ───
const SV = {
    _get(key, fallback) {
        try {return JSON.parse(localStorage.getItem(key)) ?? fallback;} catch {return fallback;}
    },
    _set(key, val) {
        try {
            const str = JSON.stringify(val);
            if (str.length > 500000) { console.warn(`SV: ${key} too large, trimming`); return false; }
            localStorage.setItem(key, str); return true;
        } catch (e) { console.warn('SV storage error:', e); return false; }
    },
    history: {
        get() { return SV._get('sv_history', {}); },
        set(v) { return SV._set('sv_history', v); },
        values() { return Object.values(SV.history.get()).sort((a, b) => b.savedAt - a.savedAt); },
        add(item) {
            const h = SV.history.get();
            const existing = h[item.id] || {};
            const genre_ids = window._pendingGenreIds?.id === item.id ? window._pendingGenreIds.genre_ids : existing.genre_ids || [];
            h[item.id] = { ...existing, ...item, genre_ids, savedAt: Date.now() };
            const entries = Object.entries(h).sort((a, b) => b[1].savedAt - a[1].savedAt);
            const trimmed = Object.fromEntries(entries.slice(0, 200));
            SV.history.set(trimmed);
        },
        remove(id) { const h = SV.history.get(); delete h[id]; SV.history.set(h); },
        has(id) { return !!SV.history.get()[id]; },
    },
    list: {
        get() { return SV._get('sv_mylist', []); },
        set(v) {
            window._svMyListCache = v;
            window._svMyListSet = new Set(v.map(i => i.id));
            return SV._set('sv_mylist', v);
        },
        add(item) { const l = SV.list.get(); if (!l.some(i => i.id === item.id)) SV.list.set([item, ...l]); },
        remove(id) { SV.list.set(SV.list.get().filter(i => i.id !== id)); },
        has(id) { return SV.list.get().some(i => i.id === id); },
    },
    searches: {
        get() { return SV._get('sv_recent_searches', []); },
        add(q) { const r = [q, ...SV._get('sv_recent_searches', []).filter(s => s.toLowerCase() !== q.toLowerCase())].slice(0, 5); SV._set('sv_recent_searches', r); },
        clear() { localStorage.removeItem('sv_recent_searches'); },
    },
    hidden: {
        get() { return new Set(SV._get('sv_hidden', [])); },
        add(id) { const s = SV.hidden.get(); s.add(id); SV._set('sv_hidden', [...s]); },
        clear() { localStorage.removeItem('sv_hidden'); },
        has(id) { return SV.hidden.get().has(id); },
    },
    discovered: {
        get() { return SV._get('sv_discovered_collections', []); },
        add(col) { if (!col?.id) return; const e = SV.discovered.get(); if (!e.some(c => c.id === col.id)) SV._set('sv_discovered_collections', [{ id: col.id, name: col.name }, ...e].slice(0, 50)); },
    },
};

// ─── ICON HELPER ───
const ICONS = {
    play: `<svg width="VAR" height="VAR" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    star: `<svg width="VAR" height="VAR" viewBox="0 0 24 24" fill="var(--gold)"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    check: `<svg width="VAR" height="VAR" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    plus: `<svg width="VAR" height="VAR" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    info: `<svg width="VAR" height="VAR" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    close: `<svg width="VAR" height="VAR" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    next: `<svg width="VAR" height="VAR" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/><line x1="19" y1="3" x2="19" y2="21" stroke="currentColor" stroke-width="2"/></svg>`,
    filter: `<svg width="VAR" height="VAR" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
    globe: `<svg width="VAR" height="VAR" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    back: `<svg width="VAR" height="VAR" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>`,
    eye_off: `<svg width="VAR" height="VAR" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
    newtab: `<svg width="VAR" height="VAR" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    link: `<svg width="VAR" height="VAR" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
    search: `<svg width="VAR" height="VAR" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
    copy: `<svg width="VAR" height="VAR" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    clock: `<svg width="VAR" height="VAR" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    calendar: `<svg width="VAR" height="VAR" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
};
function icon(name, size = 13) {
    return (ICONS[name] || '').replaceAll('VAR', size);
}

// ─── INIT ───
if ('scrollRestoration' in history) { history.scrollRestoration = 'manual'; }

window.addEventListener('DOMContentLoaded', () => {
    // Scroll to top on page load, handle startAt param for Watch Together links, apply saved theme, and show setup if no API key
    window.scrollTo(0, 0);
    const params = new URLSearchParams(location.search);
    const startAt = params.get('startAt');
    if (startAt) {
        const urlId = params.get('id');
        if (urlId) { pendingWatchTogetherStartAt = parseInt(startAt); }
    }
    if (localStorage.getItem('sv_theme') === 'light') toggleTheme();
    if (API_KEY) {
        document.getElementById('setup-overlay').classList.add('hidden');
        initApp();
    } else {
        document.getElementById('setup-overlay').classList.remove('hidden');
    }

    // ─── Search clear button (mobile + desktop) ───
    const clearBtn = document.getElementById('search-clear-btn');
    const searchInput = document.getElementById('search-input');
    if (clearBtn && searchInput) {
        const doClear = e => {
            e.preventDefault();
            e.stopPropagation();
            searchInput.value = '';
            onSearchInput('');
            searchInput.focus();
        };
        clearBtn.addEventListener('mousedown', doClear);
        clearBtn.addEventListener('touchstart', doClear, { passive: false });
    }
});

function saveApiKey() {
    const k = document.getElementById('api-key-input').value.trim();
    if (!k) { showToast('Please enter your TMDB API key'); return; }
    API_KEY = k;
    localStorage.setItem('tmdb_api_key', k);
    suggestionCache = {};
    document.getElementById('setup-overlay').classList.add('hidden');
    initApp();
}

function showSetup() {
    document.getElementById('api-key-input').value = API_KEY;
    document.getElementById('setup-overlay').classList.remove('hidden');
}

function loadHomeContent() {
    if (homeLoaded) return;
    homeLoaded = true;
    loadTrending();
    loadNewThisWeek();
    loadPopularMovies();
    loadPopularTV();
    loadTurkishSeries();
}

function initApp() {
    const p = new URLSearchParams(location.search);
    const hasRoute = p.get('type') || p.get('browse') || p.get('search');
    if (hasRoute) {
        document.getElementById('home-page').classList.add('hidden');
        setTimeout(loadHomeContent, 500);
    } else {
        loadHomeContent();
    }
    renderContinueWatching();
    document.getElementById('year-to').value = new Date().getFullYear();
    document.getElementById('year-to').max = new Date().getFullYear() + 2;
    window.addEventListener('popstate', handleRoute);
    handleRoute();
}

// ─── URL ROUTING ───
function slugify(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function pushState(params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) q.set(k, v);
    history.pushState(params, '', `${location.pathname}?${q.toString()}`);
    document.title = buildTitle(params);
}

function buildTitle(params) {
    const name = params.name ? decodeURIComponent(params.name) : '';
    if (params.browse === 'filter') return 'StreamVault';
    if (params.browse === 'stats') return 'StreamVault';
    if (params.type === 'movie') return `${name} — StreamVault`;
    if (params.type === 'tv' && params.season && params.episode) return `${name} · S${String(params.season).padStart(2, '0')}E${String(params.episode).padStart(2, '0')} — StreamVault`;
    if (params.type === 'tv') return `${name} — StreamVault`;
    if (params.search) return `StreamVault`;
    if (params.browse === 'stats') return 'StreamVault';
    if (params.browse === 'filter') return 'StreamVault';
    if (params.browse) return `StreamVault`;
    return 'StreamVault';
}

function handleRoute() {
    const p = new URLSearchParams(location.search);
    const type = p.get('type');
    const id = p.get('id');
    const season = p.get('season');
    const episode = p.get('episode');
    const search = p.get('search');
    const startAt = p.get('startAt');
    const browse = p.get('browse');

    if (type && id) {
        if (type === 'tv' && season && episode)
            _pendingEp = { season: parseInt(season), episode: parseInt(episode) };
        if (startAt) pendingWatchTogetherStartAt = parseInt(startAt);
        openDetail(parseInt(id), type, false, true);
    } else if (browse) {
        if (browse === 'home') {
            showHome();
        } else if (browse === 'stats') {
            showStats(true);
        } else if (browse === 'filter') {
            restoreFilters(p);
        } else if (browse === 'mylist') {
            showMyList();
        } else if (browse === 'movie' || browse === 'tv') {
            fetchSection(browse);
        } else if (browse === 'collections') {
            showCollections();
        }
    } else if (search) {
        document.getElementById('search-input').value = decodeURIComponent(search);
        doSearch(decodeURIComponent(search), true);
    } else {
        showHome();
    }
}

// ─── XSS HELPER ───
const _escMap = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
function esc(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, c => _escMap[c]);
}

// ─── API FETCH ───
function isBearerToken(key) { return key && key.startsWith('eyJ'); }
async function tmdb(path, params = {}, signal = null) {
    const opts = {};
    let reqUrl;
    if (isBearerToken(API_KEY)) {
        reqUrl = `${TMDB_BASE}${path}?${new URLSearchParams(params)}`;
        opts.headers = { Authorization: `Bearer ${API_KEY}` };
    } else {
        reqUrl = `${TMDB_BASE}${path}?${new URLSearchParams({ api_key: API_KEY, ...params })}`;
    }
    if (signal) opts.signal = signal;
    const res = await fetch(reqUrl, opts);
    if (!res.ok) {
        if (res.status === 401) { showToast('Invalid API key — please update it'); showSetup(); }
        throw new Error('TMDB fetch failed');
    }
    return res.json();
}

// ─── RENDER HELPERS ───
function posterUrl(path, size = 'w342') {return path ? `${TMDB_IMG}${size}${path}` : null;}
function backdropUrl(path) {return path ? `${TMDB_IMG}w1280${path}` : null;}
function starIcon() {return icon('star', 11);}

function makeCard(item, index = 0) {
    const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
    const title = item.title || item.name || 'Unknown';
    const year = (item.release_date || item.first_air_date || '').slice(0, 4);
    const rating = item.vote_average ? item.vote_average.toFixed(1) : '—';
    const poster = posterUrl(item.poster_path);
    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.id = item.id;
    div.style.animationDelay = `${index * 0.04}s`;
    const releaseDate = item.release_date || item.first_air_date || '';
    const nowMs = Date.now();
    const releaseMs = releaseDate ? new Date(releaseDate).getTime() : 0;
    const daysUntil = releaseMs > nowMs ? Math.ceil((releaseMs - nowMs) / (1000 * 60 * 60 * 24)) : 0;
    const comingBadge = daysUntil > 0 ? `<div class="coming-soon-badge">${daysUntil === 1 ? 'Tomorrow' : `In ${daysUntil} days`}</div>` : '';
    const histEntry = (window._svHistoryCache || {})[item.id];
    const isWatched = mediaType === 'movie' && !!histEntry;
    const watchedBadge = isWatched
        ? `<div class="card-watched-badge"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Watched</div>`
        : (mediaType === 'tv' && histEntry?.season) ? `<div class="card-lastwatched-badge">S${histEntry.season} E${histEntry.episode}</div>`: ''; 
    const safeTitle = esc(title);
    const inListNow = isInMyList(item.id);
    const posterWrap = document.createElement('div');
    posterWrap.className = 'cw-poster-wrap';
    posterWrap.style.cursor = 'pointer';
    if (poster) {
        posterWrap.innerHTML = `
            <img class="card-poster" src="${poster}" alt="${safeTitle}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
            <div class="card-poster-placeholder" style="display:none">${safeTitle}</div>${comingBadge} ${watchedBadge}
            <div class="cw-hover-overlay">
                <div class="cw-hover-left">
                    <button class="cw-hover-btn cw-play-btn" title="Play">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </button>
                    <button class="cw-hover-btn cw-list-btn" title="My List" data-in-list="${inListNow}">${inListNow
                ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`
                : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`
            }
                    </button>
                </div>
                <div class="cw-hover-right">
                    <button class="cw-hover-btn cw-detail-btn" title="More Details">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    </button>
                </div>
            </div>`;
    } else {
        posterWrap.innerHTML = `
            <div class="card-poster-placeholder">${safeTitle}</div>${comingBadge} ${watchedBadge}
            <div class="cw-hover-overlay">
                <div class="cw-hover-left">
                    <button class="cw-hover-btn cw-play-btn" title="Play">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </button>
                    <button class="cw-hover-btn cw-list-btn" title="My List" data-in-list="${inListNow}">${inListNow
                ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`
                : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`
            }
                    </button>
                </div>
                <div class="cw-hover-right">
                    <button class="cw-hover-btn cw-detail-btn" title="More Details">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    </button>
                </div>
            </div>`;
    }

    posterWrap.addEventListener('touchstart', () => {
        if (posterWrap.classList.contains('is-touching')) return;
        document.querySelectorAll('.cw-poster-wrap.is-touching').forEach(el => el.classList.remove('is-touching'));
        posterWrap.classList.add('is-touching');
    }, {passive: true});
    posterWrap.addEventListener('click', e => {
        if (e.target.closest('.cw-hover-btn')) return;
        if (posterWrap.classList.contains('is-touching') && window.matchMedia('(hover: none)').matches) {
            openQuickDetail(item.id, mediaType, item);
            return;
        }
        openQuickDetail(item.id, mediaType, item);
    });
    posterWrap.querySelector('.cw-play-btn').addEventListener('click', e => {
        e.stopPropagation();
        savedScrollY = window.scrollY;
        if (item.genre_ids?.length) window._pendingGenreIds = { id: item.id, genre_ids: item.genre_ids };
        openDetail(item.id, mediaType, true);
    });
    const listBtn = posterWrap.querySelector('.cw-list-btn');
    listBtn.addEventListener('click', e => {
        e.stopPropagation();
        let list = getMyList();
        if (isInMyList(item.id)) {
            saveMyList(list.filter(i => i.id !== item.id));
            listBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
            listBtn.dataset.inList = 'false';
            showToast('Removed from My List');
        } else {
            const t = item.title || item.name || '';
            const y = (item.release_date || item.first_air_date || '').slice(0, 4);
            saveMyList([{ id: item.id, type: mediaType, title: t, year: y, poster: item.poster_path || null, addedAt: nowMs }, ...list]);
            listBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`;
            listBtn.dataset.inList = 'true';
            showToast('Added to My List');
        }
    });
    posterWrap.querySelector('.cw-detail-btn').addEventListener('click', e => {
        e.stopPropagation();
        openQuickDetail(item.id, mediaType, item);
    });

    const titleSlug = slugify(item.title || item.name || 'unknown');
    const cardUrl = `${location.pathname}?type=${mediaType}&id=${item.id}&name=${titleSlug}`;
    const infoWrap = document.createElement('div');
    infoWrap.className = 'card-info';
    infoWrap.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:6px;cursor:pointer;';
    infoWrap.innerHTML = `
        <div style="flex:1;min-width:0;">
            <div class="card-title">${safeTitle}</div>
            <div class="card-meta">
                <span>${esc(year)}</span>
                <span class="card-rating">${starIcon()} ${rating}</span>
            </div>
            <div style="margin-top:5px"><span class="card-type-badge">${mediaType === 'movie' ? 'Movie' : 'TV'}</span></div>
        </div>`;

    infoWrap.addEventListener('click', () => {
        savedScrollY = window.scrollY;
        if (item.genre_ids?.length) window._pendingGenreIds = { id: item.id, genre_ids: item.genre_ids };
        history.pushState({}, '', cardUrl);
        openDetail(item.id, mediaType);
    });
    div.addEventListener('contextmenu', e => { e.preventDefault(); showCardContextMenu(e, cardUrl, title); });
    div.appendChild(posterWrap);
    div.appendChild(infoWrap);
    return div;
}

// ─── QUICK DETAIL MODAL ───
function openQuickDetail(id, mediaType, cardItem) {
    document.getElementById('quick-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'quick-modal';
    modal.className = 'qm-backdrop';
    modal.innerHTML = `
        <div class="qm-box">
            <button class="qm-close" id="qm-close-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <div class="qm-backdrop-img" id="qm-backdrop"></div>
            <div class="qm-trailer-wrap" id="qm-trailer-wrap" style="display:none">
                <iframe id="qm-trailer-iframe" allow="autoplay; encrypted-media" allowfullscreen frameborder="0"></iframe>
            </div>
            <div class="qm-gradient"></div>
            <div class="qm-content">
                <div class="qm-title" id="qm-title">${esc(cardItem?.title || cardItem?.name || '')}</div>
                <div class="qm-actions">
                    <button class="qm-play-btn" id="qm-play-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        Play
                    </button>
                    <button class="qm-list-btn" id="qm-list-btn">
                        <svg class="qm-icon-add" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        <svg class="qm-icon-check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="display:none"><polyline points="20 6 9 17 4 12"/></svg>
                        <span class="qm-list-label">My List</span>
                    </button>
                    <button class="qm-detail-btn" id="qm-detail-btn">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        More Details
                    </button>
                </div>
                <div class="qm-meta" id="qm-meta">
                    <div class="skeleton" style="height:14px;width:60%;border-radius:4px;"></div>
                </div>
                <div class="qm-overview" id="qm-overview">
                    <div class="skeleton" style="height:12px;width:100%;border-radius:4px;margin-bottom:6px;"></div>
                    <div class="skeleton" style="height:12px;width:85%;border-radius:4px;margin-bottom:6px;"></div>
                    <div class="skeleton" style="height:12px;width:70%;border-radius:4px;"></div>
                </div>
                <div class="qm-genres" id="qm-genres"></div>
            </div>
        </div>`;

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    let trailerTimer = null;
    let trailerKey = null;
    const close = () => {
        clearTimeout(trailerTimer);
        const iframe = document.getElementById('qm-trailer-iframe');
        if (iframe) iframe.src = '';
        modal.classList.add('qm-closing');
        document.body.style.overflow = '';
        setTimeout(() => modal.remove(), 250);
    };
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.getElementById('qm-close-btn').addEventListener('click', close);

    const qmBox = modal.querySelector('.qm-box');
    let _swipeStartY = 0, _swipeActive = false;
    qmBox.addEventListener('touchstart', e => { _swipeStartY = e.touches[0].clientY; _swipeActive = true; }, { passive: true });
    qmBox.addEventListener('touchmove', e => {
        if (!_swipeActive) return;
        const delta = e.touches[0].clientY - _swipeStartY;
        if (delta > 0) qmBox.style.transform = `translateY(${Math.min(delta * 0.4, 80)}px)`;
    }, { passive: true });
    qmBox.addEventListener('touchend', e => {
        if (!_swipeActive) return;
        _swipeActive = false;
        const delta = e.changedTouches[0].clientY - _swipeStartY;
        if (delta > 80) { close(); } else { qmBox.style.transform = ''; }
    });
    document.getElementById('qm-play-btn').addEventListener('click', () => { close(); savedScrollY = window.scrollY; openDetail(id, mediaType, true); });
    document.getElementById('qm-detail-btn').addEventListener('click', () => { close(); savedScrollY = window.scrollY; openDetail(id, mediaType, false); });

    const qmListBtn = document.getElementById('qm-list-btn');
    const qmIconAdd = qmListBtn.querySelector('.qm-icon-add');
    const qmIconCheck = qmListBtn.querySelector('.qm-icon-check');
    const qmLabel = qmListBtn.querySelector('.qm-list-label');
    const refreshQmList = () => {
        const inList = isInMyList(id);
        qmIconAdd.style.display = inList ? 'none' : 'block';
        qmIconCheck.style.display = inList ? 'block' : 'none';
        qmLabel.textContent = inList ? 'Saved' : 'My List';
        qmListBtn.style.borderColor = inList ? 'var(--gold)' : '';
        qmListBtn.style.color = inList ? 'var(--gold)' : '';
    };
    refreshQmList();
    qmListBtn.addEventListener('click', () => {
        let list = getMyList();
        const title = cardItem?.title || cardItem?.name || '';
        const year = (cardItem?.release_date || cardItem?.first_air_date || '').slice(0, 4);
        if (isInMyList(id)) {
            saveMyList(list.filter(i => i.id !== id));
            showToast('Removed from My List');
        } else {
            saveMyList([{ id, type: mediaType, title, year, poster: cardItem?.poster_path || null, addedAt: Date.now() }, ...list]);
            showToast('Added to My List');
        }
        refreshQmList();
    });

    requestAnimationFrame(() => modal.classList.add('qm-visible'));
    tmdb(`/${mediaType}/${id}`, { append_to_response: 'credits,videos' }).then(detail => {
        const backdrop = detail.backdrop_path ? `${TMDB_IMG}w1280${detail.backdrop_path}` : (detail.poster_path ? `${TMDB_IMG}w780${detail.poster_path}` : null);
        if (backdrop) {
            const bg = document.getElementById('qm-backdrop');
            if (bg) bg.style.backgroundImage = `url(${backdrop})`;
        }

        const videos = detail.videos?.results || [];
        const trailer = videos.find(v => v.site === 'YouTube' && v.type === 'Trailer' && v.official) || videos.find(v => v.site === 'YouTube' && v.type === 'Trailer') || videos.find(v => v.site === 'YouTube' && v.type === 'Teaser');
        if (trailer) trailerKey = trailer.key;
        const titleEl = document.getElementById('qm-title');
        if (titleEl) titleEl.textContent = detail.title || detail.name || '';

        const year = (detail.release_date || detail.first_air_date || '').slice(0, 4);
        const rating = detail.vote_average ? detail.vote_average.toFixed(1) : '—';
        const runtime = detail.runtime ? `${detail.runtime}m` : (detail.episode_run_time?.[0] ? `${detail.episode_run_time[0]}m/ep` : '');
        const metaEl = document.getElementById('qm-meta');
        if (metaEl) metaEl.innerHTML = `
            <span class="qm-year">${esc(year)}</span>
            ${runtime ? `<span class="qm-runtime">${esc(runtime)}</span>` : ''}
            <span class="qm-rating">${starIcon()} ${rating}</span>
            <span class="qm-type-badge">${mediaType === 'movie' ? 'Movie' : 'TV Series'}</span>`;

        const overviewEl = document.getElementById('qm-overview');
        if (overviewEl) overviewEl.textContent = detail.overview || 'No overview available.';
        const genresEl = document.getElementById('qm-genres');
        if (genresEl && detail.genres?.length) {genresEl.innerHTML = detail.genres.slice(0, 4).map(g => `<span class="qm-genre-tag">${esc(g.name)}</span>`).join('');}

        if (trailerKey && document.getElementById('quick-modal')) {
            trailerTimer = setTimeout(() => {
                const wrap = document.getElementById('qm-trailer-wrap');
                const iframe = document.getElementById('qm-trailer-iframe');
                const bg = document.getElementById('qm-backdrop');
                const gradient = modal.querySelector('.qm-gradient');
                if (!wrap || !iframe || !document.getElementById('quick-modal')) return;
                iframe.src = `https://www.youtube.com/embed/${trailerKey}?autoplay=1&mute=0&controls=1&rel=0&modestbranding=1`;
                wrap.style.display = 'block';
                if (bg) bg.style.opacity = '0';
                if (gradient) gradient.style.opacity = '0';
                wrap.classList.add('qm-trailer-visible');
            }, 4000);
        }
    }).catch(() => { });
}

const _HOME_ROWS = new Set(['trending-row', 'movies-row', 'tv-row', 'turkish-row', 'new-this-week-row', 'continue-watching-row']);
function renderCards(containerId, items) {
    window._svHistoryCache = JSON.parse(localStorage.getItem('sv_history') || '{}');
    const parsedList = JSON.parse(localStorage.getItem('sv_mylist') || '[]');
    window._svMyListCache = parsedList;
    window._svMyListSet = new Set(parsedList.map(i => i.id));
    const _hidden = SV.hidden.get();
    const visibleItems = _hidden.size ? items.filter(i => !_hidden.has(i.id)) : items;
    const el = document.getElementById(containerId);
    el.innerHTML = '';

    if (_HOME_ROWS.has(containerId)) {
        const EAGER = 6; // Number of cards to render immediately for better UX, the rest will be rendered when scrolled into view
        visibleItems.forEach((item, i) => {
            if (i < EAGER) {
                el.appendChild(makeCard(item, i));
                return;
            }
            const placeholder = document.createElement('div');
            placeholder.className = 'card card-placeholder';
            placeholder.style.cssText = 'min-width:160px;flex-shrink:0;';
            el.appendChild(placeholder);
            const obs = new IntersectionObserver(entries => {
                if (!entries[0].isIntersecting) return;
                obs.disconnect();
                const card = makeCard(item, i);
                placeholder.replaceWith(card);
            }, { rootMargin: '0px 200px 0px 0px', root: el.closest('.row-wrap') || null });
            obs.observe(placeholder);
        });
    } else {
        visibleItems.forEach((item, i) => el.appendChild(makeCard(item, i)));
    }
    if (containerId === 'continue-watching-row') {
        setTimeout(() => {
            updateScrollButtons(containerId);
            el.scrollLeft += 1;
            el.scrollLeft -= 1;
        }, 100);
    }
}

function scrollRow(id, dir) {
    const el = document.getElementById(id);
    const scrollAmount = el.clientWidth * 0.8;
    el.scrollBy({ left: dir * scrollAmount, behavior: 'smooth' });
    setTimeout(() => updateScrollButtons(id), 400);
}

function enableDragScroll(el) {
    let startX;
    let scrollLeft;
    let moved = false;

    el.addEventListener('click', e => { if (moved) { e.preventDefault(); e.stopPropagation(); } });
    el.addEventListener('touchstart', e => {
        if (e.target.closest('.scroll-btn')) return;
        startX = e.touches[0].pageX;
        scrollLeft = el.scrollLeft;
    });
    el.addEventListener('touchmove', e => {
        const x = e.touches[0].pageX;
        const walk = (x - startX);
        el.scrollLeft = scrollLeft - walk * 1.5;
    });
}

function updateScrollButtons(rowId) {
    const row = document.getElementById(rowId);
    const wrapper = row.parentElement;
    const leftBtn = wrapper.querySelector('.scroll-btn.left');
    const rightBtn = wrapper.querySelector('.scroll-btn.right');
    const scrollLeft = row.scrollLeft;
    const maxScroll = row.scrollWidth - row.clientWidth;

    if (scrollLeft > 5)
        leftBtn.classList.add('show');
    else
        leftBtn.classList.remove('show');
    if (scrollLeft + row.clientWidth < row.scrollWidth - 5)
        rightBtn.classList.add('show');
    else
        rightBtn.classList.remove('show');
}

function initScrollButtons(rowId) {
    const row = document.getElementById(rowId);
    row.addEventListener('scroll', () => updateScrollButtons(rowId));
    updateScrollButtons(rowId);
}

function initRowFeatures(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;
    enableDragScroll(row);
    initScrollButtons(rowId);
    setTimeout(() => {
        row.scrollLeft += 1;
        row.scrollLeft -= 1;
        updateScrollButtons(rowId);
    }, 150);
}
setTimeout(() => initRowFeatures('continue-watching-row'), 0);

function showSkeletons(containerId, count = 7) {
    document.getElementById(containerId).innerHTML = Array(count).fill(`<div class="skeleton skel-card"></div>`).join('');
}

// ─── HERO ───
function setHero(items) {
    heroItems = items.filter(i => i.backdrop_path);
    if (!heroItems.length) return;
    heroIndex = 0;
    updateHero();
    const dots = document.getElementById('hero-dots');
    dots.innerHTML = heroItems.slice(0, 5).map((_, i) => `<div class="hero-dot ${i === 0 ? 'active' : ''}" onclick="setHeroIndex(${i})"></div>`).join('');
    clearInterval(heroInterval);
    heroInterval = setInterval(() => setHeroIndex((heroIndex + 1) % Math.min(heroItems.length, 5)), 7000);
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        clearInterval(heroInterval);
    } else if (heroItems.length) {
        clearInterval(heroInterval);
        heroInterval = setInterval(() => setHeroIndex((heroIndex + 1) % Math.min(heroItems.length, 5)), 7000);
    }
});

// ─── DRAGGABLE HERO ───
(function () {
    let startX = 0, isDragging = false, moved = false;
    const hero = document.getElementById('hero');

    hero.addEventListener('mousedown', e => {
        if (e.target.closest('button')) return;
        isDragging = true; moved = false;
        startX = e.clientX;
        hero.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', e => {
        if (!isDragging) return;
        if (Math.abs(e.clientX - startX) > 5) moved = true;
    });
    document.addEventListener('mouseup', e => {
        if (!isDragging) return;
        isDragging = false;
        hero.style.cursor = '';
        if (!moved) return;
        const diff = e.clientX - startX;
        const total = Math.min(heroItems.length, 5);
        if (diff < -50) setHeroIndex((heroIndex + 1) % total);
        else if (diff > 50) setHeroIndex((heroIndex - 1 + total) % total);
    });

    hero.addEventListener('touchstart', e => { startX = e.touches[0].clientX; moved = false; }, { passive: true });
    hero.addEventListener('touchmove', e => { if (Math.abs(e.touches[0].clientX - startX) > 5) moved = true; }, { passive: true });
    hero.addEventListener('touchend', e => {
        if (!moved) return;
        const diff = e.changedTouches[0].clientX - startX;
        const total = Math.min(heroItems.length, 5);
        if (diff < -50) setHeroIndex((heroIndex + 1) % total);
        else if (diff > 50) setHeroIndex((heroIndex - 1 + total) % total);
    });
})();

function setHeroIndex(i) {
    heroIndex = i;
    updateHero();
    document.querySelectorAll('.hero-dot').forEach((d, idx) => d.classList.toggle('active', idx === i));
}

function updateHero() {
    const heroBg = document.getElementById('hero-bg');
    const heroBgPrev = document.getElementById('hero-bg-prev');
    if (!heroBg) return;
    const item = heroItems[heroIndex];
    if (!item) return;

    heroItem = item;
    const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
    const title = item.title || item.name;
    const year = (item.release_date || item.first_air_date || '').slice(0, 4);
    const rating = item.vote_average ? `${starIcon()} ${item.vote_average.toFixed(1)}` : '';

    if (heroBgPrev && heroBg.style.backgroundImage) {
        heroBgPrev.style.backgroundImage = heroBg.style.backgroundImage;
        heroBgPrev.style.opacity = '1';
    }
    heroBg.style.opacity = '0';
    heroBg.style.backgroundImage = `url(${backdropUrl(item.backdrop_path)})`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
        heroBg.style.opacity = '1';
        if (heroBgPrev) heroBgPrev.style.opacity = '0';
    }));
    const elTitle = document.getElementById('hero-title');
    const elYear = document.getElementById('hero-year');
    const elType = document.getElementById('hero-type');
    const elRating = document.getElementById('hero-rating');
    const elOverview = document.getElementById('hero-overview');

    if (elTitle) elTitle.textContent = title;
    if (elYear) elYear.textContent = year;
    if (elType) elType.textContent = mediaType === 'movie' ? 'Movie' : 'TV Series';
    if (elRating) elRating.innerHTML = rating;
    if (elOverview) elOverview.textContent = item.overview || '';
}

function watchHero() {
    if (!heroItem) return;
    openDetail(heroItem.id, heroItem.media_type || (heroItem.title ? 'movie' : 'tv'), true);
}
function detailHero() {
    if (!heroItem) return;
    openDetail(heroItem.id, heroItem.media_type || (heroItem.title ? 'movie' : 'tv'), false);
}

// ─── DATA LOADERS ───
async function loadTrending() {
    showSkeletons('trending-row', 7);
    try {
        const data = await tmdb('/trending/all/week');
        setHero(data.results);
        renderCards('trending-row', data.results.slice(0, 14));
    } catch (e) {
        document.getElementById('trending-row').innerHTML = '<div class="empty-state"><p>Failed to load. Check your API key.</p></div>';
    }
}

async function loadPopularMovies() {
    showSkeletons('movies-row', 7);
    try {renderCards('movies-row', (await tmdb('/movie/popular')).results.slice(0, 14));} catch (e) { }
}

async function loadPopularTV() {
    showSkeletons('tv-row', 7);
    try {renderCards('tv-row', (await tmdb('/tv/popular')).results.slice(0, 14));} catch (e) { }
}

async function loadTurkishSeries() {
    showSkeletons('turkish-row', 7);
    try {
        const data = await tmdb('/discover/tv', { with_original_language: 'tr', sort_by: 'first_air_date.desc', 'first_air_date.gte': '2022-01-01', 'vote_count.gte': 10 });
        renderCards('turkish-row', data.results.slice(0, 14).map(r => ({...r, media_type: 'tv'})));
    } catch (e) { }
}

// ─── NAVIGATION ───
function showPage(pageId) {
    document.getElementById('genre-bar').style.display = 'none';
    document.getElementById('filter-toggle').style.display = 'none';
    document.getElementById('filter-panel').style.display = 'none';
    document.getElementById('scroll-sentinel')?.remove();
    window.scrollTo(0, 0);
    ['home-page', 'search-page', 'player-page', 'stats-page', 'mylist-page', 'collections-page'].forEach(id => {
        const el = document.getElementById(id);
        if (id === 'mylist-page' || id === 'collections-page') {
            const isTarget = id === pageId;
            el.style.display = isTarget ? 'block' : 'none';
            if (isTarget) triggerPageEnter(el);
            return;
        }
        if (id === 'home-page') {
            const isTarget = id === pageId;
            el.classList.toggle('hidden', !isTarget);
            if (isTarget) triggerPageEnter(el);
        } else if (id === 'player-page' || id === 'search-page') {
            const isTarget = id === pageId;
            el.classList.toggle('active', isTarget);
            el.style.display = '';
            if (isTarget) triggerPageEnter(el);
        } else {
            const isTarget = id === pageId;
            el.style.display = isTarget ? 'block' : 'none';
            if (isTarget) triggerPageEnter(el);
        }
    });
}

function triggerPageEnter(el) {
    el.classList.remove('page-enter');
    el.style.animation = 'none';
    requestAnimationFrame(() => {
        el.style.animation = '';
        el.classList.add('page-enter');
    });
}

function showHome() {
    const homePage = document.getElementById('home-page');
    const playerIframe = document.getElementById('player-iframe');
    if (homePage && !homePage.classList.contains('hidden')) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }
    if (playerIframe) { playerIframe.src = 'about:blank'; }
    stopWatchTimer();
    const sourceBar = document.getElementById('source-bar');
    if (sourceBar) sourceBar.style.display = 'none';
    showPage('home-page');
    loadHomeContent();
    const input = document.getElementById('search-input');
    if (input) {
        input.value = '';
        input.placeholder = 'Search movies, shows…';
    }
    setActiveTab('tab-home');
    setMobileTab('mtab-home');
    history.pushState({ page: 'home', browse: 'home' }, '', location.pathname);
    document.title = 'StreamVault';
    window.scrollTo(0, 0);
}

const TAB_ORDER = ['tab-home', 'tab-movies', 'tab-tv', 'tab-collections', 'tab-mylist', 'tab-stats'];
function setActiveTab(id) {
    const prevIdx = TAB_ORDER.indexOf(_activeTabId);
    const nextIdx = TAB_ORDER.indexOf(id);
    const dir = nextIdx >= prevIdx ? 1 : -1;

    document.querySelectorAll('.nav-tab').forEach(t => {
        if (t.classList.contains('active')) {
            t.classList.add('nav-leaving');
            setTimeout(() => t.classList.remove('nav-leaving'), 250);
        }
        t.classList.remove('active');
    });

    const target = document.getElementById(id);
    if (!target) return;
    target.classList.add('active');
    _activeTabId = id;
    const PAGE_MAP = {
        'tab-home': 'home-page',
        'tab-movies': 'search-page',
        'tab-tv': 'search-page',
        'tab-collections': 'collections-page',
        'tab-mylist': 'mylist-page',
        'tab-stats': 'stats-page',
    };
    const pageId = PAGE_MAP[id];
    if (pageId) {
        const page = document.getElementById(pageId);
        if (page) {
            page.style.setProperty('--slide-dir', dir === 1 ? '32px' : '-32px');
            page.classList.remove('page-slide-enter');
            requestAnimationFrame(() => requestAnimationFrame(() => page.classList.add('page-slide-enter')));
            setTimeout(() => page.classList.remove('page-slide-enter'), 350);
        }
    }
}

function goBack() {
    stopWatchTimer();
    document.getElementById('player-iframe').src = '';
    document.getElementById('source-bar').style.display = 'none';
    const state = history.state;
    const hasInAppHistory = state && (state.page === 'home' || state.type || state.browse || state.search);

    if (hasInAppHistory && history.length > 1) {
        history.back();
        setTimeout(() => {
            try {
                window.scrollTo({ top: savedScrollY, behavior: 'instant' });
            } catch {
                window.scrollTo(0, savedScrollY);
            }
        }, 150);
    } else {
        showHome();
    }
}

// ─── SEARCH ───
function onSearchInput(val) {
    clearTimeout(searchDebounce);
    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) clearBtn.style.display = val.length ? 'flex' : 'none';
    if (!val.trim()) {
        showRecentSearches();
        return;
    }
    showSearchSuggestions(val);
    if (val.trim().length >= 2) {
        searchDebounce = setTimeout(() => fetchSearchSuggestions(val), 280);
    }
}

function scoreResult(item, query) {
    const q = query.toLowerCase();
    const title = (item.title || item.name || '').toLowerCase();
    let score = item.popularity || 0;
    if (title === q) score += 5000;
    else if (title.startsWith(q)) score += 2000;
    else if (title.includes(q)) score += 800;
    const words = q.split(/\s+/);
    const matchedWords = words.filter(w => title.includes(w)).length;
    score += (matchedWords / words.length) * 400;
    if (item.vote_count > 1000) score += 200;
    if (item.vote_average > 7) score += 100;
    const year = parseInt((item.release_date || item.first_air_date || '').slice(0, 4));
    if (year >= 2015) score += 50;
    return score;
}

function _renderHiddenCount() {
    const count = SV.hidden.get().size;
    if (!count) return;
    const existing = document.getElementById('hidden-count-note');
    if (existing) existing.remove();
    const note = document.createElement('p');
    note.id = 'hidden-count-note';
    note.style.cssText = 'text-align:center;font-size:12px;color:var(--text3);padding:16px 0 8px;';
    note.innerHTML = `${count} title${count !== 1 ? 's' : ''} hidden · <button onclick="SV.hidden.clear();_renderHiddenCount();showToast('Hidden list cleared')" style="color:var(--gold);font-size:12px;text-decoration:underline;background:none;border:none;cursor:pointer;font-family:inherit;">Show all</button>`;
    const sentinel = document.getElementById('scroll-sentinel');
    if (sentinel) sentinel.after(note);
    else document.getElementById('search-results')?.after(note);
}

function _resetSectionState() {
    loadedIds = new Set();
    currentPage = 1;
    hasMorePages = false;
    isLoadingMore = false;
    currentSection = null;
    allResults = [];
}

async function doSearch(query, fromRoute = false) {
    if (!query.trim()) return;
    SV.searches.add(query);
    showPage('search-page');
    renderSkeletons('search-results', 12);
    _resetSectionState();
    document.getElementById('filter-toggle').style.cssText = 'display:flex;margin-bottom:16px;';
    if (!fromRoute) pushState({ search: query });
    document.getElementById('search-query-display').textContent = `"${query}"`;
    document.getElementById('search-count').textContent = 'Searching…';
    try {
        const [m1, t1, m2, t2] = await Promise.all([
            tmdb('/search/movie', { query, page: 1 }),
            tmdb('/search/tv', { query, page: 1 }),
            tmdb('/search/movie', { query, page: 2 }).catch(() => ({ results: [] })),
            tmdb('/search/tv', { query, page: 2 }).catch(() => ({ results: [] })),
        ]);
        const movies = [...m1.results, ...m2.results].map(r => ({ ...r, media_type: 'movie' }));
        const shows = [...t1.results, ...t2.results].map(r => ({ ...r, media_type: 'tv' }));
        const seen = new Set();
        const combined = [...movies, ...shows]
            .filter(r => { const k = `${r.media_type}-${r.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
            .filter(r => r.poster_path || r.vote_count > 0)
            .sort((a, b) => scoreResult(b, query) - scoreResult(a, query));

        document.getElementById('search-count').textContent = `${combined.length} results`;
        if (!combined.length) {
            showDidYouMean(query);
        } else {
            allResults = combined;
            activeGenre = 'all';
            document.querySelectorAll('.genre-btn').forEach(b => b.classList.toggle('active', b.dataset.genre === 'all'));
            document.getElementById('genre-bar').style.display = 'flex';
            combined.forEach(item => loadedIds.add(`${item.media_type}-${item.id}`));
            renderCards('search-results', combined);
            const el = document.getElementById('search-results');
            el.insertAdjacentHTML('afterend', '<div id="scroll-sentinel"></div>');
            attachScrollObserver();
        }
    } catch (e) {
        document.getElementById('search-results').innerHTML = '<div class="empty-state"><p>Search failed. Check your API key.</p></div>';
    }
}

async function showDidYouMean(query) {
    document.getElementById('search-results').innerHTML = '<div class="empty-state"><div class="icon">🎬</div><p>No results found.</p><div id="dym-suggestions" style="margin-top:16px;display:flex;flex-wrap:wrap;gap:8px;justify-content:center;"></div></div>';
    try {
        const words = query.trim().split(/\s+/);
        const candidates = new Map();
        await Promise.all(words.map(async w => {
            if (w.length < 3) return;
            const [m, t] = await Promise.all([tmdb('/search/movie', { query: w, page: 1 }).catch(() => ({ results: [] })), tmdb('/search/tv', { query: w, page: 1 }).catch(() => ({ results: [] }))]);
            [...m.results, ...t.results].slice(0, 3).forEach(r => {
                const title = r.title || r.name || '';
                if (title && !candidates.has(r.id)) candidates.set(r.id, title);
            });
        }));
        const box = document.getElementById('dym-suggestions');
        if (!box || !candidates.size) return;
        box.innerHTML = '<div style="font-size:13px;color:var(--text3);width:100%;margin-bottom:4px;">Did you mean…</div>';
        [...candidates.values()].slice(0, 5).forEach(t => {
            const btn = document.createElement('button');
            btn.className = 'genre-btn';
            btn.textContent = t;
            btn.addEventListener('click', () => { document.getElementById('search-input').value = t; doSearch(t); });
            box.appendChild(btn);
        });
    } catch (e) { }
}

async function fetchSearchSuggestions(query) {
    if (!query.trim()) return;
    try {
        if (!suggestionCache[query]) {
            const data = await tmdb('/search/multi', { query, page: 1 });
            const results = data.results
                .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
                .sort((a, b) => scoreResult(b, query) - scoreResult(a, query))
                .slice(0, 7);
            suggestionCache[query] = results;
            const keys = Object.keys(suggestionCache);
            if (keys.length > 30) delete suggestionCache[keys[0]];
        }
        const current = document.getElementById('search-input').value.trim();
        if (current === query) showSearchSuggestions(query);
    } catch (e) { }
}

function showSearchSuggestions(query) {
    const box = document.getElementById('recent-searches');
    const results = suggestionCache[query];
    const recent = getRecentSearches();

    box.addEventListener('mousedown', e => e.preventDefault());
    box.addEventListener('touchstart', e => { if (!e.target.closest('button')) e.preventDefault(); }, { passive: false });

    const filteredRecent = recent.filter(q => q.toLowerCase().includes(query.toLowerCase())).slice(0, 2);
    const recentHtml = filteredRecent.length ? `
        <div class="recent-header">
            <span>Recent</span>
            <button class="recent-clear" onmousedown="event.preventDefault();clearRecentSearches()">Clear</button>
        </div>
        ${filteredRecent.map(q => `
            <button class="recent-item" onmousedown="event.preventDefault();pickRecentSearch('${q.replace(/'/g, "\\'")}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span>${esc(q)}</span>
            </button>`).join('')}`
        : '';

    const suggestionsHtml = results?.length ? `<div class="recent-header" style="margin-top:${filteredRecent.length ? '4px' : '0'}"><span>Suggestions</span></div>${results.map(r => {
        const title = r.title || r.name || '';
        const year = (r.release_date || r.first_air_date || '').slice(0, 4);
        const type = r.media_type === 'movie' ? 'Movie' : 'TV';
        const poster = r.poster_path ? `${TMDB_IMG}w92${r.poster_path}` : null;
        const rating = r.vote_average ? r.vote_average.toFixed(1) : null;
        return `
            <button class="suggestion-item" onmousedown="event.preventDefault();pickSuggestion(${r.id},'${r.media_type}','${title.replace(/'/g, "\\'")}')">${poster
                ? `<img src="${poster}" alt="${esc(title)}" loading="lazy" onerror="this.style.display='none'">`
                : `<div class="suggestion-poster-placeholder"></div>`}
                <div class="suggestion-info">
                    <div class="suggestion-title">${esc(title)}</div>
                    <div class="suggestion-meta">${esc(year)}${year ? ' · ' : ''}${type}${rating ? ' · ★ ' + rating : ''}</div>
                </div>
                <svg class="suggestion-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>`;
    }).join('')}` : (results ? '<div class="recent-empty">No results found</div>' : '<div class="recent-empty" id="suggestions-loading"><span class="suggestions-spinner"></span> Searching…</div>');

    box.innerHTML = recentHtml + suggestionsHtml;
    box.style.display = 'block';
}

function pickSuggestion(id, mediaType, title) {
    document.getElementById('search-input').value = title;
    document.getElementById('recent-searches').style.display = 'none';
    saveRecentSearch(title);
    openDetail(id, mediaType);
}

function setSearchTitle(text) {
    const el = document.getElementById('search-query-display');
    if (!el) return;
    el.classList.add('title-changing');
    setTimeout(() => {
        el.textContent = text;
        el.classList.remove('title-changing');
    }, 180);
}

// ─── RECENT SEARCHES ───
function saveRecentSearch(query) {SV.searches.add(query);}
function getRecentSearches() {return SV.searches.get();}
function clearRecentSearches() {SV.searches.clear(); document.getElementById('recent-searches').style.display = 'none';}

function showRecentSearches() {
    const recent = getRecentSearches();
    const box = document.getElementById('recent-searches');
    const current = document.getElementById('search-input').value.trim();
    if (current) return;
    box.innerHTML = recent.length ? `
        <div class="recent-header">
            <span>Recent Searches</span>
            <button class="recent-clear" onmousedown="event.preventDefault();clearRecentSearches()">Clear all</button>
        </div>
        ${recent.map(q => `
            <button class="recent-item" onmousedown="event.preventDefault();pickRecentSearch('${q.replace(/'/g, "\\'")}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span>${esc(q)}</span>
                <svg class="recent-item-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>`).join('')}`
        : '<div class="recent-empty">Start typing to search movies & shows</div>';
    box.style.display = 'block';
}

function hideRecentSearches() {
    setTimeout(() => {
        document.getElementById('recent-searches').style.display = 'none';
    }, 200);
}

function pickRecentSearch(query) {
    document.getElementById('search-input').value = query;
    document.getElementById('recent-searches').style.display = 'none';
    doSearch(query);
}

// ─── GENRE FILTER ───
function filterGenre(genre) {
    activeGenre = genre;
    document.querySelectorAll('.genre-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.genre === genre));
    const filtered = genre === 'all' ? allResults
        : allResults.filter(item => {
            const ids = genre.split(',').map(Number);
            return (item.genre_ids || []).some(g => ids.includes(g));
        });
    const container = document.getElementById('search-results');
    container.innerHTML = '';
    if (!filtered.length) {
        container.innerHTML = '<div class="empty-state"><div class="icon">🎬</div><p>No results in this genre.</p></div>';
    } else {
        filtered.forEach((item, i) => container.appendChild(makeCard(item, i)));
    }
    document.getElementById('search-count').textContent = `${filtered.length} results`;
}

// ─── PLAYER SKELETON ───
function showPlayerSkeleton() {
    document.getElementById('player-title').innerHTML = '<div class="skeleton" style="height:40px;width:60%;border-radius:6px;"></div>';
    document.getElementById('player-meta').innerHTML = Array(4).fill('<div class="skeleton" style="height:20px;width:80px;border-radius:4px;"></div>').join('');
    document.getElementById('player-overview').innerHTML =
        '<div class="skeleton" style="height:16px;width:100%;border-radius:4px;margin-bottom:8px;"></div><div class="skeleton" style="height:16px;width:90%;border-radius:4px;margin-bottom:8px;"></div><div class="skeleton" style="height:16px;width:75%;border-radius:4px;"></div>';
    document.getElementById('cast-section').style.display = 'none';
    document.getElementById('collection-section').style.display = 'none';
    document.getElementById('player-networks').style.display = 'none';
}

function renderSkeletons(containerId, count = 10) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const skeletons = Array(count).fill(0).map(() => `<div class="skeleton skel-card"></div>`).join('');
    container.innerHTML = skeletons;
}

// ─── DETAIL / PLAYER ───
async function openDetail(id, mediaType, autoPlay = false, fromRoute = false) {
    if (_detailAbortController) _detailAbortController.abort();
    _detailAbortController = new AbortController();
    const signal = _detailAbortController.signal;
    showPage('player-page');
    window.scrollTo(0, 0);
    showPlayerSkeleton();
    document.getElementById('player-meta').innerHTML = '';
    document.getElementById('player-overview').textContent = '';
    document.getElementById('episodes-section').style.display = 'none';
    document.getElementById('similar-row').innerHTML = '';
    document.getElementById('next-ep-bar').style.display = 'none';
    document.getElementById('collection-section').style.display = 'none';
    switchDetailTab('cast', document.querySelector('.pd-tab[data-tab="cast"]'));
    document.getElementById('tab-collection').style.display = 'none';
    try {
        const detail = await tmdb(`/${mediaType}/${id}`, { append_to_response: 'external_ids,similar,credits' }, signal);
        if (signal.aborted) return;
        const imdb = detail.external_ids?.imdb_id || null;
        const title = detail.title || detail.name;
        const slug = slugify(title);
        const year = (detail.release_date || detail.first_air_date || '').slice(0, 4);
        const rating = detail.vote_average ? detail.vote_average.toFixed(1) : '—';
        const t = _pendingTimestamp || 0;
        _pendingTimestamp = 0;
        const runtime = detail.runtime ? `${detail.runtime}min` : (detail.episode_run_time?.[0] ? `${detail.episode_run_time[0]}min/ep` : '');

        document.getElementById('player-title').textContent = title;
        window._currentDetailPoster = detail.poster_path || null;
        updateMyListBtn(id);

        if (detail.genres?.length) {
            const h = JSON.parse(localStorage.getItem('sv_history') || '{}');
            if (h[id]) {
                h[id].genre_ids = detail.genres.map(g => g.id);
                localStorage.setItem('sv_history', JSON.stringify(h));
            }
            window._pendingGenreIds = { id, genre_ids: detail.genres.map(g => g.id) };
        }
        const metaEl = document.getElementById('player-meta');
        metaEl.innerHTML = `<span>${year}</span>${runtime ? `<span>${runtime}</span>` : ''}<span class="rating">${starIcon()} ${rating}</span>`;
        (detail.genres || []).slice(0, 3).forEach(g => {
            const btn = document.createElement('button');
            btn.className = 'tag-link';
            btn.innerHTML = `${icon('filter', 10)} ${esc(g.name)}`;
            btn.addEventListener('click', () => browseGenre(g.id, g.name));
            btn.addEventListener('contextmenu', e => { e.preventDefault(); showCardContextMenu(e, `/?browse=filter&type=all&genre=${g.id}`, g.name); });
            metaEl.appendChild(btn);
        });
        document.getElementById('player-overview').textContent = detail.overview || '';
        renderCast(detail.credits?.cast || []);
        const belongsTo = mediaType === 'movie' ? detail.belongs_to_collection : null;
        if (belongsTo) saveDiscoveredCollection(belongsTo);
        renderCollection(belongsTo, id);
        renderNetworks(detail.networks || [], detail.production_companies || [], mediaType);

        if (detail.backdrop_path)
            document.getElementById('player-container').style.background = `url(${backdropUrl(detail.backdrop_path)}) center/cover`;
        if (mediaType === 'movie') {
            if (!fromRoute) pushState({ type: 'movie', id, name: slug });
            currentSource = 'primesrc';
            currentEmbed = { type: 'movie', imdb, tmdbId: id, season: null, episode: null };
            document.querySelectorAll('.src-btn').forEach(b => b.classList.toggle('active', b.dataset.src === 'primesrc'));
            document.getElementById('source-bar').style.display = 'flex';
            const iframe = document.getElementById('player-iframe');
            if (iframe && !pendingWatchTogetherStartAt) { iframe.src = buildEmbedUrl('primesrc', 'movie', imdb, id, null, null, t); addIframeBlocker(); }
            startWatchTimer(id, 'movie', { id, type: 'movie', title, poster: detail.poster_path, year, runtime: detail.runtime || 90 });
        } else {
            const isNewShow = !currentShow || currentShow.id !== id;
            if (isNewShow) {
                currentSource = 'primesrc';
                document.querySelectorAll('.src-btn').forEach(b => b.classList.toggle('active', b.dataset.src === 'primesrc'));
            }
            currentShow = { id, detail, imdb, slug };
            const startS = _pendingEp?.season || 1;
            const startE = _pendingEp?.episode || 1;
            _pendingEp = null;
            currentSeason = startS;
            document.getElementById('episodes-section').style.display = 'block';
            renderSeasons(detail, imdb, id, startS);
            if (!fromRoute) pushState({ type: 'tv', id, name: slug, season: startS, episode: startE });
            loadEpisode(startS, startE, imdb, id, true, t);
        }
        const similar = (detail.similar?.results || []).slice(0, 18);
        if (similar.length) {
            const grid = document.getElementById('similar-row');
            grid.innerHTML = '';
            similar.map(r => ({ ...r, media_type: mediaType })).forEach((item, i) => grid.appendChild(makeCard(item, i)));
        }
        if (pendingWatchTogetherStartAt) {
            const sat = pendingWatchTogetherStartAt;
            pendingWatchTogetherStartAt = null;
            startWatchTogetherCountdown(sat);
        }
    } catch (e) {
        _pendingTimestamp = 0;
        _pendingEp = null;
        if (e.name === 'AbortError') return;
        document.getElementById('player-title').textContent = 'Failed to load';
    }
}

function showAutoplayOverlay(nextTitle) {
    const overlay = document.getElementById('next-ep-autoplay');
    const titleEl = document.getElementById('next-ep-title');
    const progressCircle = document.getElementById('autoplay-progress');
    const numEl = document.getElementById('autoplay-num');
    titleEl.textContent = nextTitle;
    overlay.classList.remove('hidden');
    let timeLeft = 10;
    const totalOffset = 113;
    autoplayTimer = setInterval(() => {
        timeLeft--;
        numEl.textContent = timeLeft;
        progressCircle.style.strokeDashoffset = totalOffset - (totalOffset * (10 - timeLeft) / 10);
        if (timeLeft <= 0) {
            triggerNextEpisode();
        }
    }, 1000);
}

// ─── SEASONS & EPISODES ───
function renderSeasons(detail, imdb, tmdbId, activeSeason = 1) {
    const seasons = (detail.seasons || []).filter(s => s.season_number > 0);
    const sel = document.getElementById('season-selector');
    sel.innerHTML = '';
    seasons.forEach(s => {
        const btn = document.createElement('button');
        btn.className = `season-btn${s.season_number === activeSeason ? ' active' : ''}`;
        btn.id = `s-btn-${s.season_number}`;
        btn.textContent = `Season ${s.season_number}`;
        btn.addEventListener('click', () => selectSeason(s.season_number, s.episode_count, imdb, tmdbId));
        btn.addEventListener('contextmenu', e => { e.preventDefault(); showCardContextMenu(e, `/?type=tv&id=${tmdbId}&name=${currentShow?.slug || ''}&season=${s.season_number}&episode=1`, `Season ${s.season_number}`); });
        sel.appendChild(btn);
    });
    const active = seasons.find(s => s.season_number === activeSeason) || seasons[0];
    if (active) renderEpisodes(active.episode_count, activeSeason, imdb, tmdbId);
    setTimeout(() => {document.getElementById(`s-btn-${activeSeason}`)?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });}, 50);
}

function selectSeason(num, count, imdb, tmdbId) {
    currentSeason = num;
    document.querySelectorAll('.season-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`s-btn-${num}`)?.classList.add('active');
    renderEpisodes(count, num, imdb, tmdbId);
    loadEpisode(num, 1, imdb, tmdbId);
}

async function renderEpisodes(count, season, imdb, tmdbId, activeEp = 1) {
    const h = SV.history.get();
    const showId = currentShow?.id;
    const watchedEps = new Set();
    if (showId && h[showId]) {
        const entry = h[showId];
        if (entry.season === season) {
            for (let e = 1; e <= entry.episode; e++) watchedEps.add(e);
        } else if (entry.season > season) {
            for (let e = 1; e <= count; e++) watchedEps.add(e);
        }
    }

    let airDates = {};
    try {
        const seasonData = await tmdb(`/tv/${tmdbId}/season/${season}`);
        const todayStr = new Date().toISOString().slice(0, 10);
        (seasonData.episodes || []).forEach(ep => {
            if (ep.air_date) {
                airDates[ep.episode_number] = { date: ep.air_date, future: ep.air_date > todayStr };
            }
        });
    } catch { }

    const grid = document.getElementById('episodes-grid');
    grid.innerHTML = '';
    Array.from({ length: count }, (_, i) => i + 1).forEach(ep => {
        const watched = watchedEps.has(ep);
        const info = airDates[ep];
        const unreleased = info?.future === true;
        const btn = document.createElement('button');
        btn.className = `ep-btn${ep === activeEp ? ' active' : ''}${watched ? ' ep-watched' : ''}${unreleased ? ' ep-unreleased' : ''}`;
        btn.id = `ep-btn-${season}-${ep}`;
        btn.disabled = unreleased;
        if (unreleased) {
            const dateStr = info.date ? new Date(info.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
            btn.innerHTML = `Ep ${ep}<span class="ep-unreleased-label">${dateStr ? dateStr : 'Unreleased'}</span>`;
            btn.title = `Not released yet${info.date ? ' — ' + info.date : ''}`;
        } else {
            btn.innerHTML = `Ep ${ep}${watched ? '<span class="ep-check">✓</span>' : ''}`;
            btn.addEventListener('click', () => loadEpisode(season, ep, imdb, tmdbId));
            btn.addEventListener('contextmenu', e => { e.preventDefault(); showCardContextMenu(e, `/?type=tv&id=${tmdbId}&name=${currentShow?.slug || ''}&season=${season}&episode=${ep}`, `S${season} E${ep}`); });
        }
        grid.appendChild(btn);
    });
}

function loadEpisode(season, episode, imdb, tmdbId, skipPush = false, t = 0) {
    document.querySelectorAll('.ep-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`ep-btn-${season}-${episode}`)?.classList.add('active');
    currentEmbed = { type: 'tv', imdb, tmdbId, season, episode };
    document.querySelectorAll('.src-btn').forEach(b => b.classList.toggle('active', b.dataset.src === currentSource));
    document.getElementById('source-bar').style.display = 'flex';
    const iframe = document.getElementById('player-iframe');
    if (iframe && !pendingWatchTogetherStartAt) {
        iframe.src = buildEmbedUrl(currentSource, 'tv', imdb, tmdbId, season, episode, t);
        addIframeBlocker();
    }
    document.getElementById('player-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!skipPush && currentShow) {
        const slug = currentShow.slug || slugify(currentShow.detail?.name || '');
        pushState({ type: 'tv', id: tmdbId, name: slug, season, episode });
    }
    if (currentShow) {
        startWatchTimer(currentShow.id, 'tv', {
            id: currentShow.id,
            type: 'tv',
            title: currentShow.detail.name,
            poster: currentShow.detail.poster_path,
            year: (currentShow.detail.first_air_date || '').slice(0, 4),
            season,
            episode,
            epRuntime: currentShow.detail.episode_run_time?.[0] || 40
        });
    }

    // ── Next episode button ──
    const seasons = currentShow?.detail?.seasons?.filter(s => s.season_number > 0) || [];
    const currentSeasonData = seasons.find(s => s.season_number === season);
    const totalEps = currentSeasonData?.episode_count || 0;
    const nextSeason = seasons.find(s => s.season_number === season + 1);
    const bar = document.getElementById('next-ep-bar');
    const barTop = document.getElementById('next-ep-bar-top');
    const nbtn = document.getElementById('next-ep-btn');
    const nextIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/><line x1="19" y1="3" x2="19" y2="21" stroke="currentColor" stroke-width="2"/></svg>`;
    if (episode < totalEps) {
        nbtn.dataset.season = season;
        nbtn.dataset.episode = episode + 1;
        nbtn.innerHTML = `${nextIcon} S${season} E${episode + 1}`;
        nbtn.oncontextmenu = e => { e.preventDefault(); showCardContextMenu(e, `/?type=tv&id=${tmdbId}&name=${currentShow?.slug || ''}&season=${season}&episode=${episode + 1}`, `S${season} E${episode + 1}`); };
        bar.style.display = 'block';
        if (barTop) barTop.style.display = 'block';
    } else if (nextSeason) {
        nbtn.dataset.season = season + 1;
        nbtn.dataset.episode = 1;
        nbtn.innerHTML = `${nextIcon} Season ${season + 1} E1`;
        nbtn.oncontextmenu = e => { e.preventDefault(); showCardContextMenu(e, `/?type=tv&id=${tmdbId}&name=${currentShow?.slug || ''}&season=${season + 1}&episode=1`, `Season ${season + 1} E1`); };
        bar.style.display = 'block';
        if (barTop) barTop.style.display = 'block';
    } else {
        bar.style.display = 'none';
        if (barTop) barTop.style.display = 'none';
    }
}

function playNextEpisode() {
    if (!currentShow) return;
    const btn = document.getElementById('next-ep-btn');
    const season = parseInt(btn.dataset.season);
    const episode = parseInt(btn.dataset.episode);
    loadEpisode(season, episode, currentShow.imdb, currentShow.id);
    document.getElementById('player-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function triggerNextEpisode() {
    cancelAutoplay();
    const btn = document.querySelector('[onclick="nextEpisode()"]');
    if (btn) btn.click();
}

function cancelAutoplay() {
    clearInterval(autoplayTimer);
    document.getElementById('next-ep-autoplay').classList.add('hidden');
    document.getElementById('autoplay-progress').style.strokeDashoffset = 113;
}

// ─── MOBILE TAB SWITCHING ───
function setMobileTab(id) {
    document.querySelectorAll('.mobile-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
}

function focusMobileSearch() {
    showPage('search-page');
    document.getElementById('search-query-display').textContent = 'Search';
    document.getElementById('search-count').textContent = '';
    document.getElementById('search-results').innerHTML = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => document.getElementById('search-input').focus(), 300);
}

// ─── CAST ───
function renderCast(cast) {
    const section = document.getElementById('cast-section');
    const row = document.getElementById('cast-row');
    const top = cast.slice(0, 20);
    if (!top.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    row.innerHTML = '';
    top.forEach(actor => {
        const div = document.createElement('div');
        div.className = 'cast-card';
        const photo = actor.profile_path ? `${TMDB_IMG}w185${actor.profile_path}` : null;
        div.innerHTML = photo
            ? `<img class="cast-avatar" src="${photo}" alt="${esc(actor.name)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
        <div class="cast-avatar-placeholder" style="display:none">👤</div>`
            : `<div class="cast-avatar-placeholder">👤</div>`;
        div.innerHTML += ` <div class="cast-name">${esc(actor.name)}</div> <div class="cast-character">${esc(actor.character)}</div>`;
        div.addEventListener('contextmenu', e => {
            e.preventDefault();
            showCastContextMenu(e, actor.name);
        });
        row.appendChild(div);
    });
}

// ─── SOURCE SWITCHER ───
function buildEmbedUrl(source, type, imdb, tmdbId, season, episode, t = 0) {
    const id = imdb && imdb !== 'null' ? imdb : null;
    if (type === 'movie') {
        switch (source) {
            case 'primesrc': return id ? `https://primesrc.me/embed/movie?imdb=${id}&t=${t}` : `https://primesrc.me/embed/movie?tmdb=${tmdbId}&t=${t}`;
            case 'embed2': return `https://www.2embed.cc/embed/${id ?? tmdbId}`;
            case 'moviesapi': return `https://moviesapi.club/movie/${id ?? tmdbId}`;
        }
    } else {
        switch (source) {
            case 'primesrc': return id ? `https://primesrc.me/embed/tv?imdb=${id}&season=${season}&episode=${episode}&t=${t}` : `https://primesrc.me/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}&t=${t}`;
            case 'embed2': return `https://www.2embed.cc/embedtv/${id ?? tmdbId}&s=${season}&e=${episode}`;
            case 'moviesapi': return `https://moviesapi.club/tv/${id ?? tmdbId}-${season}-${episode}`;
        }
    }
}

function switchSource(source) {
    currentSource = source;
    localStorage.setItem('sv_source', source);
    document.querySelectorAll('.src-btn').forEach(b => b.classList.toggle('active', b.dataset.src === source));
    const { type, imdb, tmdbId, season, episode } = currentEmbed;
    if (!type) return;
    const url = buildEmbedUrl(source, type, imdb, tmdbId, season, episode);
    document.getElementById('player-iframe').src = url;
    addIframeBlocker();
}

// ─── FULLSCREEN TOGGLE ───
function toggleFullscreen() {
    const container = document.getElementById('player-container');
    const btn = document.getElementById('fullscreen-btn');
    const enterIcon = document.getElementById('fullscreen-icon-enter');
    const exitIcon = document.getElementById('fullscreen-icon-exit');
    if (!document.fullscreenElement) {
        if (container.requestFullscreen) {
            container.requestFullscreen().catch(err => console.error('Fullscreen failed:', err));
        } else if (container.webkitRequestFullscreen) {
            container.webkitRequestFullscreen().catch(err => console.error('Fullscreen failed:', err));
        } else if (container.msRequestFullscreen) {
            container.msRequestFullscreen().catch(err => console.error('Fullscreen failed:', err));
        }
        isFullscreen = true;
        enterIcon.style.display = 'none';
        exitIcon.style.display = 'block';
        btn.title = 'Exit Fullscreen (Esc)';
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
        isFullscreen = false;
        enterIcon.style.display = 'block';
        exitIcon.style.display = 'none';
        btn.title = 'Toggle Fullscreen (F)';
    }
}

document.addEventListener('fullscreenchange', updateFullscreenIcon);
document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
document.addEventListener('msfullscreenchange', updateFullscreenIcon);

function updateFullscreenIcon() {
    const container = document.getElementById('player-container');
    const enterIcon = document.getElementById('fullscreen-icon-enter');
    const exitIcon = document.getElementById('fullscreen-icon-exit');
    const btn = document.getElementById('fullscreen-btn');
    isFullscreen = !!document.fullscreenElement;
    enterIcon.style.display = isFullscreen ? 'none' : 'block';
    exitIcon.style.display = isFullscreen ? 'block' : 'none';
    btn.title = isFullscreen ? 'Exit Fullscreen (Esc)' : 'Toggle Fullscreen (F)';
}

function addIframeBlocker() {
    const container = document.getElementById('player-container');
    const existing = document.getElementById('iframe-blocker');
    if (existing) existing.remove();
    const blocker = document.createElement('div');
    blocker.id = 'iframe-blocker';
    blocker.style.cssText = `position: absolute; inset: 0; z-index: 10; cursor: pointer; background: transparent;`;
    blocker.addEventListener('click', () => { blocker.remove(); });
    container.appendChild(blocker);
}

// Keyboard shortcut
document.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;
    const onPlayer = document.getElementById('player-page')?.classList.contains('active');

    // Fullscreen — player only
    if (onPlayer && !typing && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFullscreen();
        return;
    }

    // Escape — close any open overlays
    if (e.key === 'Escape') {
        const importOverlay = document.getElementById('import-overlay');
        const exportOverlay = document.getElementById('export-overlay');
        if (importOverlay && importOverlay.style.display !== 'none') { closeImportCard(); return; }
        if (exportOverlay && exportOverlay.style.display !== 'none') { closeExportCard(); return; }
        closeShortcuts();
        return;
    }

    // Focus search
    if (e.key === '/' && !typing) {
        e.preventDefault();
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            if (document.getElementById('search-page').style.display === 'none') showPage('search-page');
            window.scrollTo({ top: 0, behavior: 'smooth' });
            searchInput.focus();
        }
        return;
    }

    // Shortcuts modal
    if (e.key === '?' && !typing) {
        e.preventDefault();
        openShortcuts();
        return;
    }

    // Nav shortcuts — ignore when typing
    if (typing || e.ctrlKey || e.metaKey) return;
    if (e.key.toLowerCase() === 'h') showHome();
    if (e.key.toLowerCase() === 'l') showMyList();
    if (e.key.toLowerCase() === 's') showStats();
    if (e.key.toLowerCase() === 'c') showCollections();
});

document.addEventListener('click', e => {
    const box = document.getElementById('recent-searches');
    const input = document.getElementById('search-input');
    if (!box.contains(e.target) && e.target !== input) {box.style.display = 'none';}
    if (!e.target.closest('.cw-poster-wrap')) {document.querySelectorAll('.cw-poster-wrap.is-touching').forEach(el => el.classList.remove('is-touching'));}
});

// ─── NETWORKS & GENRES ───
function renderNetworks(networks, companies, mediaType) {
    const el = document.getElementById('player-networks');
    const KNOWN = {
        // Network IDs (TV)
        213: 'Netflix',
        1024: 'Amazon',
        49: 'HBO',
        2739: 'Disney+',
        453: 'Hulu',
        2552: 'Apple TV+',
        56: 'Cartoon Network',
        21: 'AMC',
        16: 'NBC',
        6: 'NBC',
        19: 'FOX',
        3186: 'Crunchyroll',
        4353: 'Paramount+',
        // Company IDs (Movies)
        420: 'Marvel Studios',
        174: 'Warner Bros.',
        34: 'Sony Pictures',
        33: 'Universal',
        4: 'Paramount',
        2: 'Walt Disney',
        521: 'A24',
        923: 'Legendary',
        7295: 'Blumhouse',
        9996: 'DC Films',
        82968: 'Amazon Studios',
    };
    const tags = [];
    // TV networks
    networks.slice(0, 3).forEach(n => { tags.push({ label: KNOWN[n.id] || n.name, type: 'network', id: n.id, mediaType: 'tv' }); });
    // Movie companies
    if (mediaType === 'movie') {
        companies.slice(0, 3).forEach(c => { if (KNOWN[c.id]) { tags.push({ label: KNOWN[c.id], type: 'company', id: c.id, mediaType: 'movie' }); } });
    }
    if (!tags.length) { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    el.innerHTML = `<span style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;margin-right:4px;">On</span>`;
    tags.forEach(t => {
        const btn = document.createElement('button');
        btn.className = 'tag-link';
        btn.innerHTML = `${icon('globe', 10)} ${esc(t.label)}`;
        btn.addEventListener('click', () => browseNetwork(t.id, t.label, t.type, t.mediaType));
        btn.addEventListener('contextmenu', e => { e.preventDefault(); showCardContextMenu(e, `/?browse=filter&network=${t.id}&networkType=${t.type}`, t.label); });
        el.appendChild(btn);
    });
}

async function browseGenre(genreId, genreName) {
    _resetSectionState();
    showPage('search-page');
    document.getElementById('search-input').value = genreName;
    document.getElementById('search-query-display').textContent = genreName;
    document.getElementById('search-count').textContent = 'Loading…';
    document.getElementById('search-results').innerHTML = '<div class="spinner"></div>';
    document.getElementById('filter-toggle').style.cssText = 'display:flex;margin-bottom:16px;';
    setActiveTab('');
    try {
        const [movies, shows] = await Promise.all([
            tmdb('/discover/movie', { with_genres: genreId, sort_by: 'popularity.desc', page: 1 }),
            tmdb('/discover/tv', { with_genres: genreId, sort_by: 'popularity.desc', page: 1 })
        ]);
        allResults = [
            ...movies.results.map(r => ({ ...r, media_type: 'movie' })),
            ...shows.results.map(r => ({ ...r, media_type: 'tv' }))
        ].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

        activeGenre = 'all';
        document.querySelectorAll('.genre-btn').forEach(b => b.classList.toggle('active', b.dataset.genre === 'all'));
        document.getElementById('genre-bar').style.display = 'flex';
        document.getElementById('search-count').textContent = `${allResults.length} results`;
        renderCards('search-results', allResults);
    } catch (e) {
        document.getElementById('search-results').innerHTML = '<div class="empty-state"><p>Failed to load.</p></div>';
    }
}

async function browseNetwork(networkId, networkName, type, mediaType) {
    _resetSectionState();
    showPage('search-page');
    document.getElementById('search-input').value = networkName;
    document.getElementById('search-query-display').textContent = networkName;
    document.getElementById('search-count').textContent = 'Loading…';
    document.getElementById('search-results').innerHTML = '<div class="spinner"></div>';
    document.getElementById('filter-toggle').style.cssText = 'display:flex;margin-bottom:16px;';
    setActiveTab('');
    try {
        const param = type === 'network' ? 'with_networks' : 'with_companies';
        const endpoint = mediaType === 'tv' ? '/discover/tv' : '/discover/movie';
        const data = await tmdb(endpoint, { [param]: networkId, sort_by: 'popularity.desc', page: 1 });

        allResults = data.results.map(r => ({ ...r, media_type: mediaType }));
        currentSection = { mode: 'network', networkId, type, mediaType, param };
        hasMorePages = data.total_pages > 1;
        activeGenre = 'all';
        document.querySelectorAll('.genre-btn').forEach(b => b.classList.toggle('active', b.dataset.genre === 'all'));
        document.getElementById('genre-bar').style.display = 'flex';
        document.getElementById('search-count').textContent = `${data.total_results} titles`;
        renderCards('search-results', allResults);
        const el = document.getElementById('search-results');
        el.insertAdjacentHTML('afterend', '<div id="scroll-sentinel"></div>');
        attachScrollObserver();
    } catch (e) {
        document.getElementById('search-results').innerHTML = '<div class="empty-state"><p>Failed to load.</p></div>';
    }
}

// ─── INFINITE SCROLL ───
async function loadMoreResults() {
    if (isLoadingMore || !hasMorePages || !currentSection) return;
    isLoadingMore = true;
    const sentinel = document.getElementById('scroll-sentinel');
    if (sentinel) sentinel.innerHTML = '<div class="spinner" style="margin:20px auto;width:28px;height:28px;"></div>';

    try {
        let data;
        const { mediaType, mode, query } = currentSection;
        if (mode === 'search') {
            data = await tmdb('/search/multi', { query, page: currentPage + 1 });
        } else if (mode === 'network') {
            const { networkId, type, mediaType: mt, param } = currentSection;
            const endpoint = mt === 'tv' ? '/discover/tv' : '/discover/movie';
            data = await tmdb(endpoint, { [param]: networkId, sort_by: 'popularity.desc', page: currentPage + 1 });
            data.results = data.results.map(r => ({ ...r, media_type: mt }));
        } else {
            data = await tmdb(`/${mediaType}/popular`, { page: currentPage + 1 });
        }
        currentPage++;
        hasMorePages = currentPage < data.total_pages;

        const items = mode === 'search' ? data.results.filter(r => r.media_type === 'movie' || r.media_type === 'tv') : data.results.map(r => ({ ...r, media_type: mediaType }));
        const container = document.getElementById('search-results');
        items.forEach((item, i) => {
            const uniqueId = `${item.media_type}-${item.id}`;
            if (!loadedIds.has(uniqueId)) {
                loadedIds.add(uniqueId);
                container.appendChild(makeCard(item, i));
            }
        });
    } catch (e) { }

    isLoadingMore = false;
    const sentinel2 = document.getElementById('scroll-sentinel');
    if (sentinel2) sentinel2.innerHTML = hasMorePages ? '' : '<p style="text-align:center;color:var(--text3);font-size:13px;padding:24px">No more results</p>';
}

const scrollObserver = new IntersectionObserver(entries => { if (entries[0].isIntersecting) loadMoreResults(); }, { rootMargin: '200px' });
function attachScrollObserver() {
    const sentinel = document.getElementById('scroll-sentinel');
    if (sentinel) scrollObserver.observe(sentinel);
}

// ─── WATCH HISTORY ───
function saveHistory(item) {SV.history.add(item);}
function getHistory() {return SV.history.values();}

function clearHistoryItem(id) {
    const prev = SV.history.get();
    SV.history.remove(id);
    renderContinueWatching();
    showUndoToast('Removed from Continue Watching', () => {
        SV.history.set(prev);
        renderContinueWatching();
    });
}

function renderContinueWatching() {
    const section = document.getElementById('continue-watching-section');
    const row = document.getElementById('continue-watching-row');
    const items = getHistory().slice(0, 14);

    if (!items.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    row.innerHTML = '';

    items.forEach((item, i) => {
        const div = document.createElement('div');
        div.className = 'card';
        div.style.animationDelay = `${i * 0.04}s`;
        div.style.position = 'relative';

        const poster = posterUrl(item.poster);
        const sub = item.type === 'tv' ? `S${item.season} E${item.episode}` : item.year || '';
        const timestamp = item.timestamp || 0;
        const runtime = item.type === 'movie' ? (item.runtime || 90) * 60 : (item.epRuntime || 40) * 60;
        const pct = runtime > 0 ? Math.min(Math.round((timestamp / runtime) * 100), 99) : 0;
        const placeholderIcon =
            `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
        const posterWrapHtml = poster
            ? `<img class="card-poster" src="${poster}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
            <div class="card-poster-placeholder" style="display:none">${placeholderIcon}<span>${esc(item.title)}</span></div>`
            : `<div class="card-poster-placeholder">${placeholderIcon}<span>${esc(item.title)}</span></div>`;

        const inListNow = isInMyList(item.id);
        div.innerHTML = `
            <div class="cw-poster-wrap" style="position:relative;cursor:pointer;">
                ${posterWrapHtml}
                ${pct > 0 ? `<div class="card-progress"><div class="card-progress-fill" style="width:${pct}%"></div></div>` : ''}
                <div class="cw-hover-overlay">
                    <div class="cw-hover-left">
                        <button class="cw-hover-btn cw-play-btn" title="Play">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </button>
                        <button class="cw-hover-btn cw-list-btn" title="My List" data-in-list="${inListNow}"> ${inListNow
                ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`
                : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`
            }
                        </button>
                    </div>
                    <div class="cw-hover-right">
                        <button class="cw-hover-btn cw-detail-btn" title="Details">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        </button>
                    </div>
                </div>
            </div>
            <div class="card-info">
                <div class="card-title">${esc(item.title)}</div>
                <div class="card-meta">
                    <span style="color:var(--gold);font-size:11px">${esc(sub)}</span>
                    <button class="cw-remove-btn" style="position:relative;z-index:2;"> ✕ </button>
                </div>
            </div>`;

        div.querySelector('.cw-remove-btn').addEventListener('click', e => {
            e.stopPropagation();
            clearHistoryItem(item.id);
        });

        const posterWrap = div.querySelector('.cw-poster-wrap');
        posterWrap.addEventListener('click', e => {
            if (e.target.closest('.cw-hover-btn')) return;
            openQuickDetail(item.id, item.type, {
                id: item.id,
                title: item.title,
                name: item.title,
                poster_path: item.poster,
                release_date: item.year ? `${item.year}-01-01` : '',
                first_air_date: item.year ? `${item.year}-01-01` : '',
                media_type: item.type
            });
        });

        div.querySelector('.cw-play-btn').addEventListener('click', e => {
            e.stopPropagation();
            savedScrollY = window.scrollY;
            const resumeAt = item.timestamp || 0;
            if (item.type === 'tv') {
                _pendingEp = { season: item.season, episode: item.episode };
                _pendingTimestamp = resumeAt;
            } else {
                _pendingTimestamp = resumeAt;
            }
            openDetail(item.id, item.type, true, false);
        });

        const listBtn = div.querySelector('.cw-list-btn');
        listBtn.addEventListener('click', e => {
            e.stopPropagation();
            let list = getMyList();
            if (isInMyList(item.id)) {
                saveMyList(list.filter(i => i.id !== item.id));
                listBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
                listBtn.dataset.inList = 'false';
                showToast('Removed from My List');
            } else {
                saveMyList([{ id: item.id, type: item.type, title: item.title, year: item.year, poster: item.poster || null, addedAt: Date.now() }, ...list]);
                listBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`;
                listBtn.dataset.inList = 'true';
                showToast('Added to My List');
            }
        });

        div.querySelector('.cw-detail-btn').addEventListener('click', e => {
            e.stopPropagation();
            openQuickDetail(item.id, item.type, {
                id: item.id,
                title: item.title,
                name: item.title,
                poster_path: item.poster,
                release_date: item.year ? `${item.year}-01-01` : '',
                first_air_date: item.year ? `${item.year}-01-01` : '',
                media_type: item.type
            });
        });
        div.addEventListener('contextmenu', e => {
            e.preventDefault();
            showCardContextMenu(e, `/?type=${item.type}&id=${item.id}&name=${slugify(item.title || '')}`, item.title || '');
        });
        row.appendChild(div);
    });
}

function startWatchTimer(id, type, pendingHistoryItem = null) {
    stopWatchTimer();
    watchStart = null;
    let historySaved = pendingHistoryItem === null;
    watchTimer = setInterval(() => {
        if (!watchStart) watchStart = Date.now();
        const elapsed = Math.floor((Date.now() - watchStart) / 1000);
        if (!historySaved && elapsed >= 180) {
            saveHistory(pendingHistoryItem);
            historySaved = true;
            renderContinueWatching();
        }
        if (historySaved) {
            const h = SV.history.get();
            if (h[id]) {
                h[id].timestamp = elapsed;
                SV.history.set(h);
            }
        }
    }, 20000);
}

function stopWatchTimer() {
    clearInterval(watchTimer);
    watchTimer = null;
    watchStart = null;
}

// ─── SCROLL TO TOP BUTTON ───
let _scrollRaf = false;
window.addEventListener('scroll', () => {
    if (_scrollRaf) return;
    _scrollRaf = true;
    requestAnimationFrame(() => {
        document.getElementById('scroll-top').classList.toggle('visible', window.scrollY > 400);
        _scrollRaf = false;
    });
}, {passive: true});

// ─── SECTION VIEW ───
async function fetchSection(mediaType) {
    _resetSectionState();
    showPage('search-page');
    pushState({ browse: mediaType });
    document.getElementById('filter-toggle').style.cssText = 'display:flex;margin-bottom:16px;';
    const label = mediaType === 'movie' ? 'Movies' : 'TV Shows';
    const input = document.getElementById('search-input');
    input.value = '';
    input.placeholder = 'Search movies, shows…';
    document.getElementById('search-query-display').textContent = label;
    document.getElementById('search-count').textContent = 'Loading…';
    document.getElementById('search-results').innerHTML = '<div class="spinner"></div>';
    setActiveTab(mediaType === 'movie' ? 'tab-movies' : 'tab-tv');
    try {
        const data = await tmdb(`/discover/${mediaType}`, { sort_by: 'popularity.desc', 'vote_count.gte': 100, page: 1 });
        document.getElementById('search-count').textContent = `${data.total_results} titles`;
        allResults = data.results.map(r => ({ ...r, media_type: mediaType }));
        currentSection = { mode: 'section', mediaType };
        hasMorePages = data.total_pages > 1;
        activeGenre = 'all';
        document.querySelectorAll('.genre-btn').forEach(b => b.classList.toggle('active', b.dataset.genre === 'all'));
        document.getElementById('genre-bar').style.display = 'flex';
        renderCards('search-results', allResults);
        const el = document.getElementById('search-results');
        el.insertAdjacentHTML('afterend', '<div id="scroll-sentinel"></div>');
        attachScrollObserver();
        _renderHiddenCount();
    } catch (e) { }
}

// ─── COLLECTION ───
async function renderCollection(belongsToCollection, currentId) {
    const section = document.getElementById('collection-section');
    const tabBtn = document.getElementById('tab-collection');
    if (!belongsToCollection) { section.style.display = 'none'; tabBtn.style.display = 'none'; return; }
    try {
        const data = await tmdb(`/collection/${belongsToCollection.id}`);
        const parts = (data.parts || [])
            .sort((a, b) => (a.release_date || '').localeCompare(b.release_date || ''));
        if (parts.length <= 1) { section.style.display = 'none'; tabBtn.style.display = 'none'; return; }
        document.getElementById('collection-title').textContent = data.name || 'Part of a Collection';
        const row = document.getElementById('collection-row');
        row.innerHTML = '';
        parts.forEach((item, i) => {
            const isCurrent = item.id === currentId;
            const card = makeCard({ ...item, media_type: 'movie' }, i);
            if (isCurrent) card.style.outline = '2px solid var(--gold)';
            row.appendChild(card);
        });
        section.style.display = 'block';
        tabBtn.style.display = 'inline-flex';
    } catch (e) {
        section.style.display = 'none';
        tabBtn.style.display = 'none';
    }
}

// ─── THEME TOGGLE ───
function toggleTheme() {
    const isLight = document.body.classList.toggle('light');
    localStorage.setItem('sv_theme', isLight ? 'light' : 'dark');
    document.getElementById('theme-icon-moon').style.display = isLight ? 'none' : 'block';
    document.getElementById('theme-icon-sun').style.display = isLight ? 'block' : 'none';
    document.getElementById('theme-toggle').style.color = isLight ? 'var(--gold)' : 'var(--text2)';
}

// ─ DETAIL TABS ─
function switchDetailTab(tab, btn) {
    document.querySelectorAll('.pd-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.pd-tab-panel').forEach(p => p.style.display = 'none');
    if (btn) btn.classList.add('active');
    const panel = document.getElementById(`pd-tab-${tab}`);
    if (panel) panel.style.display = 'block';
}

function scrollToPlayer() {
    document.getElementById('player-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── STATS PAGE ───
function showStats(fromRoute = false) {
    showPage('stats-page');
    setActiveTab('tab-stats');
    setMobileTab('mtab-stats');
    if (!fromRoute) pushState({ browse: 'stats' });
    document.title = 'StreamVault';
    const input = document.getElementById('search-input');
    if (input) {
        input.value = '';
        input.placeholder = 'Search movies, shows…';
    }
    renderStats();
}

function renderStats() {
    const history = JSON.parse(localStorage.getItem('sv_history') || '{}');
    const items = Object.values(history);
    const movies = items.filter(i => i.type === 'movie');
    const episodes = items.filter(i => i.type === 'tv');
    let totalSeconds = 0;
    items.forEach(i => { totalSeconds += i.timestamp || 0; });
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const days = new Set(items.map(i => new Date(i.savedAt).toDateString()));
    document.getElementById('stats-grid').innerHTML = [
        { value: hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`, label: 'Total Watch Time', sub: 'across all titles' },
        { value: movies.length, label: 'Movies Started', sub: `from your history` },
        { value: episodes.reduce((acc, s) => acc + (s.episode || 0), 0), label: 'Episodes Watched', sub: `across all shows` },
        { value: days.size, label: 'Days Watched', sub: `different days` },
    ].map(s => `
        <div class="stat-card">
            <div class="stat-value">${s.value}</div>
            <div class="stat-label">${s.label}</div>
            <div class="stat-sub">${s.sub}</div>
        </div>`
    ).join('');
    const genreMap = {
        28: 'Action', 35: 'Comedy', 18: 'Drama', 27: 'Horror', 878: 'Sci-Fi',
        12: 'Adventure', 16: 'Animation', 80: 'Crime', 10749: 'Romance',
        53: 'Thriller', 99: 'Documentary', 14: 'Fantasy', 10765: 'Sci-Fi & Fantasy',
        10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality'
    };
    const genreCounts = {};
    items.forEach(i => { (i.genre_ids || []).forEach(gid => { const name = genreMap[gid] || null; if (name) genreCounts[name] = (genreCounts[name] || 0) + 1; }); });
    const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxG = topGenres[0]?.[1] || 1;
    document.getElementById('stats-genres').innerHTML = topGenres.length ? topGenres.map(([name, count]) => `
        <div class="genre-bar-row">
            <div class="genre-bar-label">${name}</div>
            <div class="genre-bar-track">
                <div class="genre-bar-fill" data-width="${Math.round((count / maxG) * 100)}"></div>
            </div>
            <div class="genre-bar-count">${count}</div>
        </div>`).join('')
        : '<div style="color:var(--text3);font-size:13px">Watch more to see your top genres</div>';
    if (topGenres.length) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            document.querySelectorAll('.genre-bar-fill[data-width]').forEach(el => {
                el.style.width = el.dataset.width + '%';
            });
        }));
    }

    // ─ Recently watched ─
    const recent = items.sort((a, b) => b.savedAt - a.savedAt).slice(0, 6);
    document.getElementById('stats-recent').innerHTML = recent.map(item => {
        const poster = item.poster ? `${TMDB_IMG}w92${item.poster}` : null;
        const sub = item.type === 'tv' ? `S${item.season} E${item.episode}` : item.year || '';
        const ago = timeAgo(item.savedAt);
        return `
            <div class="recent-item-stat">${poster ? `<img src="${poster}" onerror="this.style.opacity='0'">` : `<div style="width:36px;height:54px;background:var(--surface2);border-radius:4px;flex-shrink:0"></div>`}
                <div class="info">
                    <div class="rtitle">${esc(item.title)}</div>
                    <div class="rsub">${esc(sub)} · ${esc(ago)}</div>
                </div>
            </div>`;
    }).join('') || '<div style="color:var(--text3);font-size:13px">Nothing watched yet</div>';

    const activityMap = {};
    items.forEach(i => { const d = new Date(i.savedAt).toDateString(); activityMap[d] = (activityMap[d] || 0) + 1; });
    const dots = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toDateString();
        const count = activityMap[key] || 0;
        const cls = count === 0 ? '' : count >= 4 ? 'has-watch most' : count >= 2 ? 'has-watch more' : 'has-watch';
        dots.push(`<div class="activity-dot ${cls}" title="${key}: ${count} title(s)"></div>`);
    }
    document.getElementById('stats-activity').innerHTML = dots.join('');
}

function timeAgo(ts) {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    if (d < 7) return `${d}d ago`;
    return new Date(ts).toLocaleDateString();
}

// ─── SERVICE WORKER ───
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(reg => {
        console.log('SW registered:', reg.scope)
        setInterval(() => {reg.update();}, 600000);
        reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed') {
                    if (navigator.serviceWorker.controller) {
                        showToast('New update available. 🚀 Refreshing...');
                    }
                }
            });
        });
    }).catch(err => console.log('SW failed:', err));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
    });
}

async function loadNewThisWeek() {
    showSkeletons('new-this-week-row', 7);
    try {
        const today = new Date();
        const week = new Date(today);
        week.setDate(today.getDate() - 7);
        const fmt = d => d.toISOString().slice(0, 10);
        const from = fmt(week);
        const to = fmt(today);
        const [movies, shows] = await Promise.all([
            tmdb('/discover/movie', { 'primary_release_date.gte': from, 'primary_release_date.lte': to, sort_by: 'popularity.desc' }),
            tmdb('/discover/tv', { 'first_air_date.gte': from, 'first_air_date.lte': to, sort_by: 'popularity.desc' })
        ]);
        const combined = [
            ...movies.results.map(r => ({ ...r, media_type: 'movie' })),
            ...shows.results.map(r => ({ ...r, media_type: 'tv' }))
        ].sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 14);
        if (!combined.length) {
            document.getElementById('new-this-week-row').innerHTML = '<div class="empty-state"><p>Nothing new this week yet.</p></div>';
            return;
        }
        renderCards('new-this-week-row', combined);
    } catch (e) { }
}

// ─── MY LIST ───
function getMyList() { return SV.list.get(); }
function saveMyList(list) {
    SV.list.set(list);
    window._svMyListCache = list;
    window._svMyListSet = new Set(list.map(i => i.id));
}
function updateMyListBtn(id) { syncMyListBtns(isInMyList(id)); }
function isInMyList(id) {
    if (!window._svMyListSet) {
        const list = SV.list.get();
        window._svMyListCache = list;
        window._svMyListSet = new Set(list.map(i => i.id));
    }
    return window._svMyListSet.has(id);
}

function syncMyListBtns(inList) {
    ['2'].forEach(suffix => {
        const add = document.getElementById('my-list-icon-add' + suffix);
        const check = document.getElementById('my-list-icon-check' + suffix);
        const lbl = document.getElementById('my-list-label' + suffix);
        if (add) add.style.display = inList ? 'none' : 'block';
        if (check) check.style.display = inList ? 'block' : 'none';
        if (lbl) lbl.textContent = inList ? 'Saved' : 'My List';
    });
}

function toggleMyList() {
    const p = new URLSearchParams(location.search);
    const id = parseInt(p.get('id'));
    const type = p.get('type');
    if (!id || !type) return;
    const titleEl = document.getElementById('player-title');
    const title = titleEl ? titleEl.textContent : '';
    const metaEl = document.getElementById('player-meta');
    const yearMatch = metaEl ? metaEl.textContent.match(/\d{4}/) : null;
    const year = yearMatch ? yearMatch[0] : '';
    const detail = currentShow?.detail || null;
    const poster = window._currentDetailPoster || detail?.poster_path || null;

    let list = getMyList();
    const exists = list.some(i => i.id === id);
    if (exists) {
        list = list.filter(i => i.id !== id);
        syncMyListBtns(false);
        const snapshot = [...list];
        showUndoToast('Removed from My List', () => {saveMyList(snapshot); syncMyListBtns(true);});
    } else {
        list.unshift({id, type, title, year, poster, addedAt: Date.now()});
        syncMyListBtns(true);
        showToast('Added to My List');
    }
    saveMyList(list);
}

let myListFilter = 'all';
function filterMyList(type) {
    myListFilter = type;
    ['all', 'movie', 'tv'].forEach(t => {
        const btn = document.getElementById(`mylist-filter-${t}`);
        if (btn) btn.classList.toggle('active', t === type);
    });
    renderMyList();
}

function showMyList() {
    showPage('mylist-page');
    setActiveTab('tab-mylist');
    setMobileTab('mtab-mylist');
    pushState({ browse: 'mylist' });
    document.title = 'StreamVault';
    myListFilter = 'all';
    ['all', 'movie', 'tv'].forEach(t => {
        const btn = document.getElementById(`mylist-filter-${t}`);
        if (btn) btn.classList.toggle('active', t === 'all');
    });
    renderMyList();
}

function renderMyList() {
    const allItems = getMyList();
    const list = myListFilter === 'all' ? allItems : allItems.filter(i => i.type === myListFilter);
    const grid = document.getElementById('mylist-grid');
    grid.className = 'cards-grid';
    const empty = document.getElementById('mylist-empty');
    const count = document.getElementById('mylist-count');
    const total = allItems.length;
    const filtered = list.length;
    count.textContent = myListFilter === 'all' ? `${total} title${total !== 1 ? 's' : ''} saved` : `${filtered} of ${total} title${total !== 1 ? 's' : ''}`;

    if (!list.length) {
        empty.style.display = 'block';
        empty.querySelector('div[style*="font-size:16px"]').textContent =
            total === 0 ? 'Your list is empty' : `No ${myListFilter === 'movie' ? 'movies' : 'TV shows'} saved`;
        empty.querySelector('div[style*="font-size:13px"]').textContent =
            total === 0 ? 'Hit the + My List button on any movie or show to save it here.' : 'Try a different filter.';
        grid.innerHTML = '';
        return;
    }
    empty.style.display = 'none';
    grid.innerHTML = '';
    list.forEach((item, i) => {
        const div = document.createElement('div');
        div.className = 'card';
        div.style.animationDelay = `${i * 0.04}s`;
        div.style.position = 'relative';
        const poster = item.poster ? `${TMDB_IMG}w342${item.poster}` : null;
        const wasWatched = !!(JSON.parse(localStorage.getItem('sv_history') || '{}')[item.id]);
        const watchedBadge = wasWatched ? `<div class="mylist-watched-badge" title="In your watch history">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>Watched</div>` : '';
        div.innerHTML = poster
            ? `<div style="position:relative">
                    <img class="card-poster" src="${poster}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
                    <div class="card-poster-placeholder" style="display:none">${esc(item.title)}</div>${watchedBadge}
                </div>`
            : `<div style="position:relative"><div class="card-poster-placeholder">${esc(item.title)}</div>${watchedBadge}</div>`;
        div.innerHTML += `<div class="card-info">
            <div class="card-title">${esc(item.title)}</div>
            <div class="card-meta">
                <span>${esc(item.year || '')}</span>
                <span class="card-type-badge">${item.type === 'movie' ? 'Movie' : 'TV'}</span>
            </div>
            <div style="margin-top:6px">
                <button class="cw-remove-btn mylist-remove-btn" onclick="event.stopPropagation();removeFromMyList(${item.id})" style="position:relative;z-index:2;" title="Remove from My List">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Remove
                </button>
            </div>
        </div>`;

        const anchor = document.createElement('a');
        anchor.href = `/?type=${item.type}&id=${item.id}&name=${slugify(item.title)}`;
        anchor.style.cssText = 'position:absolute;inset:0;z-index:1;opacity:0;';
        anchor.setAttribute('aria-hidden', 'true');
        anchor.setAttribute('tabindex', '-1');
        anchor.addEventListener('click', e => {
            if (e.ctrlKey || e.metaKey || e.shiftKey) return;
            e.preventDefault();
            openDetail(item.id, item.type);
        });
        div.style.position = 'relative';
        div.addEventListener('contextmenu', e => {
            e.preventDefault();
            showCardContextMenu(e, `/?type=${item.type}&id=${item.id}&name=${slugify(item.title)}`, item.title || '');
        });
        div.appendChild(anchor);
        grid.appendChild(div);
    });
}

function removeFromMyList(id) {
    const prev = getMyList();
    saveMyList(prev.filter(i => i.id !== id));
    renderMyList();
    showUndoToast('Removed from My List', () => {saveMyList(prev); renderMyList();});
}

const KNOWN_COLLECTIONS = [
    {id: 531241, name: 'Spider-Man (MCU)'},
    {id: 86311, name: 'The Avengers'},
    {id: 263, name: 'The Dark Knight'},
    {id: 119, name: 'The Lord of the Rings'},
    {id: 121938, name: 'John Wick'},
    {id: 8091, name: 'Alien'},
    {id: 2980, name: 'Indiana Jones'},
    {id: 9485, name: 'Fast & Furious'},
    {id: 748, name: 'Pirates of the Caribbean'},
    {id: 422837, name: 'Spider-Man (Sony)'},
    {id: 131296, name: 'Thor'},
    {id: 84, name: 'Terminator'},
    {id: 645, name: 'James Bond'},
    {id: 10, name: 'Star Wars'},
    {id: 304378, name: 'Doctor Strange'},
    {id: 131, name: 'Harry Potter'},
    {id: 468552, name: 'Wonder Woman'},
    {id: 115838, name: 'Guardians of the Galaxy'},
    {id: 87096, name: 'Captain America'},
    {id: 8650, name: 'Jurassic Park'},
    {id: 2344, name: 'Matrix'},
    {id: 1570, name: 'Die Hard'},
    {id: 230, name: 'Batman'},
    {id: 328, name: 'Jurassic World'},
    {id: 529892, name: 'Black Panther'},
    {id: 131635, name: 'The Hunger Games'},
    {id: 31562, name: 'The Bourne Series'},
    {id: 556, name: 'The Transporter'},
    {id: 1241, name: 'Harry Potter Complete'},
    {id: 124879, name: '300 Series'},
    {id: 295, name: 'Resident Evil'},
    {id: 328372, name: 'Frozen Collection'},
    {id: 735, name: 'The Mummy'},
    {id: 89137, name: 'The Conjuring Universe'},
    {id: 86055, name: 'Men in Black'},
    {id: 9744, name: 'Lethal Weapon'},
    {id: 87359, name: 'Mission: Impossible'},
    {id: 94860, name: 'The Equalizer'},
    {id: 496, name: 'Transformers'},
    {id: 735, name: 'The Mummy'},
    {id: 2636, name: 'Mad Max'},
    {id: 420, name: 'The Chronicles of Narnia'},
    {id: 448150, name: 'Deadpool Collection'},
    {id: 131292, name: 'Iron Man'},
    {id: 131295, name: 'Captain Marvel'},
    {id: 52984, name: 'Sherlock Holmes'},
    {id: 404609, name: 'Kingsman'},
    {id: 335983, name: 'Venom Collection'},
    {id: 531242, name: 'Spider-Verse'},
    {id: 453993, name: 'The Hitman’s Bodyguard'},
    {id: 91746, name: 'The Expendables'},
    {id: 4438, name: 'Rambo'},
    {id: 8581, name: 'Rush Hour'},
    {id: 86119, name: 'The Lego Movie'},
    {id: 100965, name: 'Fantastic Beasts'},
    {id: 623911, name: 'Knives Out Collection'}
];

function getDiscoveredCollections() {
    return JSON.parse(localStorage.getItem('sv_discovered_collections') || '[]');
}

function saveDiscoveredCollection(col) {
    if (!col?.id) return;
    const existing = getDiscoveredCollections();
    if (existing.some(c => c.id === col.id)) return;
    existing.unshift({id: col.id, name: col.name });
    localStorage.setItem('sv_discovered_collections', JSON.stringify(existing.slice(0, 50)));
}

function _buildCollectionCard(c) {
    const backdrop = c.backdrop_path ? `${TMDB_IMG}w780${c.backdrop_path}` : (c.poster_path ? `${TMDB_IMG}w342${c.poster_path}` : null);
    const histObj = JSON.parse(localStorage.getItem('sv_history') || '{}');
    const watched = c.parts.filter(p => histObj[p.id]).length;
    const div = document.createElement('div');
    div.className = 'collection-card';
    div.innerHTML = `
        <div class="collection-backdrop" style="${backdrop ? `background-image:url(${backdrop})` : ''}">
            <div class="collection-overlay">
                <div class="collection-name">${esc(c.name)}</div>
                <div class="collection-meta">${c.parts.length} films${watched ? ` · <span style="color:var(--gold)">${watched} watched</span>` : ''}</div>
            </div>
        </div>`;
    div.addEventListener('click', () => openCollectionDetail(c.id, c.name));
    div.addEventListener('contextmenu', e => { e.preventDefault(); showCardContextMenu(e, `/?browse=collections&id=${c.id}`, c.name); });
    return div;
}

async function showCollections() {
    showPage('collections-page');
    setActiveTab('tab-collections');
    setMobileTab('mtab-collections');
    pushState({ browse: 'collections' });
    document.title = 'Collections — StreamVault';
    const grid = document.getElementById('collections-grid');
    const count = document.getElementById('collections-count');
    count.textContent = 'Loading…';
    grid.innerHTML = Array(12).fill(`<div class="skeleton" style="aspect-ratio:16/9;border-radius:12px;"></div>`).join('');

    const knownIds = new Set(KNOWN_COLLECTIONS.map(c => c.id));
    const discovered = getDiscoveredCollections().filter(c => !knownIds.has(c.id));
    const allToFetch = [...KNOWN_COLLECTIONS, ...discovered];
    const results = await Promise.allSettled(allToFetch.map(c => tmdb(`/collection/${c.id}`)));
    const all = results.filter(r => r.status === 'fulfilled').map(r => r.value).filter(c => c.parts?.length > 1);
    const discoveredSet = new Set(discovered.map(c => c.id));
    const discoveredCols = all.filter(c => discoveredSet.has(c.id));
    const curatedCols = all.filter(c => !discoveredSet.has(c.id));

    count.textContent = `${all.length} collection${all.length !== 1 ? 's' : ''}`;
    grid.innerHTML = '';

    if (discoveredCols.length) {
        const label = document.createElement('div');
        label.style.cssText = 'grid-column:1/-1;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--gold);margin-bottom:4px;';
        label.textContent = 'Discovered from your history';
        grid.appendChild(label);
        discoveredCols.forEach(c => grid.appendChild(_buildCollectionCard(c)));
        const divider = document.createElement('div');
        divider.style.cssText = 'grid-column:1/-1;height:1px;background:var(--border);margin:8px 0 12px;';
        grid.appendChild(divider);
    }
    curatedCols.forEach(c => grid.appendChild(_buildCollectionCard(c)));
}

async function openCollectionDetail(id, name) {
    showPage('search-page');
    document.getElementById('search-query-display').textContent = name;
    document.getElementById('search-count').textContent = 'Loading…';
    document.getElementById('search-results').innerHTML = '<div class="spinner"></div>';
    document.getElementById('genre-bar').style.display = 'none';
    try {
        const data = await tmdb(`/collection/${id}`);
        const parts = (data.parts || [])
            .sort((a, b) => (a.release_date || '').localeCompare(b.release_date || ''))
            .map(r => ({ ...r, media_type: 'movie' }));
        document.getElementById('search-count').textContent = `${parts.length} films`;
        renderCards('search-results', parts);
    } catch (e) {
        document.getElementById('search-results').innerHTML = '<div class="empty-state"><p>Failed to load collection.</p></div>';
    }
}

function openShortcuts() {
    const m = document.getElementById('shortcuts-modal');
    m.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
        const outside = e => {
            if (e.target === m) { closeShortcuts(); m.removeEventListener('mousedown', outside); }
        };
        m.addEventListener('mousedown', outside);
    }, 0);
}

function closeShortcuts() {
    const m = document.getElementById('shortcuts-modal');
    m.style.display = 'none';
    document.body.style.overflow = '';
}

// ─── CONTEXT MENUS ───
function showCardContextMenu(e, url, title, itemId = null) {
    document.getElementById('sv-context-menu')?.remove();
    const menu = document.createElement('div');
    menu.id = 'sv-context-menu';
    menu.className = 'sv-context-menu';
    const urlParams = new URLSearchParams(url.split('?')[1] || '');
    const cardId = itemId || (urlParams.get('id') ? parseInt(urlParams.get('id')) : null);
    const isCard = !!urlParams.get('type') && !!cardId;

    menu.innerHTML = `<div class="sv-ctx-item sv-ctx-header">${esc(title.length > 28 ? title.slice(0, 28) + '…' : title)}</div>
        <div class="sv-ctx-divider"></div>
        <button class="sv-ctx-item sv-ctx-btn" id="sv-ctx-newtab">${icon('newtab', 13)} Open in new tab</button>
        <button class="sv-ctx-item sv-ctx-btn" id="sv-ctx-copylink">${icon('link', 13)} Copy link</button>
        ${isCard ? `<div class="sv-ctx-divider"></div><button class="sv-ctx-item sv-ctx-btn sv-ctx-danger" id="sv-ctx-hide">${icon('eye_off', 13)} Not interested</button>` : ''}`;

    document.body.appendChild(menu);
    const vw = window.innerWidth, vh = window.innerHeight;
    let mobileBackdrop = null;
    if (vw <= 768) {
        menu.style.cssText = `left:0;right:0;bottom:0;top:auto;width:100%;border-radius:16px 16px 0 0;position:fixed;`;
        menu.classList.add('sv-ctx-mobile');
        mobileBackdrop = document.createElement('div');
        mobileBackdrop.className = 'sv-ctx-mobile-backdrop';
        document.body.insertBefore(mobileBackdrop, menu);
        mobileBackdrop.addEventListener('click', () => { menu.remove(); mobileBackdrop.remove(); });
    } else {
        menu.style.left = (e.clientX + 190 > vw ? e.clientX - 190 : e.clientX) + 'px';
        menu.style.top = (e.clientY + 140 > vh ? e.clientY - 140 : e.clientY) + 'px';
    }
    requestAnimationFrame(() => menu.classList.add('sv-ctx-visible'));
    let touchStartY = 0;
    menu.addEventListener('touchstart', ev => { touchStartY = ev.touches[0].clientY; }, { passive: true });
    menu.addEventListener('touchmove', ev => { if (ev.touches[0].clientY - touchStartY > 60) { menu.remove(); } }, { passive: true });
    const fullUrl = location.origin + url;
    document.getElementById('sv-ctx-newtab').addEventListener('click', () => { window.open(fullUrl, '_blank', 'noopener'); menu.remove(); mobileBackdrop?.remove(); });
    document.getElementById('sv-ctx-copylink').addEventListener('click', () => { navigator.clipboard.writeText(fullUrl).then(() => showToast('Link copied!')); menu.remove(); mobileBackdrop?.remove(); });
    if (isCard) {
        document.getElementById('sv-ctx-hide').addEventListener('click', () => {
            const cardEl = document.querySelector(`[data-id="${cardId}"]`);
            const cardParent = cardEl?.parentNode;
            const cardNextSibling = cardEl?.nextSibling;
            const prevAllResults = [...allResults];
            const prevHidden = [...SV.hidden.get()];
            SV.hidden.add(cardId);
            if (cardEl) cardEl.remove();
            allResults = allResults.filter(r => r.id !== cardId);
            menu.remove();
            showUndoToast('Hidden — won\'t show again', () => {
                SV._set('sv_hidden', prevHidden);
                if (cardParent) {
                    if (cardNextSibling) cardParent.insertBefore(cardEl, cardNextSibling);
                    else cardParent.appendChild(cardEl);
                }
                allResults = prevAllResults;
            });
        });
    }
    const close = ev => { if (!menu.contains(ev.target) && ev.target !== mobileBackdrop) { menu.remove(); mobileBackdrop?.remove(); document.removeEventListener('mousedown', close); } };
    const closeOnScroll = () => { menu.remove(); mobileBackdrop?.remove(); window.removeEventListener('scroll', closeOnScroll, true); };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
    window.addEventListener('scroll', closeOnScroll, { passive: true, capture: true });
}

function showCastContextMenu(e, name) {
    document.getElementById('sv-context-menu')?.remove();
    const menu = document.createElement('div');
    menu.id = 'sv-context-menu';
    menu.className = 'sv-context-menu';
    menu.innerHTML = `
        <div class="sv-ctx-item sv-ctx-header">${esc(name)}</div>
        <div class="sv-ctx-divider"></div>
        <button class="sv-ctx-item sv-ctx-btn" id="sv-ctx-copyname">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy name
        </button>
        <button class="sv-ctx-item sv-ctx-btn" id="sv-ctx-searchactor">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/></svg>Search their movies
        </button>
    `;
    document.body.appendChild(menu);
    const vw = window.innerWidth, vh = window.innerHeight;
    menu.style.left = (e.clientX + 190 > vw ? e.clientX - 190 : e.clientX) + 'px';
    menu.style.top = (e.clientY + 110 > vh ? e.clientY - 110 : e.clientY) + 'px';
    requestAnimationFrame(() => menu.classList.add('sv-ctx-visible'));
    let touchStartY = 0;
    menu.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
    menu.addEventListener('touchmove', e => { if (e.touches[0].clientY - touchStartY > 40) { menu.remove(); } }, { passive: true });

    document.getElementById('sv-ctx-copyname').addEventListener('click', () => {
        navigator.clipboard.writeText(name).then(() => showToast('Name copied!'));
        menu.remove();
    });
    document.getElementById('sv-ctx-searchactor').addEventListener('click', async () => {
        menu.remove();
        showPage('search-page');
        document.getElementById('search-query-display').textContent = name;
        document.getElementById('search-count').textContent = 'Loading…';
        document.getElementById('search-results').innerHTML = '<div class="spinner"></div>';
        document.getElementById('genre-bar').style.display = 'none';
        try {
            const people = await tmdb('/search/person', { query: name, page: 1 });
            const person = people.results[0];
            if (!person) { document.getElementById('search-results').innerHTML = '<div class="empty-state"><p>No results found.</p></div>'; return; }
            const credits = await tmdb(`/person/${person.id}/combined_credits`);
            const seen = new Set();
            const items = [...(credits.cast || [])].filter(r => {
                const k = `${r.media_type}-${r.id}`;
                if (seen.has(k) || !r.poster_path) return false;
                seen.add(k); return true;
            }).sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 40);
            document.getElementById('search-count').textContent = `${items.length} titles`;
            allResults = items;
            renderCards('search-results', items);
        } catch (e) {
            document.getElementById('search-results').innerHTML = '<div class="empty-state"><p>Failed to load.</p></div>';
        }
    });

    const close = e2 => { if (!menu.contains(e2.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
    const closeOnScroll = () => { menu.remove(); window.removeEventListener('scroll', closeOnScroll, true); };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
    window.addEventListener('scroll', closeOnScroll, true);
}

function showSourceContextMenu(e, source, label) {
    document.getElementById('sv-context-menu')?.remove();
    const menu = document.createElement('div');
    menu.id = 'sv-context-menu';
    menu.className = 'sv-context-menu';
    const { type, imdb, tmdbId, season, episode } = currentEmbed;
    const embedUrl = type ? buildEmbedUrl(source, type, imdb, tmdbId, season, episode) : null;
    menu.innerHTML = `
        <div class="sv-ctx-item sv-ctx-header">${esc(label)}</div>
        <div class="sv-ctx-divider"></div>
        <button class="sv-ctx-item sv-ctx-btn" id="sv-ctx-src-switch">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>Switch to ${esc(label)}
        </button>${embedUrl ? `
        <button class="sv-ctx-item sv-ctx-btn" id="sv-ctx-src-newtab">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Open in new tab
        </button>
        <button class="sv-ctx-item sv-ctx-btn" id="sv-ctx-src-copy">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy embed URL
        </button>` : ''}
    `;
    document.body.appendChild(menu);
    const vw = window.innerWidth, vh = window.innerHeight;
    menu.style.left = (e.clientX + 190 > vw ? e.clientX - 190 : e.clientX) + 'px';
    menu.style.top = (e.clientY + 130 > vh ? e.clientY - 130 : e.clientY) + 'px';
    requestAnimationFrame(() => menu.classList.add('sv-ctx-visible'));
    let touchStartY = 0;
    menu.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
    menu.addEventListener('touchmove', e => { if (e.touches[0].clientY - touchStartY > 40) { menu.remove(); } }, { passive: true });

    document.getElementById('sv-ctx-src-switch').addEventListener('click', () => { switchSource(source); menu.remove(); });
    if (embedUrl) {
        document.getElementById('sv-ctx-src-newtab').addEventListener('click', () => { window.open(embedUrl, '_blank', 'noopener'); menu.remove(); });
        document.getElementById('sv-ctx-src-copy').addEventListener('click', () => { navigator.clipboard.writeText(embedUrl).then(() => showToast('Embed URL copied!')); menu.remove(); });
    }

    const close = e2 => { if (!menu.contains(e2.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
    const closeOnScroll = () => { menu.remove(); window.removeEventListener('scroll', closeOnScroll, true); };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
    window.addEventListener('scroll', closeOnScroll, true);
}

// ─── WATCH TOGETHER ───
let watchTogetherTimer = null;
function generateWatchTogetherLink() {
    const startAt = Date.now() + 30000;
    const params = new URLSearchParams(location.search);
    params.set('startAt', startAt);
    const url = `${location.origin}${location.pathname}?${params.toString()}`;
    if (navigator.share) {
        navigator.share({ title: 'StreamVault Sync', text: '🎬 Watch with me — starts in 30 seconds!', url }).catch(() => copyLinkToClipboard(url));
    } else {
        copyLinkToClipboard(url);
    }
    startWatchTogetherCountdown(startAt);
}

function copyLinkToClipboard(url) {
    const btn = document.getElementById('watch-together-btn');
    if (!btn) return;
    navigator.clipboard.writeText(url).then(() => {
        const orig = btn.innerHTML;
        btn.innerHTML = `<span>✅ Link Copied!</span>`;
        btn.style.borderColor = 'var(--gold)';
        setTimeout(() => {
            btn.innerHTML = orig;
            btn.style.borderColor = '';
        }, 2500);
    });
}

function startWatchTogetherCountdown(startAt) {
    const overlay = document.getElementById('watch-together-overlay');
    const countEl = document.getElementById('watch-together-countdown');
    const iframe = document.getElementById('player-iframe');
    overlay.style.display = 'flex';
    if (iframe) iframe.src = '';
    clearInterval(watchTogetherTimer);
    watchTogetherTimer = setInterval(() => {
        const remaining = Math.ceil((startAt - Date.now()) / 1000);
        if (remaining <= 0) {
            clearInterval(watchTogetherTimer);
            overlay.style.display = 'none';
            const urlData = getMediaInfoFromUrl();
            const type = currentEmbed.type || urlData.type;
            const id = currentEmbed.tmdbId || urlData.id;
            if (type && id && iframe) { iframe.src = buildEmbedUrl(currentSource, type, null, id, currentEmbed.season || urlData.season, currentEmbed.episode || urlData.episode, 0); }
            const p = new URLSearchParams(location.search);
            p.delete('startAt');
            history.replaceState({}, '', `${location.pathname}?${p.toString()}`);
        } else {
            countEl.textContent = remaining;
        }
    }, 250);
}

function cancelWatchTogether() {
    clearInterval(watchTogetherTimer);
    document.getElementById('watch-together-overlay').style.display = 'none';
    const { type, imdb, tmdbId, season, episode } = currentEmbed;
    const iframe = document.getElementById('player-iframe');
    if (type && iframe) { iframe.src = buildEmbedUrl(currentSource, type, imdb, tmdbId, season, episode, 0); }
}

function getMediaInfoFromUrl() {
    const params = new URLSearchParams(location.search);
    return {
        type: params.get('type'),
        id: params.get('id'),
        season: params.get('season'),
        episode: params.get('episode')
    };
}

// ─── CLIPBOARD HELPER ───
function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return Promise.resolve();
}

// ─── SHARE ───
function shareUrl() {
    if (navigator.share) {
        navigator.share({ title: document.title, url: location.href });
        return;
    }
    copyToClipboard(location.href).then(() => {
        const btn = document.getElementById('share-btn');
        btn.classList.add('copied');
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
        setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Share`;
        }, 2000);
    });
}

// ─── ADVANCED FILTERS ───
let activeFilters = { type: 'all', sort: 'popularity.desc', lang: '', yearFrom: 1950, yearTo: new Date().getFullYear(), rating: 0, genre: '', network: '', networkType: '' };

function toggleFilterPanel() {
    const panel = document.getElementById('filter-panel');
    const label = document.getElementById('filter-toggle-label');
    const open = panel.style.display === 'block';
    panel.style.display = open ? 'none' : 'block';
    label.textContent = open ? 'Filters' : 'Hide Filters';
    document.getElementById('filter-toggle').style.cssText = 'display:flex;margin-bottom:16px;';
}

function setFilter(key, val, btn) {
    activeFilters[key] = val;
    btn.closest('div').querySelectorAll('.filter-pill').forEach(b => b.classList.toggle('active', b.dataset.val === val));
}

function updateYearLabel() {
    let from = parseInt(document.getElementById('year-from').value) || 1950;
    let to = parseInt(document.getElementById('year-to').value) || 2026;
    if (from > to) { to = from; document.getElementById('year-to').value = to; }
    activeFilters.yearFrom = from;
    activeFilters.yearTo = to;
}

function resetFilters() {
    activeFilters = { type: 'all', sort: 'popularity.desc', lang: '', yearFrom: 1950, yearTo: 2026, rating: 0, genre: '', network: '', networkType: '' };
    document.getElementById('filter-type').value = 'all';
    document.getElementById('filter-sort').value = 'popularity.desc';
    document.getElementById('filter-lang').value = '';
    document.getElementById('filter-genre').value = '';
    document.getElementById('filter-network').value = '';
    document.getElementById('year-from').value = 1950;
    document.getElementById('year-to').value = new Date().getFullYear();
    document.getElementById('filter-rating').value = 0;
    document.getElementById('rating-label').textContent = '0+';
}

async function applyFilters(fromRestore = false) {
    const currentQuery = currentSection?.mode === 'search' ? currentSection.query : null;
    activeFilters.type = document.getElementById('filter-type').value
    activeFilters.sort = document.getElementById('filter-sort').value;
    activeFilters.lang = document.getElementById('filter-lang').value;
    activeFilters.genre = document.getElementById('filter-genre').value;
    activeFilters.network = document.getElementById('filter-network').value;
    const sel = document.getElementById('filter-network');
    activeFilters.networkType = sel.options[sel.selectedIndex]?.dataset?.type || '';
    activeFilters.yearFrom = parseInt(document.getElementById('year-from').value) || 1950;
    activeFilters.yearTo = parseInt(document.getElementById('year-to').value) || 2026;
    activeFilters.rating = parseInt(document.getElementById('filter-rating').value) || 0;
    const { type, sort, lang, yearFrom, yearTo, rating, genre, network, networkType } = activeFilters;
    const types = type === 'all' ? ['movie', 'tv'] : [type];

    if (!fromRestore) pushState({ browse: 'filter', type, sort, lang, yearFrom, yearTo, rating, genre, network, networkType });
    document.getElementById('search-query-display').textContent = 'Filtered Results';
    document.getElementById('search-count').textContent = 'Loading…';
    document.getElementById('search-results').innerHTML = '<div class="spinner"></div>';
    document.getElementById('filter-panel').style.display = 'none';
    document.getElementById('filter-toggle-label').textContent = 'Filters';
    try {
        const results = await Promise.all(types.map(async t => {
            if (currentQuery) {
                const data = await tmdb(`/search/${t === 'movie' ? 'movie' : 'tv'}`, { query: currentQuery, page: 1 });
                let items = data.results.map(r => ({ ...r, media_type: t }));
                if (genre) items = items.filter(r => (r.genre_ids || []).includes(parseInt(genre)));
                if (lang) items = items.filter(r => r.original_language === lang);
                if (yearFrom) items = items.filter(r => parseInt((r.release_date || r.first_air_date || '0').slice(0, 4)) >= yearFrom);
                if (yearTo) items = items.filter(r => parseInt((r.release_date || r.first_air_date || '9999').slice(0, 4)) <= yearTo);
                if (rating) items = items.filter(r => (r.vote_average || 0) >= rating);
                return items;
            }
            const dateFromKey = t === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte';
            const dateToKey = t === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte';
            const sortKey = (sort === 'primary_release_date.desc' || sort === 'primary_release_date.asc') && t === 'tv'
                ? sort.replace('primary_release_date', 'first_air_date') : sort;
            const params = { sort_by: sortKey, [dateFromKey]: `${yearFrom}-01-01`, [dateToKey]: `${yearTo}-12-31`, 'vote_average.gte': rating, 'vote_count.gte': 50, page: 1 };
            if (lang) params.with_original_language = lang;
            if (genre) params.with_genres = genre;
            if (network) {
                if (!networkType) {
                    if (t === 'tv') params.with_networks = network;
                    if (t === 'movie') params.with_companies = network;
                } else {
                    if (networkType === 'network' && t === 'tv') params.with_networks = network;
                    if (networkType === 'company' && t === 'movie') params.with_companies = network;
                    if (networkType === 'network' && t === 'movie') return Promise.resolve([]);
                    if (networkType === 'company' && t === 'tv') return Promise.resolve([]);
                }
            }
            return tmdb(`/discover/${t}`, params).then(d => d.results.map(r => ({ ...r, media_type: t })));
        }));
        allResults = results.flat().sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        activeGenre = 'all';
        document.querySelectorAll('.genre-btn').forEach(b => b.classList.toggle('active', b.dataset.genre === 'all'));
        document.getElementById('genre-bar').style.display = 'flex';
        document.getElementById('search-count').textContent = `${allResults.length} results`;
        if (!allResults.length) {
            document.getElementById('search-results').innerHTML = '<div class="empty-state"><div class="icon">🎬</div><p>No results. Try adjusting the filters.</p></div>';
        } else {
            renderCards('search-results', allResults);
        }
        if (window.innerWidth <= 768) {
            setTimeout(() => document.getElementById('search-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
        }
    } catch (e) {
        document.getElementById('search-results').innerHTML = '<div class="empty-state"><p>Failed to load. Try again.</p></div>';
    }
}

function restoreFilters(p) {
    const type = p.get('type') || 'all';
    const sort = p.get('sort') || 'popularity.desc';
    const lang = p.get('lang') || '';
    const genre = p.get('genre') || '';
    const network = p.get('network') || '';
    const networkType = p.get('networkType') || '';
    const yearFrom = parseInt(p.get('yearFrom')) || 1950;
    const yearTo = parseInt(p.get('yearTo')) || 2026;
    const rating = parseInt(p.get('rating')) || 0;

    document.getElementById('filter-type').value = type;
    document.getElementById('filter-sort').value = sort;
    document.getElementById('filter-lang').value = lang;
    document.getElementById('filter-genre').value = genre;
    document.getElementById('filter-network').value = network;
    document.getElementById('year-from').value = yearFrom;
    document.getElementById('year-to').value = yearTo;
    document.getElementById('filter-rating').value = rating;
    document.getElementById('rating-label').textContent = rating + '+';
    activeFilters = { type, sort, lang, genre, network, networkType, yearFrom, yearTo, rating };
    showPage('search-page');
    document.getElementById('filter-toggle').style.cssText = 'display:flex;margin-bottom:16px;';
    applyFilters(true);
}

// ─── EXPORT / IMPORT HISTORY ───
function runExport() {
    const inclHistory = document.getElementById('exp-history').checked;
    const inclMyList = document.getElementById('exp-mylist').checked;
    if (!inclHistory && !inclMyList) {
        showToast("Select at least one option to export");
        return;
    }
    const payload = { _exported: new Date().toISOString(), _version: 1 };
    if (inclHistory) payload.history = JSON.parse(localStorage.getItem('sv_history') || '{}');
    if (inclMyList) payload.mylist = JSON.parse(localStorage.getItem('sv_mylist') || '[]');
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `streamvault-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    closeExportCard();
    showToast('Exported successfully');
}

function openExportCard() {
    const o = document.getElementById('export-overlay');
    o.style.display = 'flex';
    o.classList.remove('overlay-closing');
    document.body.style.overflow = 'hidden';
    const card = o.querySelector('.import-card');
    if (card) { card.classList.remove('card-closing'); card.classList.add('card-opening'); }
    setTimeout(() => {
        const outside = e => { if (e.target === o) { closeExportCard(); o.removeEventListener('mousedown', outside); } };
        o.addEventListener('mousedown', outside);
    }, 0);
}

function closeExportCard() {
    const o = document.getElementById('export-overlay');
    const card = o.querySelector('.import-card');
    if (card) { card.classList.remove('card-opening'); card.classList.add('card-closing'); }
    o.classList.add('overlay-closing');
    setTimeout(() => {
        o.style.display = 'none';
        o.classList.remove('overlay-closing');
        if (card) card.classList.remove('card-closing');
    }, 260);
    document.body.style.overflow = '';
}

function openImportCard() {
    const o = document.getElementById('import-overlay');
    o.style.display = 'flex';
    o.classList.remove('overlay-closing');
    document.body.style.overflow = 'hidden';
    const card = o.querySelector('.import-card');
    if (card) { card.classList.remove('card-closing'); card.classList.add('card-opening'); }
    document.getElementById('import-status').textContent = '';
    const dz = document.getElementById('import-dropzone');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
        e.preventDefault(); dz.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) processImportFile(file);
    });
    setTimeout(() => {
        const outside = e => { if (e.target === o) { closeImportCard(); o.removeEventListener('mousedown', outside); } };
        o.addEventListener('mousedown', outside);
    }, 0);
}

function closeImportCard() {
    const o = document.getElementById('import-overlay');
    const card = o.querySelector('.import-card');
    if (card) { card.classList.remove('card-opening'); card.classList.add('card-closing'); }
    o.classList.add('overlay-closing');
    setTimeout(() => {
        o.style.display = 'none';
        o.classList.remove('overlay-closing');
        if (card) card.classList.remove('card-closing');
    }, 260);
    document.body.style.overflow = '';
}

function toggleImportReplace() {
    importReplaceMode = !importReplaceMode;
    const btn = document.getElementById('import-replace-toggle');
    btn.dataset.on = importReplaceMode ? 'true' : 'false';
}

function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    processImportFile(file);
    event.target.value = '';
}

function processImportFile(file) {
    const status = document.getElementById('import-status');
    status.textContent = 'Reading file…';
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);
            if (typeof data !== 'object' || Array.isArray(data)) { status.textContent = '❌ Invalid file format'; return; }
            const historyData = data.history || data;
            const mylistData = Array.isArray(data.mylist) ? data.mylist : [];

            if (importReplaceMode) {
                localStorage.setItem('sv_history', JSON.stringify(historyData));
                localStorage.setItem('sv_mylist', JSON.stringify(mylistData));
            } else {
                const existing = JSON.parse(localStorage.getItem('sv_history') || '{}');
                const merged = { ...existing };
                let dupes = 0;
                for (const [id, item] of Object.entries(historyData)) {
                    if (merged[id]) {
                        dupes++;
                        if (item.savedAt > merged[id].savedAt) merged[id] = item;
                    } else {
                        merged[id] = item;
                    }
                }
                localStorage.setItem('sv_history', JSON.stringify(merged));

                const existingList = JSON.parse(localStorage.getItem('sv_mylist') || '[]');
                const existingKeys = new Set(existingList.map(i => `${i.type}-${i.id}`));
                const newItems = mylistData.filter(i => !existingKeys.has(`${i.type}-${i.id}`));
                localStorage.setItem('sv_mylist', JSON.stringify([...existingList, ...newItems]));
                const histCount = Object.keys(historyData).length;
                const msg = dupes > 0 ? `✅ Imported ${histCount} history + ${mylistData.length} list · ${dupes} duplicate${dupes !== 1 ? 's' : ''} resolved` : `✅ Imported ${histCount} history + ${mylistData.length} list titles`;
                status.textContent = msg;
                setTimeout(closeImportCard, 1800);
                renderContinueWatching(); renderStats(); renderMyList();
                return;
            }
            const histCount = Object.keys(historyData).length;
            status.textContent = `✅ Replaced with ${histCount} history + ${mylistData.length} list titles`;
            setTimeout(closeImportCard, 1800);
            renderContinueWatching(); renderStats(); renderMyList();
        } catch {
            if (status) status.textContent = '❌ Failed to read — make sure it\'s a valid export';
        }
    };
    reader.readAsText(file);
}

// ─── Notification / Toast ───
function showToast(msg) {
    const t = document.getElementById('toast');
    const msgEl = document.getElementById('toast-msg');
    const undoBtn = document.getElementById('toast-undo-btn');
    msgEl.textContent = msg;
    undoBtn.style.display = 'none';
    _toastUndoFn = null;
    t.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function showUndoToast(msg, undoFn) {
    const t = document.getElementById('toast');
    const msgEl = document.getElementById('toast-msg');
    const undoBtn = document.getElementById('toast-undo-btn');
    msgEl.textContent = msg;
    undoBtn.style.display = 'block';
    _toastUndoFn = undoFn;
    t.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
        t.classList.remove('show');
        _toastUndoFn = null;
    }, 4000);
}

function triggerToastUndo() {
    clearTimeout(_toastTimer);
    document.getElementById('toast').classList.remove('show');
    if (_toastUndoFn) { _toastUndoFn(); _toastUndoFn = null; }
}