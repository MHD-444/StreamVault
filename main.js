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
let currentEmbed = { type: null, imdb: null, tmdbId: null, season: null, episode: null };
let currentPage = 1;
let currentSection = null;
let isLoadingMore = false;
let hasMorePages = true;
let allResults = [];
let activeGenre = 'all';

// ─── INIT ───
window.addEventListener('DOMContentLoaded', () => {
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
    if (!k) { showToast('Please enter your TMDB API key'); return; }
    API_KEY = k;
    localStorage.setItem('tmdb_api_key', k);
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
    if (type && id) {
        if (type === 'tv' && season && episode)
            _pendingEp = { season: parseInt(season), episode: parseInt(episode) };
        if (startAt) pendingWatchTogetherStartAt = parseInt(startAt);
        openDetail(parseInt(id), type, false, true);
    } else if (p.get('browse')) {
        const browse = p.get('browse');
        if (browse === 'stats') showStats(true);
        else if (browse === 'filter') restoreFilters(p);
        else fetchSection(browse);
    } else if (search) {
        document.getElementById('search-input').value = decodeURIComponent(search);
        doSearch(decodeURIComponent(search), true);
    }
}

// ─── API FETCH ───
async function tmdb(path, params = {}) {
    const q = new URLSearchParams({ api_key: API_KEY, ...params });
    const res = await fetch(`${TMDB_BASE}${path}?${q}`);
    if (!res.ok) {
        if (res.status === 401) { showToast('Invalid API key — please update it'); showSetup(); }
        throw new Error('TMDB fetch failed');
    }
    return res.json();
}

// ─── RENDER HELPERS ───
function posterUrl(path, size = 'w342') { return path ? `${TMDB_IMG}${size}${path}` : null; }
function backdropUrl(path) { return path ? `${TMDB_IMG}w1280${path}` : null; }
function starIcon() {
    return `<svg width="11" height="11" viewBox="0 0 24 24" fill="var(--gold)"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
}

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
    const daysUntil = releaseMs > nowMs
        ? Math.ceil((releaseMs - nowMs) / (1000 * 60 * 60 * 24))
        : 0;
    const comingBadge = daysUntil > 0
        ? `<div class="coming-soon-badge">${daysUntil === 1 ? 'Tomorrow' : `In ${daysUntil} days`}</div>`
        : '';

    div.innerHTML = poster
        ? `<div style="position:relative">
            <img class="card-poster" src="${poster}" alt="${title}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
            <div class="card-poster-placeholder" style="display:none">${title}</div>
            ${comingBadge}
        </div>`
        : `<div style="position:relative">
            <div class="card-poster-placeholder">${title}</div>
            ${comingBadge}
        </div>`;
    div.innerHTML += `<div class="card-info">
        <div class="card-title">${title}</div>
        <div class="card-meta">
            <span>${year}</span>
            <span class="card-rating">${starIcon()} ${rating}</span>
        </div>
        <div style="margin-top:5px"><span class="card-type-badge">${mediaType === 'movie' ? 'Movie' : 'TV'}</span></div>
    </div>`;
    div.addEventListener('click', () => {
        savedScrollY = window.scrollY;
        if (item.genre_ids?.length) {
            const h = JSON.parse(localStorage.getItem('sv_history') || '{}');
            if (h[item.id]) { h[item.id].genre_ids = item.genre_ids; localStorage.setItem('sv_history', JSON.stringify(h)); }
        }
        openDetail(item.id, mediaType);
    });
    return div;
}

function renderCards(containerId, items) {
    const el = document.getElementById(containerId);
    el.innerHTML = '';
    items.forEach((item, i) => el.appendChild(makeCard(item, i)));
}

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
    dots.innerHTML = heroItems.slice(0, 5).map((_, i) => `<div class="hero-dot ${i === 0 ? 'active' : ''}" onclick="setHeroIndex(${i})"></div>`
    ).join('');
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

    // Touch support
    hero.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX; moved = false;
    }, { passive: true });

    hero.addEventListener('touchmove', e => {
        if (Math.abs(e.touches[0].clientX - startX) > 5) moved = true;
    }, { passive: true });

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
    const item = heroItems[heroIndex];
    heroItem = item;
    const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
    const title = item.title || item.name;
    const year = (item.release_date || item.first_air_date || '').slice(0, 4);
    const rating = item.vote_average ? `${starIcon()} ${item.vote_average.toFixed(1)}` : '';
    document.getElementById('hero-bg').style.backgroundImage = `url(${backdropUrl(item.backdrop_path)})`;
    document.getElementById('hero-title').textContent = title;
    document.getElementById('hero-year').textContent = year;
    document.getElementById('hero-type').textContent = mediaType === 'movie' ? 'Movie' : 'TV Series';
    document.getElementById('hero-rating').innerHTML = rating;
    document.getElementById('hero-overview').textContent = item.overview || '';
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
    try { renderCards('movies-row', (await tmdb('/movie/popular')).results.slice(0, 14)); } catch (e) { }
}
async function loadPopularTV() {
    showSkeletons('tv-row', 7);
    try { renderCards('tv-row', (await tmdb('/tv/popular')).results.slice(0, 14)); } catch (e) { }
}

async function loadTurkishSeries() {
    showSkeletons('turkish-row', 7);
    try {
        const data = await tmdb('/discover/tv', { with_original_language: 'tr', sort_by: 'first_air_date.desc', 'first_air_date.gte': '2022-01-01', 'vote_count.gte': 10 });
        renderCards('turkish-row', data.results.slice(0, 14).map(r => ({ ...r, media_type: 'tv' })));
    } catch (e) { }
}

// ─── NAVIGATION ───
function showPage(pageId) {
    document.getElementById('genre-bar').style.display = 'none';
    document.getElementById('filter-toggle').style.display = 'none';
    document.getElementById('filter-panel').style.display = 'none';
    document.getElementById('scroll-sentinel')?.remove();
    ['home-page', 'search-page', 'player-page', 'stats-page'].forEach(id => {
        const el = document.getElementById(id);
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
    stopWatchTimer();
    document.getElementById('source-bar').style.display = 'none';
    showPage('home-page');
    loadHomeContent();
    const input = document.getElementById('search-input');
    input.value = '';
    input.placeholder = 'Search movies, shows…';
    setActiveTab('tab-home');
    setMobileTab('mtab-home');
    history.pushState({}, '', location.pathname);
    document.title = 'StreamVault';
}

function setActiveTab(id) {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
}

function goBack() {
    stopWatchTimer();
    document.getElementById('player-iframe').src = '';
    document.getElementById('source-bar').style.display = 'none';
    if (history.length > 1) {
        history.back();
        setTimeout(() => {
            try {
                window.scrollTo({ top: savedScrollY, behavior: 'instant' });
            } catch {
                window.scrollTo(0, savedScrollY);
            }
        }, 80);
    } else {
        showHome();
    }
}

// ─── SEARCH ───
function onSearchInput(val) {
    clearTimeout(searchDebounce);
    document.getElementById('recent-searches').style.display = 'none';
    if (!val.trim()) { showRecentSearches(); return; }
    searchDebounce = setTimeout(() => doSearch(val), 500);
}

async function doSearch(query, fromRoute = false) {
    if (!query.trim()) return;
    saveRecentSearch(query);
    showPage('search-page');
    document.getElementById('filter-toggle').style.cssText = 'display:flex;margin-bottom:16px;';
    if (!fromRoute) pushState({ search: encodeURIComponent(query) });
    document.getElementById('search-query-display').textContent = `"${query}"`;
    document.getElementById('search-count').textContent = 'Searching…';
    document.getElementById('search-results').innerHTML = '<div class="spinner"></div>';
    try {
        const [movies, shows] = await Promise.all([ tmdb('/search/movie', { query }), tmdb('/search/tv', { query }) ]);
        const combined = [
            ...movies.results.map(r => ({ ...r, media_type: 'movie' })),
            ...shows.results.map(r => ({ ...r, media_type: 'tv' }))
        ].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        document.getElementById('search-count').textContent = `${combined.length} results`;
        if (!combined.length) {
            document.getElementById('search-results').innerHTML = '<div class="empty-state"><div class="icon">🎬</div><p>No results found.</p></div>';
        } else {
            allResults = combined;
            activeGenre = 'all';
            document.querySelectorAll('.genre-btn').forEach(b => b.classList.toggle('active', b.dataset.genre === 'all'));
            document.getElementById('genre-bar').style.display = 'flex';
            renderCards('search-results', combined);
            currentPage = 1;
            hasMorePages = true;
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
    if (!recent.length) {
        box.innerHTML = '<div class="recent-empty">No recent searches</div>';
    } else {
        box.innerHTML = `
            <div class="recent-header">
                <span>Recent</span>
                <button class="recent-clear" onmousedown="event.preventDefault();clearRecentSearches()">Clear all</button>
            </div>
            ${recent.map(q => `
                <button class="recent-item"
                    onmousedown="event.preventDefault();pickRecentSearch('${q.replace(/'/g, "\\'")}')">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <span>${q}</span>
                </button>`).join('')}`;
    }
    box.style.display = 'block';
}

function hideRecentSearches() {
    setTimeout(() => {document.getElementById('recent-searches').style.display = 'none';}, 150);
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
    const filtered = genre === 'all'
        ? allResults
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
    document.getElementById('player-overview').innerHTML = '<div class="skeleton" style="height:16px;width:100%;border-radius:4px;margin-bottom:8px;"></div><div class="skeleton" style="height:16px;width:90%;border-radius:4px;margin-bottom:8px;"></div><div class="skeleton" style="height:16px;width:75%;border-radius:4px;"></div>';
    document.getElementById('cast-section').style.display = 'none';
    document.getElementById('collection-section').style.display = 'none';
    document.getElementById('player-networks').style.display = 'none';
}

// ─── DETAIL / PLAYER ───
async function openDetail(id, mediaType, autoPlay = false, fromRoute = false) {
    showPage('player-page');
    window.scrollTo(0, 0);
    showPlayerSkeleton();
    document.getElementById('player-meta').innerHTML = '';
    document.getElementById('player-overview').textContent = '';
    document.getElementById('episodes-section').style.display = 'none';
    document.getElementById('next-ep-bar').style.display = 'none';
    document.getElementById('similar-row').innerHTML = '';
    try {
        const detail = await tmdb(`/${mediaType}/${id}`, { append_to_response: 'external_ids,similar,credits' });
        const imdb = detail.external_ids?.imdb_id || null;
        const title = detail.title || detail.name;
        const slug = slugify(title);
        const year = (detail.release_date || detail.first_air_date || '').slice(0, 4);
        const rating = detail.vote_average ? detail.vote_average.toFixed(1) : '—';
        const t = _pendingTimestamp || 0;
        _pendingTimestamp = 0;
        const runtime = detail.runtime ? `${detail.runtime}min`: (detail.episode_run_time?.[0] ? `${detail.episode_run_time[0]}min/ep` : '');

        document.getElementById('player-title').textContent = title;
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
            if (iframe && !pendingWatchTogetherStartAt) {iframe.src = buildEmbedUrl('primesrc', 'movie', imdb, id, null, null, t);}
            startWatchTimer(id, 'movie', { id, type: 'movie', title, poster: detail.poster_path, year, runtime: detail.runtime || 90 });
        } else {
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
        const similar = (detail.similar?.results || []).slice(0, 14);
        if (similar.length)
            renderCards('similar-row', similar.map(r => ({ ...r, media_type: mediaType })));
        if (pendingWatchTogetherStartAt) {
            const sat = pendingWatchTogetherStartAt;
            pendingWatchTogetherStartAt = null;
            startWatchTogetherCountdown(sat);
        }
    } catch (e) {
        document.getElementById('player-title').textContent = 'Failed to load';
    }
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
    document.getElementById('episodes-grid').innerHTML =
        Array.from({ length: count }, (_, i) => i + 1).map(ep =>
            `<button class="ep-btn ${ep === activeEp ? 'active' : ''}" id="ep-btn-${season}-${ep}" onclick="loadEpisode(${season}, ${ep}, '${imdb || ''}', ${tmdbId})"> Ep ${ep} </button>`
        ).join('');
}

function loadEpisode(season, episode, imdb, tmdbId, skipPush = false, t = 0) {
    document.querySelectorAll('.ep-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`ep-btn-${season}-${episode}`)?.classList.add('active');
    currentSource = 'primesrc';
    currentEmbed = { type: 'tv', imdb, tmdbId, season, episode };
    document.querySelectorAll('.src-btn').forEach(b => b.classList.toggle('active', b.dataset.src === 'primesrc'));
    document.getElementById('source-bar').style.display = 'flex';
    const iframe = document.getElementById('player-iframe');
    if (iframe && !pendingWatchTogetherStartAt) {iframe.src = buildEmbedUrl('primesrc', 'tv', imdb, tmdbId, season, episode, t);}
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
    document.getElementById('player-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        ? `<img class="cast-avatar" src="${photo}" alt="${actor.name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
        <div class="cast-avatar-placeholder" style="display:none">👤</div>`
        : `<div class="cast-avatar-placeholder">👤</div>`;
        div.innerHTML += ` <div class="cast-name">${actor.name}</div> <div class="cast-character">${actor.character || ''}</div>`;
        row.appendChild(div);
    });
}

// ─── SOURCE SWITCHER ───
function buildEmbedUrl(source, type, imdb, tmdbId, season, episode, t = 0) {
    const id = imdb && imdb !== 'null' ? imdb : null;
    if (type === 'movie') {
        switch (source) {
            case 'primesrc': return id ? `https://primesrc.me/embed/movie?imdb=${id}&t=${t}` : `https://primesrc.me/embed/movie?tmdb=${tmdbId}&t=${t}`;
            case 'vidsrc': return id ? `https://vidsrc.me/embed/movie?imdb=${id}` : `https://vidsrc.me/embed/movie?tmdb=${tmdbId}`;
        }
    } else {
        switch (source) {
            case 'primesrc': return id ? `https://primesrc.me/embed/tv?imdb=${id}&season=${season}&episode=${episode}&t=${t}` : `https://primesrc.me/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}&t=${t}`;
            case 'vidsrc': return id ? `https://vidsrc.me/embed/tv?imdb=${id}&season=${season}&episode=${episode}` : `https://vidsrc.me/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`;
        }
    }
}

function switchSource(source) {
    currentSource = source;
    document.querySelectorAll('.src-btn').forEach(b => b.classList.toggle('active', b.dataset.src === source));
    const { type, imdb, tmdbId, season, episode } = currentEmbed;
    if (!type) return;
    const url = buildEmbedUrl(source, type, imdb, tmdbId, season, episode);
    document.getElementById('player-iframe').src = url;
}

// ─── FULLSCREEN TOGGLE ───
let isFullscreen = false;
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
    networks.slice(0, 3).forEach(n => { tags.push({ label: KNOWN[n.id] || n.name, type: 'network', id: n.id, mediaType: 'tv' }); });
    // Movie companies
    if (mediaType === 'movie') {
        companies.slice(0, 3).forEach(c => {if (KNOWN[c.id]) { tags.push({ label: KNOWN[c.id], type: 'company', id: c.id, mediaType: 'movie' });}});
    }
    if (!tags.length) { el.style.display = 'none'; return; }
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
            tmdb('/discover/movie', { with_genres: genreId, sort_by: 'popularity.desc', page: 1 }),
            tmdb('/discover/tv', { with_genres: genreId, sort_by: 'popularity.desc', page: 1 })
        ]);
        allResults = [
            ...movies.results.map(r => ({ ...r, media_type: 'movie' })),
            ...shows.results.map(r => ({ ...r, media_type: 'tv' }))
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
        const data = await tmdb(endpoint, { [param]: networkId, sort_by: 'popularity.desc', page: 1 });

        allResults = data.results.map(r => ({ ...r, media_type: mediaType }));
        currentPage = 1;
        hasMorePages = data.total_pages > 1;
        isLoadingMore = false;
        currentSection = { mode: 'network', networkId, type, mediaType, param };
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

        const items = mode === 'search'
            ? data.results.filter(r => r.media_type === 'movie' || r.media_type === 'tv')
            : data.results.map(r => ({ ...r, media_type: mediaType }));
        const container = document.getElementById('search-results');
        items.forEach((item, i) => container.appendChild(makeCard(item, i)));
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
function saveHistory(item) {
    const history = JSON.parse(localStorage.getItem('sv_history') || '{}');
    const existing = history[item.id] || {};
    history[item.id] = { ...existing, ...item, savedAt: Date.now() };
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
        const pct = runtime > 0 ? Math.min(Math.round((timestamp / runtime) * 100), 99): 0;
        const placeholderIcon = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
        div.innerHTML = poster
        ? `<div style="position:relative">
            <img class="card-poster" src="${poster}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
            <div class="card-poster-placeholder" style="display:none">${placeholderIcon}<span>${item.title}</span></div>
            ${pct > 0 ? `<div class="card-progress"><div class="card-progress-fill" style="width:${pct}%"></div></div>` : ''}
        </div>`
        : `<div style="position:relative">
            <div class="card-poster-placeholder">${placeholderIcon}<span>${item.title}</span></div>
            ${pct > 0 ? `<div class="card-progress"><div class="card-progress-fill" style="width:${pct}%"></div></div>` : ''}
        </div>`;

        div.innerHTML += `
        <div class="card-info">
            <div class="card-title">${item.title}</div>
            <div class="card-meta">
                <span style="color:var(--gold);font-size:11px">${sub}</span>
                    <button onclick="event.stopPropagation();clearHistoryItem(${item.id})" style="font-size:10px;color:var(--text3);padding:2px 6px;background:var(--surface3);border-radius:3px;border:1px solid var(--border)"> ✕ </button>
            </div>
        </div>`;

        div.addEventListener('click', () => {
            const resumeAt = item.timestamp || 0;
            if (item.type === 'tv') {
                _pendingEp = { season: item.season, episode: item.episode };
                _pendingTimestamp = resumeAt;
            } else {
                _pendingTimestamp = resumeAt;
            }
            openDetail(item.id, item.type, false, false);
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
window.addEventListener('scroll', () => { document.getElementById('scroll-top').classList.toggle('visible', window.scrollY > 400); });

// ─── SECTION VIEW ───
async function fetchSection(mediaType) {
    showPage('search-page');
    pushState({ browse: mediaType });
    document.getElementById('filter-toggle').style.cssText = 'display:flex;margin-bottom:16px;';
    const label = mediaType === 'movie' ? 'Movies' : 'TV Shows';
    const input = document.getElementById('search-input');
    input.value = label;
    input.placeholder = '';
    document.getElementById('search-query-display').textContent = label;
    document.getElementById('search-count').textContent = 'Loading…';
    document.getElementById('search-results').innerHTML = '<div class="spinner"></div>';
    setActiveTab(mediaType === 'movie' ? 'tab-movies' : 'tab-tv');
    try {
        const data = await tmdb(`/${mediaType}/popular`);
        document.getElementById('search-count').textContent = `${data.total_results} titles`;
        allResults = data.results.map(r => ({ ...r, media_type: mediaType }));
        activeGenre = 'all';
        document.querySelectorAll('.genre-btn').forEach(b => b.classList.toggle('active', b.dataset.genre === 'all'));
        document.getElementById('genre-bar').style.display = 'flex';
        renderCards('search-results', allResults);
        currentPage = 1;
        hasMorePages = data.total_pages > 1;
        isLoadingMore = false;
        currentSection = { mode: 'section', mediaType };
        const el = document.getElementById('search-results');
        el.insertAdjacentHTML('afterend', '<div id="scroll-sentinel"></div>');
        attachScrollObserver();
    } catch (e) { }
}

// ─── COLLECTION ───
async function renderCollection(belongsToCollection, currentId) {
    const section = document.getElementById('collection-section');
    if (!belongsToCollection) { section.style.display = 'none'; return; }
    try {
        const data = await tmdb(`/collection/${belongsToCollection.id}`);
        const parts = (data.parts || [])
            .sort((a, b) => (a.release_date || '').localeCompare(b.release_date || ''));
        if (parts.length <= 1) { section.style.display = 'none'; return; }
        document.getElementById('collection-title').textContent =
            data.name || 'Part of a Collection';
        const row = document.getElementById('collection-row');
        row.innerHTML = '';

        parts.forEach((item, i) => {
            const isCurrent = item.id === currentId;
            const div = document.createElement('div');
            div.className = 'card';
            div.style.animationDelay = `${i * 0.04}s`;
            if (isCurrent) div.style.outline = '2px solid var(--gold)';
            const poster = posterUrl(item.poster_path);
            const year = (item.release_date || '').slice(0, 4);
            const rating = item.vote_average ? item.vote_average.toFixed(1) : '—';

            div.innerHTML = poster
                ? `<img class="card-poster" src="${poster}" alt="${item.title}" loading="lazy"
                    onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
                <div class="card-poster-placeholder" style="display:none">${item.title}</div>`
                : `<div class="card-poster-placeholder">${item.title}</div>`;
            div.innerHTML += `
                <div class="card-info">
                    <div class="card-title">${isCurrent ? '▶ ' : ''}${item.title}</div>
                    <div class="card-meta">
                        <span>${year}</span>
                        <span class="card-rating">${starIcon()} ${rating}</span>
                    </div>
                    ${isCurrent ? `<div style="margin-top:5px"><span class="card-type-badge">Watching</span></div>` : ''}
                </div>`;

            if (!isCurrent) {
                div.addEventListener('click', () => openDetail(item.id, 'movie'));
            } else {
                div.style.cursor = 'default';
            }
            row.appendChild(div);
        });
        section.style.display = 'block';
    } catch (e) {
        section.style.display = 'none';
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

// ─── STATS PAGE ───
function showStats(fromRoute = false) {
    showPage('stats-page');
    setActiveTab('tab-stats');
    setMobileTab('mtab-stats');
    if (!fromRoute) pushState({ browse: 'stats' });
    document.title = 'StreamVault';
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
    items.forEach(i => {(i.genre_ids || []).forEach(gid => { const name = genreMap[gid] || null; if (name) genreCounts[name] = (genreCounts[name] || 0) + 1; });});
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

    // ── Recently watched ──
    const recent = items.sort((a, b) => b.savedAt - a.savedAt).slice(0, 6);
    document.getElementById('stats-recent').innerHTML = recent.map(item => {
        const poster = item.poster ? `${TMDB_IMG}w92${item.poster}` : null;
        const sub = item.type === 'tv' ? `S${item.season} E${item.episode}` : item.year || '';
        const ago = timeAgo(item.savedAt);
        return `
            <div class="recent-item-stat">
                ${poster
                ? `<img src="${poster}" onerror="this.style.opacity='0'">`
                : `<div style="width:36px;height:54px;background:var(--surface2);border-radius:4px;flex-shrink:0"></div>`}
                <div class="info">
                    <div class="rtitle">${item.title}</div>
                    <div class="rsub">${sub} · ${ago}</div>
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

// ─── WATCH TOGETHER ───
let watchTogetherTimer = null;
let pendingWatchTogetherStartAt = null;

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
    const { type, imdb, tmdbId, season, episode } = currentEmbed;
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
let activeFilters = { type: 'all', sort: 'popularity.desc', lang: '', yearFrom: 1950, yearTo: 2026, rating: 0, genre: '', network: '', networkType: '' };
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
    document.getElementById('year-to').value = 2026;
    document.getElementById('filter-rating').value = 0;
    document.getElementById('rating-label').textContent = '0+';
}

async function applyFilters(fromRestore = false) {
    activeFilters.type = document.getElementById('filter-type').value;
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
        const results = await Promise.all(types.map(t => {
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
    activeFilters = { type, sort, lang, genre, network, networkType, yearFrom, yearTo, rating };
    showPage('search-page');
    document.getElementById('filter-toggle').style.cssText = 'display:flex;margin-bottom:16px;';
    applyFilters(true);
}

// ─── TOAST ───
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}
