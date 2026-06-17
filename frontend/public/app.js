import { api, setToken, clearToken } from '/src/api.js';
import { state, setUser, on }        from '/src/state.js';
import { renderNav, updateActiveNav } from '/src/components/nav.js';
import { toast, debounce }            from '/src/utils.js';
import { renderTimeline, destroyTimeline } from '/src/views/timeline.js';
import { renderExplore }              from '/src/views/explore.js';
import { renderMap, destroyMap }      from '/src/views/mapview.js';
import { renderAlbums }               from '/src/views/albums.js';
import { renderPersons }              from '/src/views/persons.js';
import { renderSharing }              from '/src/views/sharing.js';
import { renderAdmin }                from '/src/views/admin.js';
import { renderUpload }              from '/src/views/upload.js';

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
  else if (route === 'favorites') renderTimeline(container, { /* favorites filter */ });
  else if (route === 'folders')   renderFolders(container, rest.join('/'));
  else if (route === 'upload')     renderUpload(container);
  else if (route === 'admin')     renderAdmin(container, rest[0] ?? 'stats');
  else                            renderTimeline(container);
}

window.addEventListener('hashchange', () => navigate(location.hash));

// === SÖK ===

const globalSearch = document.getElementById('global-search');
const doSearch = debounce((q) => {
  if (!q.trim()) { navigate(location.hash); return; }
  const container = document.getElementById('view-container');
  renderTimeline(container, { q: q.trim() });
}, 400);

globalSearch.addEventListener('input', (e) => doSearch(e.target.value));
globalSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch(e.target.value);
});

// Avancerat filter
document.getElementById('advanced-search-btn').addEventListener('click', () => {
  document.getElementById('advanced-search-panel').classList.toggle('hidden');
});

document.getElementById('adv-search-go').addEventListener('click', () => {
  const params = {
    q:        globalSearch.value.trim() || undefined,
    tags:     document.getElementById('adv-tags').value.trim() || undefined,
    dateFrom: document.getElementById('adv-date-from').value || undefined,
    dateTo:   document.getElementById('adv-date-to').value || undefined,
    mimeType: document.getElementById('adv-mime').value || undefined,
    hasGps:   document.getElementById('adv-gps').value || undefined,
  };
  renderTimeline(document.getElementById('view-container'), params);
  document.getElementById('advanced-search-panel').classList.add('hidden');
});

document.getElementById('adv-search-clear').addEventListener('click', () => {
  ['adv-tags','adv-date-from','adv-date-to'].forEach((id) => { document.getElementById(id).value = ''; });
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

async function renderFolders(container, path = '') {
  container.innerHTML = `
    <div class="p-4">
      <h1 class="text-xl font-semibold text-white mb-1">Mappar</h1>
      ${path ? `<div class="text-sm text-slate-400 mb-3">📁 ${path}</div>` : ''}
      <div id="folder-list" class="space-y-1"></div>
    </div>`;

  try {
    const { data } = await api.folders(path);
    const list = document.getElementById('folder-list');
    list.innerHTML = data.map((item) => `
      <button class="folder-item flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-300 text-sm"
              data-seg="${item.segment}">
        📁 <span>${item.segment}</span>
        <span class="ml-auto text-slate-500 text-xs">${item.asset_count}</span>
      </button>`).join('');

    list.querySelectorAll('.folder-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const newPath = path ? `${path}/${btn.dataset.seg}` : btn.dataset.seg;
        location.hash = `#/folders/${newPath}`;
      });
    });
  } catch (e) { toast(e.message, 'error'); }
}

// === SSE (realtid) ===

function connectSSE() {
  const es = new EventSource('/api/events', { withCredentials: true });

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
    setTimeout(connectSSE, 10_000); // Återanslut om 10s
  };
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
