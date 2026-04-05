const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/';
const PRIME_BASE = 'https://primesrc.me/embed';

let API_KEY = localStorage.getItem('tmdb_api_key') || '';
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
let currentSource = 'primesrc';
let currentEmbed = {type: null, imdb: null, tmdbId: null, season: null, episode: null};
let currentPage = 1;
let currentSection = null;
let isLoadingMore = false;
let hasMorePages = true;
let isFullscreen = false;
let allResults = [];
let activeGenre = 'all';
let autoplayTimer = null;
let suggestionCache = {};
let loadedIds = new Set();

// ─── INIT ───
if ('scrollRestoration' in history) {history.scrollRestoration = 'manual';}

window.addEventListener('DOMContentLoaded', () => {
    window.scrollTo(0, 0);
    const params = new URLSearchParams(location.search);
    const startAt = params.get('startAt');
    if (startAt) {
        const urlId = params.get('id');
        if (urlId) {pendingWatchTogetherStartAt = parseInt(startAt);}
    }
    if (localStorage.getItem('sv_theme') === 'light') toggleTheme();
    if (API_KEY) {
        document.getElementById('setup-overlay').classList.add('hidden');
        initApp();
    } else {
        document.getElementById('setup-overlay').classList.remove('hidden');
    }
});

function saveApiKey() {
    const k = document.getElementById('api-key-input').value.trim();
    if (!k) {showToast('Please enter your TMDB API key'); return;}
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

let homeLoaded = false;
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
    if (params.type === 'tv' && params.season && params.episode)
        return `${name} · S${String(params.season).padStart(2, '0')}E${String(params.episode).padStart(2, '0')} — StreamVault`;
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
            _pendingEp = {season: parseInt(season), episode: parseInt(episode) };
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
        }
    } else if (search) {
        document.getElementById('search-input').value = decodeURIComponent(search);
        doSearch(decodeURIComponent(search), true);
    } else {
        showHome();
    }
}

// ─── XSS HELPER ───
function esc(str) {
    const d = document.createElement('div');
    d.textContent = str ?? '';
    return d.innerHTML;
}

// ─── API FETCH ───
function isBearerToken(key) {return key && key.startsWith('eyJ');}
async function tmdb(path, params = {}) {
    const opts = {};
    let reqUrl;
    if (isBearerToken(API_KEY)) {
        reqUrl = `${TMDB_BASE}${path}?${new URLSearchParams(params)}`;
        opts.headers = {Authorization: `Bearer ${API_KEY}` };
    } else {
        reqUrl = `${TMDB_BASE}${path}?${new URLSearchParams({api_key: API_KEY, ...params})}`;
    }
    const res = await fetch(reqUrl, opts);
    if (!res.ok) {
        if (res.status === 401) {showToast('Invalid API key — please update it'); showSetup();}
        throw new Error('TMDB fetch failed');
    }
    return res.json();
}

// ─── RENDER HELPERS ───
function posterUrl(path, size = 'w342') {return path ? `${TMDB_IMG}${size}${path}` : null;}
function backdropUrl(path) {return path ? `${TMDB_IMG}w1280${path}` : null;}
function starIcon() {return `<svg width="11" height="11" viewBox="0 0 24 24" fill="var(--gold)"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;}

function makeCard(item, index = 0) {
    const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
    const title = item.title || item.name || 'Unknown';
    const year = (item.release_date || item.first_air_date || '').slice(0, 4);
    const rating = item.vote_average ? item.vote_average.toFixed(1) : '—';
    const poster = posterUrl(item.poster_path);
    const div = document.createElement('div');
    div.className = 'card';
    div.style.animationDelay = `${index * 0.04}s`;
    const releaseDate = item.release_date || item.first_air_date || '';
    const releaseMs = releaseDate ? new Date(releaseDate).getTime() : 0;
    const nowMs = Date.now();
    const daysUntil = releaseMs > nowMs ? Math.ceil((releaseMs - nowMs) / (1000 * 60 * 60 * 24)) : 0;
    const comingBadge = daysUntil > 0 ? `<div class="coming-soon-badge">${daysUntil === 1 ? 'Tomorrow' : `In ${daysUntil} days`}</div>` : '';
    const safeTitle = esc(title);

    const inListNow = isInMyList(item.id);
    const posterWrap = document.createElement('div');
    posterWrap.className = 'cw-poster-wrap';
    posterWrap.style.cursor = 'pointer';
    if (poster) {
        posterWrap.innerHTML = `
            <img class="card-poster" src="${poster}" alt="${safeTitle}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
            <div class="card-poster-placeholder" style="display:none">${safeTitle}</div>${comingBadge}
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
            <div class="card-poster-placeholder">${safeTitle}</div>${comingBadge}
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

    posterWrap.addEventListener('click', e => {
        if (e.target.closest('.cw-hover-btn')) return;
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
            saveMyList([{ id: item.id, type: mediaType, title: t, year: y, poster: item.poster_path || null, addedAt: Date.now() }, ...list]);
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
    div.addEventListener('contextmenu', e => {e.preventDefault(); showCardContextMenu(e, cardUrl, title);});
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
    const safeTitle = esc(cardItem?.title || cardItem?.name || '');
    modal.innerHTML = `
        <div class="qm-box">
            <button class="qm-close" id="qm-close-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <div class="qm-backdrop-img" id="qm-backdrop"></div>
            <div class="qm-gradient"></div>
            <div class="qm-content">
                <div class="qm-title" id="qm-title">${safeTitle}</div>
                <div class="qm-actions">
                    <button class="qm-play-btn" id="qm-play-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>Play
                    </button>
                    <button class="qm-list-btn" id="qm-list-btn">
                        <svg class="qm-icon-add" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        <svg class="qm-icon-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="display:none"><polyline points="20 6 9 17 4 12"/></svg>
                        <span class="qm-list-label">My List</span>
                    </button>
                    <button class="qm-detail-btn" id="qm-detail-btn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        Details
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
    const close = () => {
        modal.classList.add('qm-closing');
        document.body.style.overflow = '';
        setTimeout(() => modal.remove(), 250);
    };
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.getElementById('qm-close-btn').addEventListener('click', close);
    document.getElementById('qm-play-btn').addEventListener('click', () => {
        close();
        savedScrollY = window.scrollY;
        openDetail(id, mediaType, true);
    });
    document.getElementById('qm-detail-btn').addEventListener('click', () => {
        close();
        savedScrollY = window.scrollY;
        openDetail(id, mediaType, false);
    });

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
        const t = cardItem?.title || cardItem?.name || '';
        const y = (cardItem?.release_date || cardItem?.first_air_date || '').slice(0, 4);
        let list = getMyList();
        if (isInMyList(id)) {
            saveMyList(list.filter(i => i.id !== id));
            showToast('Removed from My List');
        } else {
            saveMyList([{ id, type: mediaType, title: t, year: y, poster: cardItem?.poster_path || null, addedAt: Date.now() }, ...list]);
            showToast('Added to My List');
        }
        refreshQmList();
    });

    requestAnimationFrame(() => modal.classList.add('qm-visible'));
    tmdb(`/${mediaType}/${id}`, { append_to_response: 'credits' }).then(detail => {
        const backdrop = detail.backdrop_path ? `${TMDB_IMG}w1280${detail.backdrop_path}` : detail.poster_path ? `${TMDB_IMG}w780${detail.poster_path}` : null;
        if (backdrop) {
            const bg = document.getElementById('qm-backdrop');
            if (bg) bg.style.backgroundImage = `url(${backdrop})`;
        }
        const titleEl = document.getElementById('qm-title');
        if (titleEl) titleEl.textContent = detail.title || detail.name || '';
        const year = (detail.release_date || detail.first_air_date || '').slice(0, 4);
        const rating = detail.vote_average ? detail.vote_average.toFixed(1) : '—';
        const runtime = detail.runtime ? `${detail.runtime}m` : (detail.episode_run_time?.[0] ? `${detail.episode_run_time[0]}m/ep` : '');
        const metaEl = document.getElementById('qm-meta');
        if (metaEl) metaEl.innerHTML = `
            <span>${esc(year)}</span>
            ${runtime ? `<span>${esc(runtime)}</span>` : ''}
            <span class="qm-rating">${starIcon()} ${rating}</span>
            <span class="qm-type-badge">${mediaType === 'movie' ? 'Movie' : 'TV Series'}</span>`;
        const overviewEl = document.getElementById('qm-overview');
        if (overviewEl) overviewEl.textContent = detail.overview || 'No overview available.';
        const genresEl = document.getElementById('qm-genres');
        if (genresEl && detail.genres?.length)
            genresEl.innerHTML = detail.genres.slice(0, 4).map(g => `<span class="qm-genre-tag">${esc(g.name)}</span>`).join('');
    }).catch(() => { });
}

function renderCards(containerId, items) {
    const el = document.getElementById(containerId);
    el.innerHTML = '';
    items.forEach((item, i) => el.appendChild(makeCard(item, i)));

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
    el.scrollBy({left: dir * scrollAmount, behavior: 'smooth'});
    setTimeout(() => updateScrollButtons(id), 400);
}

function enableDragScroll(el) {
    let isDown = false;
    let startX;
    let scrollLeft;
    let moved = false;

    el.addEventListener('click', e => {if (moved) {e.preventDefault(); e.stopPropagation();}});
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

    const close = () => {modal.classList.add('qm-closing'); document.body.style.overflow = ''; setTimeout(() => modal.remove(), 250);};
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.getElementById('qm-close-btn').addEventListener('click', close);

    document.getElementById('qm-play-btn').addEventListener('click', () => {
        close();
        savedScrollY = window.scrollY;
        openDetail(id, mediaType, true);
    });
    document.getElementById('qm-detail-btn').addEventListener('click', () => {
        close();
        savedScrollY = window.scrollY;
        openDetail(id, mediaType, false);
    });

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
    tmdb(`/${mediaType}/${id}`, { append_to_response: 'credits' }).then(detail => {
        const backdrop = detail.backdrop_path ? `${TMDB_IMG}w1280${detail.backdrop_path}` : (detail.poster_path ? `${TMDB_IMG}w780${detail.poster_path}` : null);
        if (backdrop) {
            const bg = document.getElementById('qm-backdrop');
            if (bg) { bg.style.backgroundImage = `url(${backdrop})`; }
        }
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
        if (genresEl && detail.genres?.length) {
            genresEl.innerHTML = detail.genres.slice(0, 4).map(g => `<span class="qm-genre-tag">${esc(g.name)}</span>`).join('');
        }
    }).catch(() => { });
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

    hero.addEventListener('touchstart', e => {startX = e.touches[0].clientX; moved = false;}, {passive: true});
    hero.addEventListener('touchmove', e => {if (Math.abs(e.touches[0].clientX - startX) > 5) moved = true;}, {passive: true});
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
    if (!heroBg) return;
    const item = heroItems[heroIndex];
    if (!item) return;

    heroItem = item;
    const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
    const title = item.title || item.name;
    const year = (item.release_date || item.first_air_date || '').slice(0, 4);
    const rating = item.vote_average ? `${starIcon()} ${item.vote_average.toFixed(1)}` : '';
    heroBg.style.backgroundImage = `url(${backdropUrl(item.backdrop_path)})`;
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
    try {renderCards('movies-row', (await tmdb('/movie/popular')).results.slice(0, 14));} catch (e) {}
}

async function loadPopularTV() {
    showSkeletons('tv-row', 7);
    try {renderCards('tv-row', (await tmdb('/tv/popular')).results.slice(0, 14));} catch (e) {}
}

async function loadTurkishSeries() {
    showSkeletons('turkish-row', 7);
    try {
        const data = await tmdb('/discover/tv', {with_original_language: 'tr', sort_by: 'first_air_date.desc', 'first_air_date.gte': '2022-01-01', 'vote_count.gte': 10});
        renderCards('turkish-row', data.results.slice(0, 14).map(r => ({...r, media_type: 'tv'})));
    } catch (e) {}
}

// ─── NAVIGATION ───
function showPage(pageId) {
    document.getElementById('genre-bar').style.display = 'none';
    document.getElementById('filter-toggle').style.display = 'none';
    document.getElementById('filter-panel').style.display = 'none';
    document.getElementById('scroll-sentinel')?.remove();
    window.scrollTo(0, 0);
    ['home-page', 'search-page', 'player-page', 'stats-page', 'mylist-page'].forEach(id => {
        const el = document.getElementById(id);
        if (id === 'mylist-page') {
            const isTarget = id === pageId;
            el.style.display = isTarget ? 'block' : 'none';
            if (isTarget) triggerPageEnter(el);
            return;
        }
        if (id === 'home-page') {
            const isTarget = id === pageId;
            el.classList.toggle('hidden', !isTarget);
            if (isTarget) triggerPageEnter(el);
        } else {
            const isTarget = id === pageId;
            el.style.display = isTarget ? 'block' : 'none';
            if (isTarget) triggerPageEnter(el);
        }
        if (id === 'player-page') el.classList.toggle('active', id === pageId);
        if (id === 'search-page') el.classList.toggle('active', id === pageId);
    });
}

function triggerPageEnter(el) {
    el.classList.remove('page-enter');
    void el.offsetWidth;
    el.classList.add('page-enter');
}

function showHome() {
    const homePage = document.getElementById('home-page');
    const playerIframe = document.getElementById('player-iframe');
    if (homePage && !homePage.classList.contains('hidden')) {
        window.scrollTo({top: 0, behavior: 'smooth'});
        return;
    }
    if (playerIframe) {playerIframe.src = 'about:blank';}
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
    history.pushState({page: 'home', browse: 'home' }, '', location.pathname);
    document.title = 'StreamVault';
    window.scrollTo(0, 0);
}

function setActiveTab(id) {
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
    target.classList.remove('nav-entering');
    void target.offsetWidth;
    target.classList.add('nav-entering');
    setTimeout(() => target.classList.remove('nav-entering'), 350);
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
                window.scrollTo({top: savedScrollY, behavior: 'instant'});
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

async function doSearch(query, fromRoute = false) {
    if (!query.trim()) return;
    saveRecentSearch(query);
    showPage('search-page');
    renderSkeletons('search-results', 12);
    loadedIds.clear();
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
            document.getElementById('search-results').innerHTML = '<div class="empty-state"><div class="icon">🎬</div><p>No results found.</p></div>';
        } else {
            allResults = combined;
            activeGenre = 'all';
            document.querySelectorAll('.genre-btn').forEach(b => b.classList.toggle('active', b.dataset.genre === 'all'));
            document.getElementById('genre-bar').style.display = 'flex';
            combined.forEach(item => loadedIds.add(`${item.media_type}-${item.id}`));
            renderCards('search-results', combined);
            currentPage = 1;
            hasMorePages = false;
            isLoadingMore = false;
            currentSection = { mode: 'search', query };
            const el = document.getElementById('search-results');
            el.insertAdjacentHTML('afterend', '<div id="scroll-sentinel"></div>');
            attachScrollObserver();
        }
    } catch (e) {
        document.getElementById('search-results').innerHTML = '<div class="empty-state"><p>Search failed. Check your API key.</p></div>';
    }
}

async function fetchSearchSuggestions(query) {
    if (!query.trim()) return;
    try {
        if (!suggestionCache[query]) {
            const data = await tmdb('/search/multi', {query, page: 1});
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
    } catch (e) {}
}

function showSearchSuggestions(query) {
    const box = document.getElementById('recent-searches');
    const results = suggestionCache[query];
    const recent = getRecentSearches();

    box.addEventListener('mousedown', e => e.preventDefault());
    box.addEventListener('touchstart', e => e.preventDefault(), { passive: false });

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
            </button>`).join('')}` : '';

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

// ─── RECENT SEARCHES ───
function saveRecentSearch(query) {
    let recent = JSON.parse(localStorage.getItem('sv_recent_searches') || '[]');
    recent = [query, ...recent.filter(q => q.toLowerCase() !== query.toLowerCase())].slice(0, 5);
    localStorage.setItem('sv_recent_searches', JSON.stringify(recent));
}

function getRecentSearches() {
    return JSON.parse(localStorage.getItem('sv_recent_searches') || '[]');
}

function clearRecentSearches() {
    localStorage.removeItem('sv_recent_searches');
    document.getElementById('recent-searches').style.display = 'none';
}

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
        const box = document.getElementById('recent-searches');
        if (!box.matches(':hover')) {box.style.display = 'none';}
    }, 300);
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
        const detail = await tmdb(`/${mediaType}/${id}`, { append_to_response: 'external_ids,similar,credits' });
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
        document.getElementById('player-meta').innerHTML = `
            <span>${year}</span>
            ${runtime ? `<span>${runtime}</span>` : ''}
            <span class="rating">${starIcon()} ${rating}</span>
            ${(detail.genres || []).slice(0, 3).map(g =>
                `<button class="tag-link" onclick="browseGenre(${g.id},'${g.name.replace(/'/g, "\\'")}')">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg> ${g.name}
                </button>`
            ).join('')}`;
        document.getElementById('player-overview').textContent = detail.overview || '';
        renderCast(detail.credits?.cast || []);
        renderCollection(mediaType === 'movie' ? detail.belongs_to_collection : null, id);
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
    document.getElementById('season-selector').innerHTML = seasons.map(s =>
        `<button class="season-btn ${s.season_number === activeSeason ? 'active' : ''}" onclick="selectSeason(${s.season_number}, ${s.episode_count}, '${imdb || ''}', ${tmdbId})" id="s-btn-${s.season_number}"> Season ${s.season_number} </button>`
    ).join('');
    const active = seasons.find(s => s.season_number === activeSeason) || seasons[0];
    if (active) renderEpisodes(active.episode_count, activeSeason, imdb, tmdbId);
}

function selectSeason(num, count, imdb, tmdbId) {
    currentSeason = num;
    document.querySelectorAll('.season-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`s-btn-${num}`)?.classList.add('active');
    renderEpisodes(count, num, imdb, tmdbId);
    loadEpisode(num, 1, imdb, tmdbId);
}

function renderEpisodes(count, season, imdb, tmdbId, activeEp = 1) {
    const history = JSON.parse(localStorage.getItem('sv_history') || '{}');
    const showId = currentShow?.id;
    const watchedEps = new Set();
    if (showId && history[showId]) {
        const h = history[showId];
        if (h.season === season) {
            for (let e = 1; e <= h.episode; e++) watchedEps.add(e);
        } else if (h.season > season) {
            for (let e = 1; e <= count; e++) watchedEps.add(e);
        }
    }
    document.getElementById('episodes-grid').innerHTML =
        Array.from({length: count }, (_, i) => i + 1).map(ep => {
            const watched = watchedEps.has(ep);
            return `
            <button class="ep-btn ${ep === activeEp ? 'active' : ''} ${watched ? 'ep-watched' : ''}" id="ep-btn-${season}-${ep}"
                onclick="loadEpisode(${season}, ${ep}, '${imdb || ''}', ${tmdbId})"> Ep ${ep}${watched ? '<span class="ep-check">✓</span>' : ''}
            </button>`;
        }).join('');
}

function loadEpisode(season, episode, imdb, tmdbId, skipPush = false, t = 0) {
    document.querySelectorAll('.ep-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`ep-btn-${season}-${episode}`)?.classList.add('active');
    currentEmbed = {type: 'tv', imdb, tmdbId, season, episode };
    document.querySelectorAll('.src-btn').forEach(b => b.classList.toggle('active', b.dataset.src === currentSource));
    document.getElementById('source-bar').style.display = 'flex';
    const iframe = document.getElementById('player-iframe');
    if (iframe && !pendingWatchTogetherStartAt) {
        iframe.src = buildEmbedUrl(currentSource, 'tv', imdb, tmdbId, season, episode, t);
        addIframeBlocker();
    }
    document.getElementById('player-container').scrollIntoView({behavior: 'smooth', block: 'start'});
    if (!skipPush && currentShow) {
        const slug = currentShow.slug || slugify(currentShow.detail?.name || '');
        pushState({type: 'tv', id: tmdbId, name: slug, season, episode});
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
    const nbtn = document.getElementById('next-ep-btn');
    const nextIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/><line x1="19" y1="3" x2="19" y2="21" stroke="currentColor" stroke-width="2"/></svg>`;
    if (episode < totalEps) {
        nbtn.dataset.season = season;
        nbtn.dataset.episode = episode + 1;
        nbtn.innerHTML = `${nextIcon} S${season} E${episode + 1}`;
        bar.style.display = 'block';
    } else if (nextSeason) {
        nbtn.dataset.season = season + 1;
        nbtn.dataset.episode = 1;
        nbtn.innerHTML = `${nextIcon} Season ${season + 1} E1`;
        bar.style.display = 'block';
    } else {
        bar.style.display = 'none';
    }
}

function playNextEpisode() {
    if (!currentShow) return;
    const btn = document.getElementById('next-ep-btn');
    const season = parseInt(btn.dataset.season);
    const episode = parseInt(btn.dataset.episode);
    loadEpisode(season, episode, currentShow.imdb, currentShow.id);
    document.getElementById('player-container').scrollIntoView({behavior: 'smooth', block: 'start'});
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
    window.scrollTo({top: 0, behavior: 'smooth'});
    setTimeout(() => document.getElementById('search-input').focus(), 300);
}

// ─── CAST ───
function renderCast(cast) {
    const section = document.getElementById('cast-section');
    const row = document.getElementById('cast-row');
    const top = cast.slice(0, 20);
    if (!top.length) {section.style.display = 'none'; return;}
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
    const {type, imdb, tmdbId, season, episode } = currentEmbed;
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
    blocker.addEventListener('click', () => {blocker.remove();});
    container.appendChild(blocker);
}

// Keyboard shortcut
document.addEventListener('keydown', (e) => {
    const onPlayer = document.getElementById('player-page')?.classList.contains('active');
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;
    if (!onPlayer || typing || e.ctrlKey || e.metaKey) return;
    if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFullscreen();
    }
});

document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        doSearch(e.target.value);
        document.getElementById('recent-searches').style.display = 'none';
    }
});

document.addEventListener('click', e => {
    const box = document.getElementById('recent-searches');
    const input = document.getElementById('search-input');
    if (!box.contains(e.target) && e.target !== input) {
        box.style.display = 'none';
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            e.preventDefault();
            if (document.getElementById('search-page').style.display === 'none') {
                showPage('search-page');
            }
            window.scrollTo({top: 0, behavior: 'smooth'});
            searchInput.focus();
        }
    }
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
        // Company IDs (Movies)
        420: 'Marvel Studios',
        174: 'Warner Bros.',
        33: 'Universal',
        4: 'Paramount',
        2: 'Walt Disney',
        521: 'A24',
        923: 'Legendary',
        7295: 'Blumhouse',
    };
    const tags = [];
    // TV networks
    networks.slice(0, 3).forEach(n => {tags.push({label: KNOWN[n.id] || n.name, type: 'network', id: n.id, mediaType: 'tv'});});
    // Movie companies
    if (mediaType === 'movie') {
        companies.slice(0, 3).forEach(c => {if (KNOWN[c.id]) {tags.push({label: KNOWN[c.id], type: 'company', id: c.id, mediaType: 'movie'});}});
    }
    if (!tags.length) {el.style.display = 'none'; return;}
    el.style.display = 'flex';
    el.innerHTML = `
    <span style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;margin-right:4px;">On</span>
    ${tags.map(t => `
        <button class="tag-link" onclick="browseNetwork(${t.id},'${t.label.replace(/'/g, "\\'")}','${t.type}','${t.mediaType}')">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg> ${t.label}
        </button>`
    ).join('')}`;
}

async function browseGenre(genreId, genreName) {
    showPage('search-page');
    document.getElementById('search-input').value = genreName;
    document.getElementById('search-query-display').textContent = genreName;
    document.getElementById('search-count').textContent = 'Loading…';
    document.getElementById('search-results').innerHTML = '<div class="spinner"></div>';
    document.getElementById('filter-toggle').style.cssText = 'display:flex;margin-bottom:16px;';
    setActiveTab('');
    try {
        const [movies, shows] = await Promise.all([
            tmdb('/discover/movie', {with_genres: genreId, sort_by: 'popularity.desc', page: 1}),
            tmdb('/discover/tv', {with_genres: genreId, sort_by: 'popularity.desc', page: 1})
        ]);
        allResults = [
            ...movies.results.map(r => ({...r, media_type: 'movie'})),
            ...shows.results.map(r => ({...r, media_type: 'tv'}))
        ].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

        currentPage = 1;
        hasMorePages = false;
        isLoadingMore = false;
        currentSection = null;
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
        const data = await tmdb(endpoint, {[param]: networkId, sort_by: 'popularity.desc', page: 1});

        allResults = data.results.map(r => ({...r, media_type: mediaType}));
        currentPage = 1;
        hasMorePages = data.total_pages > 1;
        isLoadingMore = false;
        currentSection = {mode: 'network', networkId, type, mediaType, param };
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
        const {mediaType, mode, query } = currentSection;
        if (mode === 'search') {
            data = await tmdb('/search/multi', {query, page: currentPage + 1});
        } else if (mode === 'network') {
            const {networkId, type, mediaType: mt, param } = currentSection;
            const endpoint = mt === 'tv' ? '/discover/tv' : '/discover/movie';
            data = await tmdb(endpoint, {[param]: networkId, sort_by: 'popularity.desc', page: currentPage + 1});
            data.results = data.results.map(r => ({...r, media_type: mt}));
        } else {
            data = await tmdb(`/${mediaType}/popular`, {page: currentPage + 1});
        }
        currentPage++;
        hasMorePages = currentPage < data.total_pages;

        const items = mode === 'search' ? data.results.filter(r => r.media_type === 'movie' || r.media_type === 'tv') : data.results.map(r => ({...r, media_type: mediaType}));
        const container = document.getElementById('search-results');
        items.forEach((item, i) => {
            const uniqueId = `${item.media_type}-${item.id}`;
            if (!loadedIds.has(uniqueId)) {
                loadedIds.add(uniqueId);
                container.appendChild(makeCard(item, i));
            }
        });
    } catch (e) {}

    isLoadingMore = false;
    const sentinel2 = document.getElementById('scroll-sentinel');
    if (sentinel2) sentinel2.innerHTML = hasMorePages ? '' : '<p style="text-align:center;color:var(--text3);font-size:13px;padding:24px">No more results</p>';
}

const scrollObserver = new IntersectionObserver(entries => {if (entries[0].isIntersecting) loadMoreResults();}, {rootMargin: '200px'});
function attachScrollObserver() {
    const sentinel = document.getElementById('scroll-sentinel');
    if (sentinel) scrollObserver.observe(sentinel);
}

// ─── WATCH HISTORY ───
function saveHistory(item) {
    const history = JSON.parse(localStorage.getItem('sv_history') || '{}');
    const existing = history[item.id] || {};
    const genre_ids = window._pendingGenreIds?.id === item.id ? window._pendingGenreIds.genre_ids : existing.genre_ids || [];
    history[item.id] = {...existing, ...item, genre_ids, savedAt: Date.now() };
    localStorage.setItem('sv_history', JSON.stringify(history));
}

function getHistory() {
    const history = JSON.parse(localStorage.getItem('sv_history') || '{}');
    return Object.values(history).sort((a, b) => b.savedAt - a.savedAt);
}

function clearHistoryItem(id) {
    const history = JSON.parse(localStorage.getItem('sv_history') || '{}');
    delete history[id];
    localStorage.setItem('sv_history', JSON.stringify(history));
    renderContinueWatching();
}

function renderContinueWatching() {
    const section = document.getElementById('continue-watching-section');
    const row = document.getElementById('continue-watching-row');
    const items = getHistory().slice(0, 14);

    if (!items.length) {section.style.display = 'none'; return;}
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
                _pendingEp = {season: item.season, episode: item.episode};
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
                saveMyList([{id: item.id, type: item.type, title: item.title, year: item.year, poster: item.poster || null, addedAt: Date.now()}, ...list]);
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
    watchStart = Date.now();
    let historySaved = pendingHistoryItem === null;
    watchTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - watchStart) / 1000);
        if (!historySaved && elapsed >= 180) {
            saveHistory(pendingHistoryItem);
            historySaved = true;
            renderContinueWatching();
        }
        if (historySaved) {
            const history = JSON.parse(localStorage.getItem('sv_history') || '{}');
            if (history[id]) {
                history[id].timestamp = elapsed;
                localStorage.setItem('sv_history', JSON.stringify(history));
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
window.addEventListener('scroll', () => {document.getElementById('scroll-top').classList.toggle('visible', window.scrollY > 400);});

// ─── SECTION VIEW ───
async function fetchSection(mediaType) {
    showPage('search-page');
    pushState({browse: mediaType});
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
        const data = await tmdb(`/discover/${mediaType}`, {sort_by: 'popularity.desc', 'vote_count.gte': 100, page: 1});
        document.getElementById('search-count').textContent = `${data.total_results} titles`;
        allResults = data.results.map(r => ({...r, media_type: mediaType}));
        activeGenre = 'all';
        document.querySelectorAll('.genre-btn').forEach(b => b.classList.toggle('active', b.dataset.genre === 'all'));
        document.getElementById('genre-bar').style.display = 'flex';
        renderCards('search-results', allResults);
        currentPage = 1;
        hasMorePages = data.total_pages > 1;
        isLoadingMore = false;
        currentSection = {mode: 'section', mediaType };
        const el = document.getElementById('search-results');
        el.insertAdjacentHTML('afterend', '<div id="scroll-sentinel"></div>');
        attachScrollObserver();
    } catch (e) {}
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

// ─ STATS PAGE ─
function showStats(fromRoute = false) {
    showPage('stats-page');
    setActiveTab('tab-stats');
    setMobileTab('mtab-stats');
    if (!fromRoute) pushState({browse: 'stats'});
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
    items.forEach(i => {totalSeconds += i.timestamp || 0;});
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const days = new Set(items.map(i => new Date(i.savedAt).toDateString()));
    document.getElementById('stats-grid').innerHTML = [
        {value: hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`, label: 'Total Watch Time', sub: 'across all titles' },
        {value: movies.length, label: 'Movies Started', sub: `from your history` },
        {value: episodes.reduce((acc, s) => acc + (s.episode || 0), 0), label: 'Episodes Watched', sub: `across all shows` },
        {value: days.size, label: 'Days Watched', sub: `different days` },
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
    items.forEach(i => {(i.genre_ids || []).forEach(gid => {const name = genreMap[gid] || null; if (name) genreCounts[name] = (genreCounts[name] || 0) + 1;});});
    const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxG = topGenres[0]?.[1] || 1;
    document.getElementById('stats-genres').innerHTML = topGenres.length ? topGenres.map(([name, count]) => `
        <div class="genre-bar-row">
            <div class="genre-bar-label">${name}</div>
            <div class="genre-bar-track">
                <div class="genre-bar-fill" style="width:${Math.round((count / maxG) * 100)}%"></div>
            </div>
            <div class="genre-bar-count">${count}</div>
        </div>`).join('')
        : '<div style="color:var(--text3);font-size:13px">Watch more to see your top genres</div>';

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
    items.forEach(i => {const d = new Date(i.savedAt).toDateString(); activityMap[d] = (activityMap[d] || 0) + 1;});
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
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then(reg => console.log('SW registered:', reg.scope)).catch(err => console.log('SW failed:', err));
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
            tmdb('/discover/movie', {'primary_release_date.gte': from, 'primary_release_date.lte': to, sort_by: 'popularity.desc'}),
            tmdb('/discover/tv', {'first_air_date.gte': from, 'first_air_date.lte': to, sort_by: 'popularity.desc'})
        ]);
        const combined = [
            ...movies.results.map(r => ({...r, media_type: 'movie'})),
            ...shows.results.map(r => ({...r, media_type: 'tv'}))
        ].sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 14);
        if (!combined.length) {
            document.getElementById('new-this-week-row').innerHTML = '<div class="empty-state"><p>Nothing new this week yet.</p></div>';
            return;
        }
        renderCards('new-this-week-row', combined);
    } catch (e) {}
}

// ─── MY LIST ───
function getMyList() {return JSON.parse(localStorage.getItem('sv_mylist') || '[]');}
function saveMyList(list) {localStorage.setItem('sv_mylist', JSON.stringify(list));}
function isInMyList(id) {return getMyList().some(item => item.id === id);}
function updateMyListBtn(id) {syncMyListBtns(isInMyList(id));}

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
        showToast('Removed from My List');
    } else {
        list.unshift({ id, type, title, year, poster, addedAt: Date.now() });
        syncMyListBtns(true);
        showToast('Added to My List');
    }
    saveMyList(list);
}

function showMyList() {
    showPage('mylist-page');
    setActiveTab('tab-mylist');
    setMobileTab('mtab-mylist');
    pushState({ browse: 'mylist' });
    document.title = 'StreamVault';
    renderMyList();
}

function renderMyList() {
    const list = getMyList();
    const grid = document.getElementById('mylist-grid');
    const empty = document.getElementById('mylist-empty');
    const count = document.getElementById('mylist-count');
    count.textContent = `${list.length} title${list.length !== 1 ? 's' : ''} saved`;

    if (!list.length) {
        empty.style.display = 'block';
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
        div.innerHTML = poster
            ? `<div style="position:relative">
                    <img class="card-poster" src="${poster}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
                    <div class="card-poster-placeholder" style="display:none">${esc(item.title)}</div>
                </div>`
            : `<div style="position:relative"><div class="card-poster-placeholder">${esc(item.title)}</div></div>`;
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
    const list = getMyList().filter(i => i.id !== id);
    saveMyList(list);
    renderMyList();
    showToast('Removed from My List');
}

function showCardContextMenu(e, url, title) {
    document.getElementById('sv-context-menu')?.remove();
    const menu = document.createElement('div');
    menu.id = 'sv-context-menu';
    menu.className = 'sv-context-menu';
    menu.innerHTML = `
        <div class="sv-ctx-item sv-ctx-header">${esc(title.length > 28 ? title.slice(0, 28) + '…' : title)}</div>
        <div class="sv-ctx-divider"></div>
        <button class="sv-ctx-item sv-ctx-btn" id="sv-ctx-newtab">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Open in new tab
        </button>
        <button class="sv-ctx-item sv-ctx-btn" id="sv-ctx-copylink">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            Copy link
        </button>`;
    document.body.appendChild(menu);
    const vw = window.innerWidth, vh = window.innerHeight;
    menu.style.left = (e.clientX + 190 > vw ? e.clientX - 190 : e.clientX) + 'px';
    menu.style.top = (e.clientY + 110 > vh ? e.clientY - 110 : e.clientY) + 'px';
    requestAnimationFrame(() => menu.classList.add('sv-ctx-visible'));
    const fullUrl = location.origin + url;
    document.getElementById('sv-ctx-newtab').addEventListener('click', () => { window.open(fullUrl, '_blank', 'noopener'); menu.remove(); });
    document.getElementById('sv-ctx-copylink').addEventListener('click', () => { navigator.clipboard.writeText(fullUrl).then(() => showToast('Link copied!')); menu.remove(); });
    const close = e2 => { if (!menu.contains(e2.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
    const closeOnScroll = () => { menu.remove(); window.removeEventListener('scroll', closeOnScroll, true); };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
    window.addEventListener('scroll', closeOnScroll, true);
}

// ─── WATCH TOGETHER ───
let watchTogetherTimer = null;
let pendingWatchTogetherStartAt = null;

function generateWatchTogetherLink() {
    const startAt = Date.now() + 30000;
    const params = new URLSearchParams(location.search);
    params.set('startAt', startAt);
    const url = `${location.origin}${location.pathname}?${params.toString()}`;
    if (navigator.share) {
        navigator.share({title: 'StreamVault Sync', text: '🎬 Watch with me — starts in 30 seconds!', url}).catch(() => copyLinkToClipboard(url));
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
            if (type && id && iframe) {iframe.src = buildEmbedUrl(currentSource, type, null, id, currentEmbed.season || urlData.season, currentEmbed.episode || urlData.episode, 0);}
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
    const {type, imdb, tmdbId, season, episode } = currentEmbed;
    const iframe = document.getElementById('player-iframe');
    if (type && iframe) {iframe.src = buildEmbedUrl(currentSource, type, imdb, tmdbId, season, episode, 0);}
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
        navigator.share({title: document.title, url: location.href});
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
let activeFilters = {type: 'all', sort: 'popularity.desc', lang: '', yearFrom: 1950, yearTo: new Date().getFullYear(), rating: 0, genre: '', network: '', networkType: '' };

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
    if (from > to) {to = from; document.getElementById('year-to').value = to;}
    activeFilters.yearFrom = from;
    activeFilters.yearTo = to;
}

function resetFilters() {
    activeFilters = {type: 'all', sort: 'popularity.desc', lang: '', yearFrom: 1950, yearTo: 2026, rating: 0, genre: '', network: '', networkType: '' };
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
    const {type, sort, lang, yearFrom, yearTo, rating, genre, network, networkType } = activeFilters;
    const types = type === 'all' ? ['movie', 'tv'] : [type];

    if (!fromRestore) pushState({browse: 'filter', type, sort, lang, yearFrom, yearTo, rating, genre, network, networkType});
    document.getElementById('search-query-display').textContent = 'Filtered Results';
    document.getElementById('search-count').textContent = 'Loading…';
    document.getElementById('search-results').innerHTML = '<div class="spinner"></div>';
    document.getElementById('filter-panel').style.display = 'none';
    document.getElementById('filter-toggle-label').textContent = 'Filters';
    try {
        const results = await Promise.all(types.map(async t => {
            if (currentQuery) {
                const data = await tmdb(`/search/${t === 'movie' ? 'movie' : 'tv'}`, {query: currentQuery, page: 1});
                let items = data.results.map(r => ({...r, media_type: t}));
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
            const params = {sort_by: sortKey, [dateFromKey]: `${yearFrom}-01-01`, [dateToKey]: `${yearTo}-12-31`, 'vote_average.gte': rating, 'vote_count.gte': 50, page: 1 };
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
            return tmdb(`/discover/${t}`, params).then(d => d.results.map(r => ({...r, media_type: t})));
        }));
        allResults = results.flat().sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        currentPage = 1; hasMorePages = false; isLoadingMore = false; currentSection = null;
        activeGenre = 'all';
        document.querySelectorAll('.genre-btn').forEach(b => b.classList.toggle('active', b.dataset.genre === 'all'));
        document.getElementById('genre-bar').style.display = 'flex';
        document.getElementById('search-count').textContent = `${allResults.length} results`;
        if (!allResults.length) {
            document.getElementById('search-results').innerHTML = '<div class="empty-state"><div class="icon">🎬</div><p>No results. Try adjusting the filters.</p></div>';
        } else {
            renderCards('search-results', allResults);
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
    activeFilters = {type, sort, lang, genre, network, networkType, yearFrom, yearTo, rating };
    showPage('search-page');
    document.getElementById('filter-toggle').style.cssText = 'display:flex;margin-bottom:16px;';
    applyFilters(true);
}

// ─── EXPORT / IMPORT HISTORY ───
function exportHistory() {
    const payload = {
        history: JSON.parse(localStorage.getItem('sv_history') || '{}'),
        mylist: JSON.parse(localStorage.getItem('sv_mylist') || '[]')
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `streamvault-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Exported Successfully');
}

function importHistory(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);
            if (typeof data !== 'object' || Array.isArray(data)) {showToast('Invalid history file'); return;}
            const historyData = data.history || data;
            const mylistData = Array.isArray(data.mylist) ? data.mylist : [];
            const existing = JSON.parse(localStorage.getItem('sv_history') || '{}');
            const merged = {...historyData};
            for (const [id, item] of Object.entries(existing)) {
                if (!merged[id] || item.savedAt > merged[id].savedAt) {
                    merged[id] = item;
                }
            }
            localStorage.setItem('sv_history', JSON.stringify(merged));
            if (mylistData.length) {
                const existingList = JSON.parse(localStorage.getItem('sv_mylist') || '[]');
                const existingIds = new Set(existingList.map(i => i.id));
                const newItems = mylistData.filter(i => !existingIds.has(i.id));
                localStorage.setItem('sv_mylist', JSON.stringify([...existingList, ...newItems]));
            }
            renderContinueWatching();
            renderStats();
            renderMyList();
            const histCount = Object.keys(historyData).length;
            const listCount = mylistData.length;
            showToast(`Imported ${histCount} history + ${listCount} My List titles`);
        } catch {
            showToast('Failed to read file — make sure it\'s a valid export');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// ─── Notification / Toast ───
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}