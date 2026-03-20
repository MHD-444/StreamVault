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

function initApp() {
    loadTrending();
    loadNewThisWeek();
    loadPopularMovies();
    loadPopularTV();
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
    if (params.type === 'movie') return `${name} — StreamVault`;
    if (params.type === 'tv' && params.season && params.episode)
        return `${name} · S${String(params.season).padStart(2, '0')}E${String(params.episode).padStart(2, '0')} — StreamVault`;
    if (params.type === 'tv') return `${name} — StreamVault`;
    if (params.search) return `Search: ${decodeURIComponent(params.search)} — StreamVault`;
    return 'StreamVault';
}

function handleRoute() {
    const p = new URLSearchParams(location.search);
    const type = p.get('type');
    const id = p.get('id');
    const season = p.get('season');
    const episode = p.get('episode');
    const search = p.get('search');

    if (type && id) {
        if (type === 'tv' && season && episode)
            _pendingEp = { season: parseInt(season), episode: parseInt(episode) };
        openDetail(parseInt(id), type, false, true);
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
        <img class="card-poster" src="${poster}" alt="${title}" loading="lazy"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
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
    div.addEventListener('click', () => openDetail(item.id, mediaType));
    return div;
}

function renderCards(containerId, items) {
    const el = document.getElementById(containerId);
    el.innerHTML = '';
    items.forEach((item, i) => el.appendChild(makeCard(item, i)));
}

function showSkeletons(containerId, count = 7) {
    document.getElementById(containerId).innerHTML =
        Array(count).fill(`<div class="skeleton skel-card"></div>`).join('');
}

// ─── HERO ───
function setHero(items) {
    heroItems = items.filter(i => i.backdrop_path);
    if (!heroItems.length) return;
    heroIndex = 0;
    updateHero();
    const dots = document.getElementById('hero-dots');
    dots.innerHTML = heroItems.slice(0, 5).map((_, i) =>
        `<div class="hero-dot ${i === 0 ? 'active' : ''}" onclick="setHeroIndex(${i})"></div>`
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
        startX = e.touches[0].clientX;
        moved = false;
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
        document.getElementById('trending-row').innerHTML =
            '<div class="empty-state"><p>Failed to load. Check your API key.</p></div>';
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

// ─── NAVIGATION ───
function showPage(pageId) {
    document.getElementById('genre-bar').style.display = 'none';
    document.getElementById('filter-toggle').style.display = 'none';
    document.getElementById('filter-panel').style.display = 'none';
    document.getElementById('scroll-sentinel')?.remove();
    ['home-page', 'search-page', 'player-page'].forEach(id => {
        const el = document.getElementById(id);
        if (id === 'home-page') {
            el.classList.toggle('hidden', id !== pageId);
        } else {
            el.style.display = id === pageId ? 'block' : 'none';
        }
        if (id === 'player-page') el.classList.toggle('active', id === pageId);
        if (id === 'search-page') el.classList.toggle('active', id === pageId);
    });
}

function showHome() {
    stopWatchTimer();
    document.getElementById('player-iframe').src = '';
    document.getElementById('source-bar').style.display = 'none';
    showPage('home-page');
    document.getElementById('search-input').value = '';
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
    stopWatchTimer()
    document.getElementById('player-iframe').src = '';
    document.getElementById('source-bar').style.display = 'none';
    history.length > 1 ? history.back() : showHome();
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
    setTimeout(() => {
        document.getElementById('recent-searches').style.display = 'none';
    }, 150);
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

// ─── DETAIL / PLAYER ───
async function openDetail(id, mediaType, autoPlay = false, fromRoute = false) {
    showPage('player-page');
    window.scrollTo(0, 0);
    document.getElementById('player-title').textContent = 'Loading…';
    document.getElementById('player-meta').innerHTML = '';
    document.getElementById('player-overview').textContent = '';
    document.getElementById('episodes-section').style.display = 'none';
    document.getElementById('next-ep-bar').style.display = 'none';
    document.getElementById('similar-row').innerHTML = '';
    document.getElementById('player-iframe').src = '';
    try {
        const detail = await tmdb(`/${mediaType}/${id}`, { append_to_response: 'external_ids,similar,credits' });
        const imdb = detail.external_ids?.imdb_id || null;
        const title = detail.title || detail.name;
        const slug = slugify(title);
        const year = (detail.release_date || detail.first_air_date || '').slice(0, 4);
        const rating = detail.vote_average ? detail.vote_average.toFixed(1) : '—';
        const t = _pendingTimestamp || 0;
        _pendingTimestamp = 0;
        const runtime = detail.runtime
            ? `${detail.runtime}min`
            : (detail.episode_run_time?.[0] ? `${detail.episode_run_time[0]}min/ep` : '');

        document.getElementById('player-title').textContent = title;
        document.getElementById('player-meta').innerHTML = `
            <span>${year}</span>
            ${runtime ? `<span>${runtime}</span>` : ''}
            <span class="rating">${starIcon()} ${rating}</span>
            ${(detail.genres || []).slice(0, 3).map(g =>
            `<button class="tag-link" onclick="browseGenre(${g.id},'${g.name.replace(/'/g, "\\'")}')">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                    ${g.name}
                </button>`
        ).join('')}`;

        document.getElementById('player-overview').textContent = detail.overview || '';
        renderCast(detail.credits?.cast || []);
        renderCollection(mediaType === 'movie' ? detail.belongs_to_collection : null, id);
        renderNetworks(detail.networks || [], detail.production_companies || [], mediaType);

        if (detail.backdrop_path)
            document.getElementById('player-container').style.background =
                `url(${backdropUrl(detail.backdrop_path)}) center/cover`;
        if (mediaType === 'movie') {
            if (!fromRoute) pushState({ type: 'movie', id, name: slug });
            currentSource = 'primesrc';
            currentEmbed = { type: 'movie', imdb, tmdbId: id, season: null, episode: null };
            document.querySelectorAll('.src-btn').forEach(b => b.classList.toggle('active', b.dataset.src === 'primesrc'));
            document.getElementById('source-bar').style.display = 'flex';
            document.getElementById('player-iframe').src = buildEmbedUrl('primesrc', 'movie', imdb, id, null, null, t);
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
    } catch (e) {
        document.getElementById('player-title').textContent = 'Failed to load';
    }
}

// ─── SEASONS & EPISODES ───
function renderSeasons(detail, imdb, tmdbId, activeSeason = 1) {
    const seasons = (detail.seasons || []).filter(s => s.season_number > 0);
    document.getElementById('season-selector').innerHTML = seasons.map(s =>
        `<button class="season-btn ${s.season_number === activeSeason ? 'active' : ''}"
            onclick="selectSeason(${s.season_number}, ${s.episode_count}, '${imdb || ''}', ${tmdbId})"
            id="s-btn-${s.season_number}">
            Season ${s.season_number}
        </button>`
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
            `<button class="ep-btn ${ep === activeEp ? 'active' : ''}"
                id="ep-btn-${season}-${ep}"
                onclick="loadEpisode(${season}, ${ep}, '${imdb || ''}', ${tmdbId})">
                Ep ${ep}
            </button>`
        ).join('');
}

function loadEpisode(season, episode, imdb, tmdbId, skipPush = false, t = 0) {
    document.querySelectorAll('.ep-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`ep-btn-${season}-${episode}`)?.classList.add('active');
    currentSource = 'primesrc';
    currentEmbed = { type: 'tv', imdb, tmdbId, season, episode };
    document.querySelectorAll('.src-btn').forEach(b => b.classList.toggle('active', b.dataset.src === 'primesrc'));
    document.getElementById('source-bar').style.display = 'flex';
    document.getElementById('player-iframe').src = buildEmbedUrl('primesrc', 'tv', imdb, tmdbId, season, episode, t);
    document.getElementById('player-container').scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (!skipPush && currentShow) {
        const slug = currentShow.slug || slugify(currentShow.detail?.name || '');
        pushState({ type: 'tv', id: tmdbId, name: slug, season, episode });
    }
    if (currentShow) {
        saveHistory({ id: currentShow.id, type: 'tv', title: currentShow.detail.name, poster: currentShow.detail.poster_path, year: (currentShow.detail.first_air_date || '').slice(0, 4), season, episode, epRuntime: currentShow.detail.episode_run_time?.[0] || 40 });
        startWatchTimer(currentShow.id, 'tv');
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
        const photo = actor.profile_path
            ? `${TMDB_IMG}w185${actor.profile_path}`
            : null;

        div.innerHTML = photo
        ? `<img class="cast-avatar" src="${photo}" alt="${actor.name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
        <div class="cast-avatar-placeholder" style="display:none">👤</div>`
        : `<div class="cast-avatar-placeholder">👤</div>`;
        div.innerHTML += `
            <div class="cast-name">${actor.name}</div>
            <div class="cast-character">${actor.character || ''}</div>`;
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
            case 'vidsrctop': return id ? `https://vidsrc.to/embed/movie/${id}` : `https://vidsrc.to/embed/movie/${tmdbId}`;
            case 'embedsu': return id ? `https://embed.su/embed/movie/${id}` : `https://embed.su/embed/movie/${tmdbId}`;
        }
    } else {
        switch (source) {
            case 'primesrc': return id ? `https://primesrc.me/embed/tv?imdb=${id}&season=${season}&episode=${episode}&t=${t}` : `https://primesrc.me/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}&t=${t}`;
            case 'vidsrc': return id ? `https://vidsrc.me/embed/tv?imdb=${id}&season=${season}&episode=${episode}` : `https://vidsrc.me/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`;
            case 'vidsrctop': return id ? `https://vidsrc.to/embed/tv/${id}/${season}/${episode}` : `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}`;
            case 'embedsu': return id ? `https://embed.su/embed/tv/${id}/${season}/${episode}` : `https://embed.su/embed/tv/${tmdbId}/${season}/${episode}`;
        }
    }
}

function switchSource(source) {
    currentSource = source;
    document.querySelectorAll('.src-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.src === source));
    document.getElementById('src-status').textContent = '';
    const { type, imdb, tmdbId, season, episode } = currentEmbed;
    if (!type) return;
    const url = buildEmbedUrl(source, type, imdb, tmdbId, season, episode);
    document.getElementById('player-iframe').src = url;
    document.getElementById('src-status').textContent = `Loading ${source}…`;
    document.getElementById('player-iframe').onload = () => {
        document.getElementById('src-status').textContent = '';
    };
}

// ─── DRAGGABLE PLAYER ───
(function () {
    let floating = false, dragging = false, ox = 0, oy = 0;
    const isMobile = () => window.innerWidth <= 768;

    function dockPlayer() {
        const pc = document.getElementById('player-container');
        pc.classList.add('is-floating');
        document.getElementById('popout-btn').style.display = 'none';
        floating = true;
        if (!isMobile()) {
            pc.style.left = (window.innerWidth - 360) + 'px';
            pc.style.top = (window.innerHeight - 220) + 'px';
        } else {
            pc.style.left = '';
            pc.style.top = '';
        }
    }

    function undockPlayer() {
        const pc = document.getElementById('player-container');
        pc.classList.remove('is-floating');
        pc.style.left = pc.style.top = '';
        document.getElementById('popout-btn').style.display = '';
        floating = false;
    }

    // ── Mouse drag (desktop only) ──
    document.addEventListener('mousedown', e => {
        if (!floating || isMobile()) return;
        const overlay = document.getElementById('drag-overlay');
        const handle = document.getElementById('drag-handle');
        if (!overlay.contains(e.target) && !handle.contains(e.target)) return;
        if (e.target.closest('.drag-close-btn')) return;
        e.preventDefault();
        dragging = true;
        const r = document.getElementById('player-container').getBoundingClientRect();
        ox = e.clientX - r.left;
        oy = e.clientY - r.top;
    });
    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        const pc = document.getElementById('player-container');
        pc.style.left = Math.max(0, Math.min(window.innerWidth - pc.offsetWidth, e.clientX - ox)) + 'px';
        pc.style.top = Math.max(0, Math.min(window.innerHeight - pc.offsetHeight, e.clientY - oy)) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
    document.getElementById('drag-handle')?.addEventListener('touchend', e => {
        if (e.target.closest('.drag-close-btn')) undockPlayer();
    });

    window.dockPlayer = dockPlayer;
    window.undockPlayer = undockPlayer;
})();

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
    networks.slice(0, 3).forEach(n => {
        tags.push({
            label: KNOWN[n.id] || n.name,
            type: 'network',
            id: n.id,
            mediaType: 'tv'
        });
    });

    // Movie companies
    if (mediaType === 'movie') {
        companies.slice(0, 3).forEach(c => {
            if (KNOWN[c.id]) {
                tags.push({
                    label: KNOWN[c.id],
                    type: 'company',
                    id: c.id,
                    mediaType: 'movie'
                });
            }
        });
    }

    if (!tags.length) { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    el.innerHTML = `
        <span style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;margin-right:4px;">On</span>
        ${tags.map(t => `
            <button class="tag-link" onclick="browseNetwork(${t.id},'${t.label.replace(/'/g, "\\'")}','${t.type}','${t.mediaType}')">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                ${t.label}
            </button>`
    ).join('')}`;
}

async function browseGenre(genreId, genreName) {
    showPage('search-page');
    document.getElementById('search-input').value = '';
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
        document.querySelectorAll('.genre-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.genre === 'all'));
        document.getElementById('genre-bar').style.display = 'flex';
        document.getElementById('search-count').textContent = `${allResults.length} results`;
        renderCards('search-results', allResults);
    } catch (e) {
        document.getElementById('search-results').innerHTML =
            '<div class="empty-state"><p>Failed to load.</p></div>';
    }
}

async function browseNetwork(networkId, networkName, type, mediaType) {
    showPage('search-page');
    document.getElementById('search-input').value = '';
    document.getElementById('search-query-display').textContent = networkName;
    document.getElementById('search-count').textContent = 'Loading…';
    document.getElementById('search-results').innerHTML = '<div class="spinner"></div>';
    document.getElementById('filter-toggle').style.cssText = 'display:flex;margin-bottom:16px;';
    setActiveTab('');
    try {
        const param = type === 'network' ? 'with_networks' : 'with_companies';
        const endpoint = mediaType === 'tv' ? '/discover/tv' : '/discover/movie';
        const data = await tmdb(endpoint, {
            [param]: networkId,
            sort_by: 'popularity.desc',
            page: 1
        });

        allResults = data.results.map(r => ({ ...r, media_type: mediaType }));
        currentPage = 1;
        hasMorePages = data.total_pages > 1;
        isLoadingMore = false;
        currentSection = { mode: 'network', networkId, type, mediaType, param };
        activeGenre = 'all';
        document.querySelectorAll('.genre-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.genre === 'all'));
        document.getElementById('genre-bar').style.display = 'flex';
        document.getElementById('search-count').textContent = `${data.total_results} titles`;
        renderCards('search-results', allResults);

        const el = document.getElementById('search-results');
        el.insertAdjacentHTML('afterend', '<div id="scroll-sentinel"></div>');
        attachScrollObserver();
    } catch (e) {
        document.getElementById('search-results').innerHTML =
            '<div class="empty-state"><p>Failed to load.</p></div>';
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
    if (sentinel2) sentinel2.innerHTML = hasMorePages
        ? ''
        : '<p style="text-align:center;color:var(--text3);font-size:13px;padding:24px">No more results</p>';
}

const scrollObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) loadMoreResults();
}, { rootMargin: '200px' });

function attachScrollObserver() {
    const sentinel = document.getElementById('scroll-sentinel');
    if (sentinel) scrollObserver.observe(sentinel);
}

// ─── SHARE ───
function shareUrl() {
    if (navigator.share) {
        navigator.share({ title: document.title, url: location.href });
        return;
    }
    navigator.clipboard.writeText(location.href).then(() => {
        const btn = document.getElementById('share-btn');
        btn.classList.add('copied');
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
        setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Share`;
        }, 2000);
    });
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
        const sub = item.type === 'tv'
            ? `S${item.season} E${item.episode}`
            : item.year || '';
        const timestamp = item.timestamp || 0;
        const runtime = item.type === 'movie'
            ? (item.runtime || 90) * 60
            : (item.epRuntime || 40) * 60;
        const pct = runtime > 0
            ? Math.min(Math.round((timestamp / runtime) * 100), 99)
            : 0;

        div.innerHTML = poster
            ? `<div style="position:relative">
            <img class="card-poster" src="${poster}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
            <div class="card-poster-placeholder" style="display:none">${item.title}</div>${pct > 0 ? `<div class="card-progress"><div class="card-progress-fill" style="width:${pct}%"></div></div>` : ''}
            </div>`
            : `<div style="position:relative">
            <div class="card-poster-placeholder">${item.title}</div>
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
    }, 15000);
}

function stopWatchTimer() {
    clearInterval(watchTimer);
    watchTimer = null;
    watchStart = null;
}

// ─── SCROLL TO TOP BUTTON ───
window.addEventListener('scroll', () => {
    document.getElementById('scroll-top').classList.toggle('visible', window.scrollY > 400);
});

// ─── SECTION VIEW ───
async function fetchSection(mediaType) {
    showPage('search-page');
    document.getElementById('filter-toggle').style.cssText = 'display:flex;margin-bottom:16px;';
    document.getElementById('search-input').value = '';
    const label = mediaType === 'movie' ? 'Movies' : 'TV Shows';
    document.getElementById('search-query-display').textContent = `${label} — Popular`;
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

// ─── SERVICE WORKER ───
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('SW registered:', reg.scope))
            .catch(err => console.log('SW failed:', err));
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
            tmdb('/discover/movie', {
                'primary_release_date.gte': from,
                'primary_release_date.lte': to,
                sort_by: 'popularity.desc'
            }),
            tmdb('/discover/tv', {
                'first_air_date.gte': from,
                'first_air_date.lte': to,
                sort_by: 'popularity.desc'
            })
        ]);
        const combined = [
            ...movies.results.map(r => ({ ...r, media_type: 'movie' })),
            ...shows.results.map(r => ({ ...r, media_type: 'tv' }))
        ].sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 14);

        if (!combined.length) {
            document.getElementById('new-this-week-row').innerHTML =
                '<div class="empty-state"><p>Nothing new this week yet.</p></div>';
            return;
        }
        renderCards('new-this-week-row', combined);
    } catch (e) { }
}

// ─── ADVANCED FILTERS ───
let activeFilters = { type: 'all', sort: 'popularity.desc', lang: '', yearFrom: 1950, yearTo: 2026, rating: 0 };
function toggleFilterPanel() {
    const panel = document.getElementById('filter-panel');
    const label = document.getElementById('filter-toggle-label');
    const open = panel.style.display === 'block';
    panel.style.display = open ? 'none' : 'block';
    label.textContent = open ? 'Filters' : 'Hide Filters';
    document.getElementById('filter-toggle').style.cssText =
        'display:flex;margin-bottom:16px;';
}

function setFilter(key, val, btn) {
    activeFilters[key] = val;
    btn.closest('div').querySelectorAll('.filter-pill').forEach(b =>
        b.classList.toggle('active', b.dataset.val === val));
}

function updateYearLabel() {
    let from = parseInt(document.getElementById('year-from').value);
    let to = parseInt(document.getElementById('year-to').value);
    if (from > to) { to = from; document.getElementById('year-to').value = to; }
    activeFilters.yearFrom = from;
    activeFilters.yearTo = to;
    document.getElementById('year-label').textContent = `${from} – ${to}`;
}

function resetFilters() {
    activeFilters = { type: 'all', sort: 'popularity.desc', lang: '', yearFrom: 1950, yearTo: 2026, rating: 0 };
    document.getElementById('year-from').value = 1950;
    document.getElementById('year-to').value = 2026;
    document.getElementById('filter-rating').value = 0;
    document.getElementById('year-label').textContent = '1950 – 2026';
    document.getElementById('rating-label').textContent = '0+';
    document.querySelectorAll('.filter-pill').forEach(b =>
        b.classList.toggle('active',
            (b.dataset.filter === 'type' && b.dataset.val === 'all') ||
            (b.dataset.filter === 'sort' && b.dataset.val === 'popularity.desc') ||
            (b.dataset.filter === 'lang' && b.dataset.val === '')
        ));
}

async function applyFilters() {
    const { type, sort, lang, yearFrom, yearTo, rating } = activeFilters;
    const types = type === 'all' ? ['movie', 'tv'] : [type];
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
                ? sort.replace('primary_release_date', 'first_air_date')
                : sort;
            const params = {
                sort_by: sortKey,
                [dateFromKey]: `${yearFrom}-01-01`,
                [dateToKey]: `${yearTo}-12-31`,
                'vote_average.gte': rating,
                'vote_count.gte': 50,
                page: 1
            };
            if (lang) params.with_original_language = lang;
            return tmdb(`/discover/${t}`, params)
                .then(d => d.results.map(r => ({ ...r, media_type: t })));
        }));

        allResults = results.flat().sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        currentPage = 1;
        hasMorePages = false;
        isLoadingMore = false;
        currentSection = null;
        activeGenre = 'all';
        document.querySelectorAll('.genre-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.genre === 'all'));
        document.getElementById('genre-bar').style.display = 'flex';
        document.getElementById('search-count').textContent = `${allResults.length} results`;

        if (!allResults.length) {
            document.getElementById('search-results').innerHTML =
                '<div class="empty-state"><div class="icon">🎬</div><p>No results. Try adjusting the filters.</p></div>';
        } else {
            renderCards('search-results', allResults);
        }
    } catch (e) {
        document.getElementById('search-results').innerHTML =
            '<div class="empty-state"><p>Failed to load. Try again.</p></div>';
    }
}

// ─── TOAST ───
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}
