import { api, setToken, clearToken } from '/src/api.js';
import { state, setUser, on }        from '/src/state.js';
import { renderNav, updateActiveNav } from '/src/components/nav.js';
import { toast, debounce }            from '/src/utils.js';
import { renderTimeline, destroyTimeline } from '/src/views/timeline.js';
import { renderExplore, renderFavorites } from '/src/views/explore.js';
import { renderMap, destroyMap }      from '/src/views/mapview.js';
import { renderAlbums }               from '/src/views/albums.js';
import { renderPersons }              from '/src/views/persons.js';
import { renderSharing }              from '/src/views/sharing.js';
import { renderAdmin }                from '/src/views/admin.js';
import { renderUpload }              from '/src/views/upload.js';
import { renderFolders }            from '/src/views/folders.js';

// Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(console.error);
}

// === AUTH ===

async function tryRestoreSession() {
  try {
    // Prova att hämta ny access token via refresh-cookie
    const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (!res.ok) return false;
    const { data } = await res.json();
    setToken(data.accessToken);
    const { data: user } = await api.me();
    setUser(user);
    return true;
  } catch {
    return false;
  }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');

  try {
    errEl.classList.add('hidden');
    const { data } = await api.login(username, password);
    setToken(data.accessToken);
    setUser(data.user);
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  initApp();
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  clearToken();
}

window.addEventListener('auth:logout', showLogin);

// === NAVIGERING (hash-router) ===

let currentCleanup = null;

function navigate(hash) {
  // Kör cleanup för föregående vy
  if (currentCleanup) { currentCleanup(); currentCleanup = null; }

  updateActiveNav();
  const container = document.getElementById('view-container');
  container.innerHTML = '';

  const [route, ...rest] = (hash.replace('#/', '') || 'photos').split('/');

  if (route === 'photos')    { renderTimeline(container); currentCleanup = destroyTimeline; }
  else if (route === 'explore')   renderExplore(container);
  else if (route === 'map')     { renderMap(container);      currentCleanup = destroyMap; }
  else if (route === 'albums')    renderAlbums(container, rest[0]);
  else if (route === 'faces')     renderPersons(container, rest[0]);
  else if (route === 'sharing')   renderSharing(container);
  else if (route === 'favorites') renderFavorites(container);
  else if (route === 'folders')   renderFolders(container);
  else if (route === 'upload')     renderUpload(container);
  else if (route === 'admin')     renderAdmin(container, rest[0] ?? 'stats');
  else if (route === 'share')     renderSharePage(container, rest[0]);
  else                            renderTimeline(container);
}

window.addEventListener('hashchange', () => navigate(location.hash));

// Klick på nav-länk navigerar alltid om — även om hash redan är korrekt
document.addEventListener('click', (e) => {
  const link = e.target.closest('#nav-links a, #bottom-nav-links a');
  if (!link) return;
  const href = link.getAttribute('href');
  if (!href?.startsWith('#')) return;
  e.preventDefault();
  if (location.hash === href) {
    // Samma hash — tvinga omnavigering
    navigate(href);
  } else {
    location.hash = href;
  }
});

// === LIGHTBOX NAVIGATION EVENTS ===

window.addEventListener('pm:timeline-filter', (e) => {
  if (currentCleanup) { currentCleanup(); currentCleanup = null; }
  // pushState utan att trigga hashchange (undviker dubbel-render)
  history.pushState(null, '', '#/photos');
  updateActiveNav();
  const container = document.getElementById('view-container');
  container.innerHTML = '';
  renderTimeline(container, e.detail);
  currentCleanup = destroyTimeline;
});

// === SÖK ===

const globalSearch = document.getElementById('global-search');

// Person-dropdown i sökfältet
let _personSuggestions = [];
let _personSuggestionsLoaded = false;

async function ensurePersonsLoaded() {
  if (_personSuggestionsLoaded) return;
  _personSuggestionsLoaded = true;
  try { const { data } = await api.persons(); _personSuggestions = data ?? []; } catch {}
}

function getPersonDropdown() {
  let el = document.getElementById('person-search-dropdown');
  if (!el) {
    el = document.createElement('div');
    el.id = 'person-search-dropdown';
    el.className = 'absolute left-0 right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden hidden';
    el.style.zIndex = '500';
    const parent = document.getElementById('global-search').parentElement;
    parent.style.position = 'relative';
    parent.appendChild(el);
  }
  return el;
}

async function showPersonDropdown(q) {
  const dropdown = getPersonDropdown();
  if (!q) { dropdown.classList.add('hidden'); return; }
  await ensurePersonsLoaded();
  const matches = _personSuggestions.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6);
  if (!matches.length) { dropdown.classList.add('hidden'); return; }
  dropdown.innerHTML = matches.map((p) => `
    <button data-pid="${p.id}" class="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-700 text-left transition-colors">
      <div class="w-8 h-8 rounded-full overflow-hidden bg-slate-600 flex-shrink-0 flex items-center justify-center">
        ${(p.cover_face_id || p.fallback_face_id)
          ? `<img src="/api/faces/${p.cover_face_id || p.fallback_face_id}/thumb" class="w-full h-full object-cover" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'👤',className:'text-sm'}))">`
          : p.cover_thumb
            ? `<img src="/thumbs/${p.cover_thumb}" class="w-full h-full object-cover" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'👤',className:'text-sm'}))">`
            : '<span class="text-sm">👤</span>'}
      </div>
      <span class="text-sm text-white">${p.name}</span>
      <span class="text-xs text-slate-400 ml-auto">${p.photo_count} bilder</span>
    </button>`).join('');
  dropdown.classList.remove('hidden');
  dropdown.querySelectorAll('[data-pid]').forEach((btn) => {
    btn.addEventListener('click', () => {
      dropdown.classList.add('hidden');
      globalSearch.value = '';
      location.hash = `#/faces/${btn.dataset.pid}`;
    });
  });
}

document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('person-search-dropdown');
  if (dropdown && !globalSearch.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
});

const doSearch = debounce((q) => {
  showPersonDropdown(q);
  if (!q.trim()) { navigate(location.hash); return; }
  const container = document.getElementById('view-container');
  renderTimeline(container, { q: q.trim() });
}, 300);

globalSearch.addEventListener('input', (e) => doSearch(e.target.value));
globalSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch(e.target.value);
});

// === AVANCERAT FILTER ===

document.getElementById('advanced-search-btn').addEventListener('click', () => {
  document.getElementById('advanced-search-panel').classList.toggle('hidden');
});

// --- Chip-state ---
let _filterTags      = []; // [{name}]
let _filterPersons   = []; // [{id, name}]
let _filterTagsOp    = 'AND'; // 'AND' | 'OR'
let _filterPersonsOp = 'AND'; // 'AND' | 'OR'
let _advDateMode     = 'year'; // 'year' | 'month' | 'date'

function renderTagChips() {
  const el = document.getElementById('adv-tag-chips');
  el.innerHTML = _filterTags.map((t, i) => `
    <span class="flex items-center gap-1 bg-blue-700/60 text-blue-200 text-xs rounded-full px-2 py-0.5">
      ${t.name}
      <button data-ti="${i}" class="adv-tag-remove hover:text-white leading-none">×</button>
    </span>`).join('');
  el.querySelectorAll('.adv-tag-remove').forEach((b) => {
    b.addEventListener('click', () => { _filterTags.splice(+b.dataset.ti, 1); renderTagChips(); });
  });
}

function renderPersonChips() {
  const el = document.getElementById('adv-person-chips');
  el.innerHTML = _filterPersons.map((p, i) => `
    <span class="flex items-center gap-1 bg-violet-700/60 text-violet-200 text-xs rounded-full px-2 py-0.5">
      ${p.name}
      <button data-pi="${i}" class="adv-person-remove hover:text-white leading-none">×</button>
    </span>`).join('');
  el.querySelectorAll('.adv-person-remove').forEach((b) => {
    b.addEventListener('click', () => { _filterPersons.splice(+b.dataset.pi, 1); renderPersonChips(); });
  });
}

// --- AND/OR-toggles ---
function setupOpToggle(btnId, getOp, setOp, activeColor) {
  const btn = document.getElementById(btnId);
  btn.addEventListener('click', () => {
    const next = getOp() === 'AND' ? 'OR' : 'AND';
    setOp(next);
    btn.dataset.op = next;
    btn.textContent = next === 'AND' ? 'ALLA (AND)' : 'NÅGON (OR)';
    btn.classList.toggle(activeColor, next === 'OR');
    btn.classList.toggle('border-slate-600', next === 'AND');
    btn.classList.toggle('text-slate-300', next === 'AND');
  });
}
setupOpToggle('adv-tag-op-btn',
  () => _filterTagsOp, (v) => { _filterTagsOp = v; },
  'border-blue-500 text-blue-400');
setupOpToggle('adv-person-op-btn',
  () => _filterPersonsOp, (v) => { _filterPersonsOp = v; },
  'border-violet-500 text-violet-400');

// --- Tangentbordsnavigation för dropdown (ESC / piltangenter / Enter) ---
function attachDropdownKeys(input, dropdown, onSelect) {
  input.addEventListener('keydown', (e) => {
    const items = [...dropdown.querySelectorAll('button')];
    const active = dropdown.querySelector('button.dd-active');
    const idx = items.indexOf(active);

    if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
      input.value = '';
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = items[idx + 1] ?? items[0];
      if (next) setActive(items, next);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = items[idx - 1] ?? items[items.length - 1];
      if (prev) setActive(items, prev);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active) { onSelect(active); dropdown.classList.add('hidden'); input.value = ''; }
    }
  });
}

function setActive(items, target) {
  items.forEach((b) => b.classList.remove('dd-active', 'bg-slate-700'));
  target.classList.add('dd-active', 'bg-slate-700');
  target.scrollIntoView({ block: 'nearest' });
}

// --- Tag autocomplete ---
const tagInput    = document.getElementById('adv-tag-input');
const tagDropdown = document.getElementById('adv-tag-dropdown');

async function fetchTagSuggestions(q) {
  try {
    const { data } = await api.get(`/api/tags?q=${encodeURIComponent(q)}`);
    return data ?? [];
  } catch { return []; }
}

function addTagChip(name) {
  _filterTags.push({ name });
  renderTagChips();
  tagInput.value = '';
  tagDropdown.classList.add('hidden');
}

const debouncedTagSearch = debounce(async (q) => {
  if (!q) { tagDropdown.classList.add('hidden'); return; }
  const rows = await fetchTagSuggestions(q);
  const filtered = rows.filter((r) => !_filterTags.find((t) => t.name === r.name));
  if (!filtered.length) { tagDropdown.classList.add('hidden'); return; }
  tagDropdown.innerHTML = filtered.map((r) => `
    <button data-tname="${r.name}" class="adv-tag-opt w-full text-left flex items-center justify-between px-3 py-1.5 hover:bg-slate-700 text-sm text-slate-200">
      <span>${r.name}</span>
      <span class="text-xs text-slate-500">${r.count}</span>
    </button>`).join('');
  tagDropdown.querySelectorAll('.adv-tag-opt').forEach((b) => {
    b.addEventListener('click', () => addTagChip(b.dataset.tname));
  });
  tagDropdown.classList.remove('hidden');
}, 250);

tagInput.addEventListener('input', (e) => debouncedTagSearch(e.target.value));
attachDropdownKeys(tagInput, tagDropdown, (b) => addTagChip(b.dataset.tname));
document.addEventListener('click', (e) => {
  if (!tagInput.contains(e.target) && !tagDropdown.contains(e.target)) tagDropdown.classList.add('hidden');
});

// --- Person autocomplete ---
const personInput    = document.getElementById('adv-person-input');
const personDropdown = document.getElementById('adv-person-dropdown');

function addPersonChip(id, name) {
  _filterPersons.push({ id, name });
  renderPersonChips();
  personInput.value = '';
  personDropdown.classList.add('hidden');
}

function showAdvPersonDropdown(q) {
  if (!q) { personDropdown.classList.add('hidden'); return; }
  const matches = _personSuggestions
    .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) && !_filterPersons.find((fp) => fp.id === p.id))
    .slice(0, 8);
  if (!matches.length) { personDropdown.classList.add('hidden'); return; }
  personDropdown.innerHTML = matches.map((p) => `
    <button data-pid="${p.id}" data-pname="${p.name}"
      class="adv-person-opt w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-700 text-sm text-slate-200">
      <div class="w-6 h-6 rounded-full overflow-hidden bg-slate-600 flex-shrink-0 flex items-center justify-center">
        ${(p.cover_face_id || p.fallback_face_id)
          ? `<img src="/api/faces/${p.cover_face_id || p.fallback_face_id}/thumb" class="w-full h-full object-cover" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'👤',className:'text-xs'}))">`
          : p.cover_thumb
            ? `<img src="/thumbs/${p.cover_thumb}" class="w-full h-full object-cover" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'👤',className:'text-xs'}))">`
            : '<span class="text-xs">👤</span>'}
      </div>
      <span>${p.name}</span>
    </button>`).join('');
  personDropdown.querySelectorAll('.adv-person-opt').forEach((b) => {
    b.addEventListener('click', () => addPersonChip(b.dataset.pid, b.dataset.pname));
  });
  personDropdown.classList.remove('hidden');
}

const debouncedPersonSearch = debounce(async (q) => {
  await ensurePersonsLoaded();
  showAdvPersonDropdown(q);
}, 200);

personInput.addEventListener('input', (e) => debouncedPersonSearch(e.target.value));
attachDropdownKeys(personInput, personDropdown, (b) => addPersonChip(b.dataset.pid, b.dataset.pname));
document.addEventListener('click', (e) => {
  if (!personInput.contains(e.target) && !personDropdown.contains(e.target)) personDropdown.classList.add('hidden');
});

// --- Datumläge-knappar ---
function setDateMode(mode) {
  _advDateMode = mode;
  document.querySelectorAll('.adv-dmode-btn').forEach((b) => {
    const active = b.dataset.dmode === mode;
    b.classList.toggle('bg-blue-600', active);
    b.classList.toggle('text-white', active);
    b.classList.toggle('text-slate-300', !active);
  });

  const fromWrap = document.getElementById('adv-date-from-wrap');
  const toWrap   = document.getElementById('adv-date-to-wrap');

  if (mode === 'year') {
    fromWrap.querySelector('label').textContent = 'Från (år)';
    toWrap.querySelector('label').textContent   = 'Till (år)';
    replaceInput('adv-date-from', 'number', { min: '1800', max: '2099', placeholder: '2020', class: 'w-24' });
    replaceInput('adv-date-to',   'number', { min: '1800', max: '2099', placeholder: '2024', class: 'w-24' });
  } else if (mode === 'month') {
    fromWrap.querySelector('label').textContent = 'Från (mån)';
    toWrap.querySelector('label').textContent   = 'Till (mån)';
    replaceInput('adv-date-from', 'month', { class: 'w-36' });
    replaceInput('adv-date-to',   'month', { class: 'w-36' });
  } else {
    fromWrap.querySelector('label').textContent = 'Från';
    toWrap.querySelector('label').textContent   = 'Till';
    replaceInput('adv-date-from', 'date', { class: 'w-36' });
    replaceInput('adv-date-to',   'date', { class: 'w-36' });
  }
}

function replaceInput(id, type, attrs) {
  const old = document.getElementById(id);
  const el  = document.createElement('input');
  el.id        = id;
  el.type      = type;
  el.className = `bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white ${attrs.class ?? ''}`;
  if (attrs.min)         el.min         = attrs.min;
  if (attrs.max)         el.max         = attrs.max;
  if (attrs.placeholder) el.placeholder = attrs.placeholder;
  old.replaceWith(el);
}

document.querySelectorAll('.adv-dmode-btn').forEach((b) => {
  b.addEventListener('click', () => setDateMode(b.dataset.dmode));
});

// --- Konvertera datum till ISO-sträng ---
function dateFrom() {
  const v = document.getElementById('adv-date-from')?.value;
  if (!v) return undefined;
  if (_advDateMode === 'year')  return `${v}-01-01`;
  if (_advDateMode === 'month') return `${v}-01`;
  return v;
}
function dateTo() {
  const v = document.getElementById('adv-date-to')?.value;
  if (!v) return undefined;
  if (_advDateMode === 'year')  return `${v}-12-31`;
  if (_advDateMode === 'month') {
    // sista dagen i månaden
    const [yr, mo] = v.split('-').map(Number);
    const last = new Date(yr, mo, 0).getDate();
    return `${v}-${String(last).padStart(2, '0')}`;
  }
  return v;
}

// --- Sök ---
document.getElementById('adv-search-go').addEventListener('click', () => {
  const params = {
    q:           globalSearch.value.trim() || undefined,
    tags:        _filterTags.map((t) => t.name).join(',') || undefined,
    tagsOp:      _filterTags.length > 1 ? _filterTagsOp : undefined,
    personIds:   _filterPersons.map((p) => p.id).join(',') || undefined,
    personIdsOp: _filterPersons.length > 1 ? _filterPersonsOp : undefined,
    dateFrom:    dateFrom(),
    dateTo:      dateTo(),
    mimeType:    document.getElementById('adv-mime').value || undefined,
    hasGps:      document.getElementById('adv-gps').value || undefined,
  };
  renderTimeline(document.getElementById('view-container'), params);
  document.getElementById('advanced-search-panel').classList.add('hidden');
});

// --- Rensa ---
document.getElementById('adv-search-clear').addEventListener('click', () => {
  _filterTags      = [];
  _filterPersons   = [];
  _filterTagsOp    = 'AND';
  _filterPersonsOp = 'AND';
  renderTagChips();
  renderPersonChips();
  ['adv-tag-op-btn','adv-person-op-btn'].forEach((id) => {
    const b = document.getElementById(id);
    b.dataset.op   = 'AND';
    b.textContent  = 'ALLA (AND)';
    b.className    = b.className.replace(/border-\w+-500|text-\w+-400/g, '').trim()
      + ' border-slate-600 text-slate-300';
  });
  const fromEl = document.getElementById('adv-date-from');
  const toEl   = document.getElementById('adv-date-to');
  if (fromEl) fromEl.value = '';
  if (toEl)   toEl.value   = '';
  document.getElementById('adv-mime').value = '';
  document.getElementById('adv-gps').value  = '';
  globalSearch.value = '';
  navigate(location.hash);
});

// === USER DROPDOWN ===

document.getElementById('user-menu-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('user-dropdown').classList.toggle('hidden');
});

document.addEventListener('click', () => {
  document.getElementById('user-dropdown').classList.add('hidden');
});

async function logout() {
  try { await api.logout(); } catch {}
  showLogin();
}

document.getElementById('logout-btn').addEventListener('click', logout);
document.getElementById('dropdown-logout').addEventListener('click', logout);
document.getElementById('backup-btn').addEventListener('click', () => {
  toast('Backup-export är inte implementerad ännu', 'info');
});

// Mobil hamburger
document.getElementById('menu-toggle').addEventListener('click', () => {
  const sidebar = document.getElementById('sidebar');
  sidebar.style.display = sidebar.style.display === 'flex' ? 'none' : 'flex';
});

// === FOLDERS-VY (inline, liten) ===

// === SSE (realtid) ===

let _sseInstance = null;

function connectSSE() {
  if (_sseInstance) { try { _sseInstance.close(); } catch {} _sseInstance = null; }

  const token = window.__pmToken ?? '';
  if (!token) return; // Inget token = inte inloggad, vänta

  const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`, { withCredentials: true });
  _sseInstance = es;

  es.addEventListener('asset.indexed', () => {
    toast('Ny bild tillagd i biblioteket', 'info', 2000);
    document.getElementById('notif-badge').classList.remove('hidden');
  });

  es.addEventListener('asset.transcoded', () => {
    toast('Videotranskodning klar', 'success', 2000);
  });

  es.addEventListener('share.received', (e) => {
    const d = JSON.parse(e.data);
    toast(`${d.fromUsername} delade något med dig`, 'info');
    document.getElementById('notif-badge').classList.remove('hidden');
  });

  es.onerror = () => {
    es.close();
    _sseInstance = null;
    setTimeout(connectSSE, 10_000);
  };
}

// Exponeras så att api.js kan återansluta efter token-refresh
window.__pmReconnectSSE = connectSSE;

// === DELNINGSSIDA (publik, ingen inloggning krävs) ===

async function renderSharePage(container, token) {
  if (!token) { container.innerHTML = '<div class="p-8 text-slate-400">Ogiltig delningslänk.</div>'; return; }
  container.innerHTML = '<div class="p-8 text-slate-400 text-sm">Laddar delad bild…</div>';
  try {
    const { data, error } = await api.getPublicShare(token);
    if (error) { container.innerHTML = `<div class="p-8 text-red-400">${error}</div>`; return; }
    const { share } = data;
    const thumbSrc = share.thumb_large_path ? `/thumbs/${share.thumb_large_path}` : null;
    const isVideo  = share.mime_type?.startsWith('video/');

    container.innerHTML = `
      <div class="flex flex-col items-center justify-center min-h-full p-6 gap-6">
        <div class="text-center">
          <div class="text-xs text-slate-500 mb-1">Delad bild</div>
          <div class="text-white font-medium text-lg">${share.file_name ?? ''}</div>
        </div>
        <div class="rounded-xl overflow-hidden shadow-2xl max-w-3xl w-full">
          ${isVideo
            ? `<video src="/api/assets/${share.asset_id_r}/stream" controls class="w-full max-h-[70vh] bg-black"></video>`
            : thumbSrc
              ? `<img src="${thumbSrc}" class="w-full max-h-[70vh] object-contain bg-black">`
              : '<div class="bg-slate-800 aspect-video flex items-center justify-center text-slate-500">Förhandsgranskning saknas</div>'}
        </div>
        <a href="/api/assets/${share.asset_id_r}/original"
           class="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">
          ⬇ Ladda ner original
        </a>
      </div>`;
  } catch (e) {
    container.innerHTML = `<div class="p-8 text-red-400">Kunde inte ladda delad bild: ${e.message}</div>`;
  }
}

// === INIT ===

async function initApp() {
  const user = state.user;

  // Uppdatera user-avatar och namn
  const initials = user.username.slice(0, 2).toUpperCase();
  document.getElementById('user-menu-btn').textContent = initials;
  document.getElementById('user-display-name').textContent = user.username;
  document.getElementById('user-role-badge').textContent  = user.role;

  // Bygg nav baserat på permissions
  renderNav();

  // Navigera till startvy
  navigate(location.hash || '#/photos');

  // Anslut SSE
  connectSSE();
}

// === BOOTSTRAP ===

(async () => {
  const ok = await tryRestoreSession();
  if (ok) {
    showApp();
  }
  // Annars visas login-skärmen (standard)
})();
