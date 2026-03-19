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
    loadPopularMovies();
    loadPopularTV();
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
    div.innerHTML = poster
        ? `<img class="card-poster" src="${poster}" alt="${title}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
           <div class="card-poster-placeholder" style="display:none">${title}</div>`
        : `<div class="card-poster-placeholder">${title}</div>`;
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
    showPage('home-page');
    document.getElementById('search-input').value = '';
    setActiveTab('tab-home');
    history.pushState({}, '', location.pathname);
    document.title = 'StreamVault';
}

function setActiveTab(id) {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
}

function goBack() {
    history.length > 1 ? history.back() : showHome();
}

// ─── SEARCH ───
function onSearchInput(val) {
    clearTimeout(searchDebounce);
    if (!val.trim()) return;
    searchDebounce = setTimeout(() => doSearch(val), 500);
}

async function doSearch(query, fromRoute = false) {
    if (!query.trim()) return;
    showPage('search-page');
    if (!fromRoute) pushState({ search: encodeURIComponent(query) });
    document.getElementById('search-query-display').textContent = `"${query}"`;
    document.getElementById('search-count').textContent = 'Searching…';
    document.getElementById('search-results').innerHTML = '<div class="spinner"></div>';
    try {
        const [movies, shows] = await Promise.all([
            tmdb('/search/movie', { query }),
            tmdb('/search/tv', { query })
        ]);
        const combined = [
            ...movies.results.map(r => ({ ...r, media_type: 'movie' })),
            ...shows.results.map(r => ({ ...r, media_type: 'tv' }))
        ].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        document.getElementById('search-count').textContent = `${combined.length} results`;
        if (!combined.length) {
            document.getElementById('search-results').innerHTML =
                '<div class="empty-state"><div class="icon">🎬</div><p>No results found.</p></div>';
        } else {
            renderCards('search-results', combined);
        }
    } catch (e) {
        document.getElementById('search-results').innerHTML =
            '<div class="empty-state"><p>Search failed. Check your API key.</p></div>';
    }
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
        const detail = await tmdb(`/${mediaType}/${id}`, { append_to_response: 'external_ids,similar' });
        const imdb = detail.external_ids?.imdb_id || null;
        const title = detail.title || detail.name;
        const slug = slugify(title);
        const year = (detail.release_date || detail.first_air_date || '').slice(0, 4);
        const rating = detail.vote_average ? detail.vote_average.toFixed(1) : '—';
        const genres = (detail.genres || []).slice(0, 3).map(g => g.name);
        const runtime = detail.runtime
            ? `${detail.runtime}min`
            : (detail.episode_run_time?.[0] ? `${detail.episode_run_time[0]}min/ep` : '');

        document.getElementById('player-title').textContent = title;
        document.getElementById('player-meta').innerHTML = `
            <span>${year}</span>
            ${runtime ? `<span>${runtime}</span>` : ''}
            <span class="rating">${starIcon()} ${rating}</span>
            ${genres.map(g => `<span class="genre-tag">${g}</span>`).join('')}`;
        document.getElementById('player-overview').textContent = detail.overview || '';

        if (detail.backdrop_path)
            document.getElementById('player-container').style.background =
                `url(${backdropUrl(detail.backdrop_path)}) center/cover`;

        if (mediaType === 'movie') {
            if (!fromRoute) pushState({ type: 'movie', id, name: slug });
            document.getElementById('player-iframe').src = imdb
                ? `${PRIME_BASE}/movie?imdb=${imdb}`
                : `${PRIME_BASE}/movie?tmdb=${id}`;
        } else {
            currentShow = { id, detail, imdb, slug };
            const startS = _pendingEp?.season || 1;
            const startE = _pendingEp?.episode || 1;
            _pendingEp = null;
            currentSeason = startS;
            document.getElementById('episodes-section').style.display = 'block';
            renderSeasons(detail, imdb, id, startS);
            if (!fromRoute) pushState({ type: 'tv', id, name: slug, season: startS, episode: startE });
            loadEpisode(startS, startE, imdb, id, true);
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

function loadEpisode(season, episode, imdb, tmdbId, skipPush = false) {
    document.querySelectorAll('.ep-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`ep-btn-${season}-${episode}`)?.classList.add('active');

    document.getElementById('player-iframe').src = imdb && imdb !== 'null'
        ? `${PRIME_BASE}/tv?imdb=${imdb}&season=${season}&episode=${episode}`
        : `${PRIME_BASE}/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`;

    document.getElementById('player-container').scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (!skipPush && currentShow) {
        const slug = currentShow.slug || slugify(currentShow.detail?.name || '');
        pushState({ type: 'tv', id: tmdbId, name: slug, season, episode });
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

// ─── DRAGGABLE PLAYER ───
(function () {
    let floating = false, dragging = false, ox = 0, oy = 0;

    function dockPlayer() {
        const pc = document.getElementById('player-container');
        pc.classList.add('is-floating');
        document.getElementById('popout-btn').style.display = 'none';
        floating = true;
        pc.style.left = (window.innerWidth - 400) + 'px';
        pc.style.top = (window.innerHeight - 240) + 'px';
    }

    function undockPlayer() {
        const pc = document.getElementById('player-container');
        pc.classList.remove('is-floating');
        pc.style.left = pc.style.top = '';
        document.getElementById('popout-btn').style.display = '';
        floating = false;
    }

    document.addEventListener('mousedown', e => {
        if (!floating) return;
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
    window.dockPlayer = dockPlayer;
    window.undockPlayer = undockPlayer;
})();

// ─── SCROLL TO TOP BUTTON ───
window.addEventListener('scroll', () => {
    document.getElementById('scroll-top')
        .classList.toggle('visible', window.scrollY > 400);
});

// ─── SECTION VIEW ───
async function fetchSection(mediaType) {
    showPage('search-page');
    document.getElementById('search-input').value = '';
    const label = mediaType === 'movie' ? 'Movies' : 'TV Shows';
    document.getElementById('search-query-display').textContent = `${label} — Popular`;
    document.getElementById('search-count').textContent = 'Loading…';
    document.getElementById('search-results').innerHTML = '<div class="spinner"></div>';
    setActiveTab(mediaType === 'movie' ? 'tab-movies' : 'tab-tv');
    try {
        const data = await tmdb(`/${mediaType}/popular`);
        document.getElementById('search-count').textContent = `${data.results.length} titles`;
        renderCards('search-results', data.results.map(r => ({ ...r, media_type: mediaType })));
    } catch (e) { }
}

// ─── TOAST ───
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}