import { api } from '../api.js';
import { toast, formatDateTime, formatBytes, confirm } from '../utils.js';

const TABS = ['stats', 'users', 'jobs', 'ai', 'audit', 'duplicates', 'folders', 'trash', 'settings'];

export async function renderAdmin(container, tab = 'stats') {
  container.innerHTML = `
    <div class="p-4">
      <h1 class="text-xl font-semibold text-white mb-4">⚙️ Administration</h1>
      <div class="flex gap-1 mb-6 flex-wrap border-b border-slate-700">
        ${TABS.map((t) => `
          <button data-tab="${t}" class="admin-tab pb-2 px-3 text-sm font-medium border-b-2 transition-colors ${
            t === tab ? 'text-white border-blue-500' : 'text-slate-400 border-transparent hover:text-white'
          }">${tabLabel(t)}</button>`).join('')}
      </div>
      <div id="admin-tab-content"></div>
    </div>`;

  container.querySelectorAll('.admin-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.admin-tab').forEach((b) => {
        b.className = `admin-tab pb-2 px-3 text-sm font-medium border-b-2 transition-colors ${
          b.dataset.tab === btn.dataset.tab ? 'text-white border-blue-500' : 'text-slate-400 border-transparent hover:text-white'
        }`;
      });
      loadTab(btn.dataset.tab, document.getElementById('admin-tab-content'));
    });
  });

  loadTab(tab, document.getElementById('admin-tab-content'));
}

function tabLabel(t) {
  return { stats:'Statistik', users:'Användare', jobs:'Jobb', ai:'AI-förslag', audit:'Logg', duplicates:'Duplikat', folders:'Mappar', trash:'🗑 Papperskorg', settings:'Inställningar' }[t] ?? t;
}

async function loadTab(tab, content) {
  content.innerHTML = '<div class="text-slate-400 text-sm">Laddar…</div>';
  try {
    if (tab === 'stats')      await renderStats(content);
    if (tab === 'users')      await renderUsers(content);
    if (tab === 'jobs')       await renderJobs(content);
    if (tab === 'ai')         await renderAiSuggestions(content);
    if (tab === 'audit')      await renderAuditLog(content);
    if (tab === 'duplicates') await renderDuplicates(content);
    if (tab === 'folders')    await renderWatchedFolders(content);
    if (tab === 'trash')      await renderTrash(content);
    if (tab === 'settings')   await renderUserSettings(content);
  } catch (e) { content.innerHTML = `<div class="text-red-400 text-sm">${e.message}</div>`; }
}

async function renderStats(content) {
  const { data } = await api.adminStats();
  content.innerHTML = `
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
      ${[
        ['Bilder', data.total_assets],
        ['Videor', data.total_videos],
        ['Lagring', formatBytes(data.total_bytes)],
        ['Användare', data.total_users],
        ['Papperskorg', data.trashed_assets],
        ['Jobb väntar', data.pending_jobs],
      ].map(([label, val]) => `
        <div class="bg-slate-800 rounded-xl p-4">
          <div class="text-2xl font-bold text-white">${val}</div>
          <div class="text-xs text-slate-400 mt-1">${label}</div>
        </div>`).join('')}
    </div>
    <div class="grid sm:grid-cols-2 gap-4">
      <div>
        <h3 class="text-sm font-medium text-slate-300 mb-2">Bilder per år</h3>
        <div class="space-y-1.5">
          ${(data.perYear ?? []).slice(0, 10).map((r) => {
            const max = Math.max(...data.perYear.map((x) => x.count));
            const pct = Math.round((r.count / max) * 100);
            return `<div class="flex items-center gap-2 text-sm">
              <span class="text-slate-400 w-10 text-right">${r.year}</span>
              <div class="flex-1 bg-slate-700 rounded-full h-2">
                <div class="bg-blue-500 h-2 rounded-full" style="width:${pct}%"></div>
              </div>
              <span class="text-slate-300 w-12 text-right">${r.count}</span>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div>
        <h3 class="text-sm font-medium text-slate-300 mb-2">Vanligaste kameror</h3>
        <div class="space-y-1 text-sm">
          ${(data.cameras ?? []).map((c) => `
            <div class="flex justify-between text-slate-300">
              <span class="truncate">${c.camera ?? 'Okänd'}</span>
              <span class="text-slate-400 ml-2">${c.count}</span>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
}

async function renderUsers(content) {
  const { data } = await api.adminUsers();
  const ALL_PERMS = ['nav.map','nav.faces','nav.sharing','nav.explore','write.metadata','write.delete'];

  content.innerHTML = `
    <div class="space-y-3">
      ${data.map((u) => `
        <div class="bg-slate-800 rounded-xl p-4">
          <div class="flex items-center justify-between mb-3">
            <div>
              <span class="font-medium text-white">${u.username}</span>
              <span class="ml-2 text-xs px-2 py-0.5 rounded-full ${
                u.role === 'admin' ? 'bg-purple-800 text-purple-200' :
                u.role === 'user'  ? 'bg-blue-800 text-blue-200' :
                'bg-slate-700 text-slate-300'
              }">${u.role}</span>
              ${!u.is_active ? '<span class="ml-1 text-xs text-red-400">Inaktiv</span>' : ''}
            </div>
            <div class="flex gap-2 text-xs">
              <button class="toggle-active-btn text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-slate-700"
                data-id="${u.id}" data-active="${u.is_active}">
                ${u.is_active ? 'Inaktivera' : 'Aktivera'}
              </button>
            </div>
          </div>
          ${u.role !== 'admin' ? `
          <div class="border-t border-slate-700 pt-3">
            <div class="text-xs text-slate-400 mb-2">Rättigheter (${u.username}):</div>
            <div class="flex flex-wrap gap-2">
              ${ALL_PERMS.map((key) => {
                const isOn = u.permissions?.[key] ?? true;
                return `<label class="flex items-center gap-1.5 cursor-pointer perm-label" data-user="${u.id}" data-key="${key}">
                  <input type="checkbox" class="perm-checkbox accent-blue-500" data-user="${u.id}" data-key="${key}" ${isOn ? 'checked' : ''}>
                  <span class="text-xs text-slate-300">${key}</span>
                </label>`;
              }).join('')}
            </div>
          </div>` : ''}
        </div>`).join('')}
    </div>`;

  // Toggle active
  content.querySelectorAll('.toggle-active-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const isActive = btn.dataset.active === 'true';
      try {
        await api.updateUser(btn.dataset.id, { is_active: !isActive });
        toast('Användare uppdaterad', 'success');
        renderUsers(content);
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  // Permission checkboxes — debounced save
  const permState = {};
  content.querySelectorAll('.perm-checkbox').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const { user: uid, key } = cb.dataset;
      if (!permState[uid]) permState[uid] = {};
      permState[uid][key] = cb.checked;
      // Hämta alla nuvarande perms för denna user och merge
      const userPerms = {};
      content.querySelectorAll(`.perm-checkbox[data-user="${uid}"]`).forEach((c) => {
        userPerms[c.dataset.key] = c.checked;
      });
      try {
        await api.setPermissions(uid, userPerms);
        toast('Rättigheter sparade', 'success', 1500);
      } catch (e) { toast(e.message, 'error'); }
    });
  });
}

async function renderJobs(content) {
  const { data } = await api.adminJobs();
  const { stats, recent } = data;

  content.innerHTML = `
    <div class="mb-4 flex flex-wrap gap-2 items-center">
      ${stats.map((s) => `
        <div class="bg-slate-800 rounded-lg px-3 py-2 text-xs">
          <span class="text-slate-400">${s.job_type} / ${s.status}</span>
          <span class="ml-2 font-medium text-white">${s.count}</span>
        </div>`).join('')}
      <button id="requeue-thumbs-btn"
        class="ml-auto px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white text-xs font-medium rounded-lg transition-colors">
        Återköa saknade thumbnails
      </button>
    </div>
    <div class="space-y-1.5">
      ${recent.map((j) => `
        <div class="flex items-center gap-3 bg-slate-800 rounded-lg px-3 py-2 text-sm">
          <span class="w-24 text-slate-400 text-xs">${j.job_type}</span>
          <span class="text-slate-300 flex-1 truncate">${j.file_name ?? '–'}</span>
          <span class="text-xs px-2 py-0.5 rounded-full ${
            j.status === 'done'    ? 'bg-green-900 text-green-300' :
            j.status === 'failed'  ? 'bg-red-900 text-red-300' :
            j.status === 'running' ? 'bg-yellow-900 text-yellow-300' :
            'bg-slate-700 text-slate-400'
          }">${j.status}</span>
          ${j.status === 'failed' ? `<button class="retry-btn text-blue-400 hover:text-blue-300 text-xs" data-id="${j.id}">Retry</button>` : ''}
          ${j.error_msg ? `<span class="text-red-400 text-xs truncate max-w-32" title="${j.error_msg}">${j.error_msg}</span>` : ''}
        </div>`).join('')}
    </div>`;

  content.querySelectorAll('.retry-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api.retryJob(btn.dataset.id);
        toast('Jobb återkört', 'success');
        renderJobs(content);
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  content.querySelector('#requeue-thumbs-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Köar…';
    try {
      const { data } = await api.requeueThumbnails();
      toast(`${data.queued} thumbnails köade för generering`, data.queued > 0 ? 'success' : 'info');
      renderJobs(content);
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Återköa saknade thumbnails';
    }
  });
}

// ── AI-förslag: state ────────────────────────────────────────────────────────
const _aiState = {
  items: [],        // alla laddade förslag
  selected: new Set(), // valda face_id:n för batch
  offset: 0,
  total: 0,
  loading: false,
};
const AI_PAGE = 48;

async function renderAiSuggestions(content) {
  // Nollställ state vid varje tab-laddning
  _aiState.items = [];
  _aiState.selected.clear();
  _aiState.offset = 0;
  _aiState.total = 0;

  content.innerHTML = `
    <div id="ai-header" class="flex flex-wrap items-center gap-3 mb-4">
      <div id="ai-total-label" class="text-sm text-slate-400">Laddar…</div>
      <div class="flex-1"></div>
      <button id="ai-select-all" class="hidden text-xs px-3 py-1.5 border border-slate-600 hover:border-blue-500 text-slate-300 hover:text-white rounded-lg transition-colors">Markera alla</button>
      <button id="ai-batch-accept" class="hidden text-xs px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white rounded-lg transition-colors opacity-40 pointer-events-none">✓ Godkänn markerade</button>
      <button id="ai-toggle-select" class="text-xs px-3 py-1.5 border border-slate-600 hover:border-blue-500 text-slate-300 hover:text-white rounded-lg transition-colors">Välj flera</button>
    </div>
    <div id="ai-grid" class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))"></div>
    <div id="ai-load-more" class="hidden mt-4 text-center">
      <button class="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors">Ladda fler</button>
    </div>`;

  let batchMode = false;

  const updateBatchToolbar = () => {
    const n = _aiState.selected.size;
    const batchBtn = content.querySelector('#ai-batch-accept');
    const enabled = n > 0;
    batchBtn.className = `text-xs px-3 py-1.5 bg-green-700 text-white rounded-lg transition-colors ${enabled ? 'hover:bg-green-600' : 'opacity-40 pointer-events-none'}`;
    batchBtn.textContent = n > 0 ? `✓ Godkänn ${n} markerade` : '✓ Godkänn markerade';
  };

  const toggleBatchMode = (on) => {
    batchMode = on;
    _aiState.selected.clear();
    content.querySelector('#ai-toggle-select').textContent = on ? 'Avbryt val' : 'Välj flera';
    content.querySelector('#ai-select-all').classList.toggle('hidden', !on);
    content.querySelector('#ai-batch-accept').classList.toggle('hidden', !on);
    updateBatchToolbar();
    // Uppdatera alla kort
    content.querySelectorAll('.ai-card').forEach((card) => {
      card.querySelector('.ai-check')?.classList.toggle('hidden', !on);
    });
  };

  content.querySelector('#ai-toggle-select').addEventListener('click', () => toggleBatchMode(!batchMode));

  content.querySelector('#ai-select-all').addEventListener('click', () => {
    const allIds = _aiState.items.map((s) => s.face_id);
    const allSelected = allIds.every((id) => _aiState.selected.has(id));
    if (allSelected) {
      _aiState.selected.clear();
    } else {
      allIds.forEach((id) => _aiState.selected.add(id));
    }
    updateBatchToolbar();
    content.querySelectorAll('.ai-card').forEach((card) => {
      const fid = card.dataset.faceId;
      const sel = _aiState.selected.has(fid);
      applyCardSelection(card, sel);
    });
  });

  content.querySelector('#ai-batch-accept').addEventListener('click', async () => {
    if (_aiState.selected.size === 0) return;
    const ids = [..._aiState.selected];
    try {
      await api.batchAcceptAi(ids);
      ids.forEach((fid) => {
        content.querySelector(`.ai-card[data-face-id="${fid}"]`)?.remove();
        _aiState.items = _aiState.items.filter((s) => s.face_id !== fid);
      });
      _aiState.selected.clear();
      _aiState.total -= ids.length;
      updateTotalLabel();
      updateBatchToolbar();
      toast(`${ids.length} förslag godkända`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  });

  const updateTotalLabel = () => {
    const el = content.querySelector('#ai-total-label');
    if (el) el.textContent = `${_aiState.total} förslag att granska`;
  };

  const appendSuggestions = (suggestions) => {
    const grid = content.querySelector('#ai-grid');
    suggestions.forEach((s) => {
      _aiState.items.push(s);
      const card = buildAiCard(s, batchMode);
      card.addEventListener('click', (e) => {
        if (e.target.closest('.ai-accept, .ai-reject')) return;
        if (!batchMode) return;
        const fid = card.dataset.faceId;
        if (_aiState.selected.has(fid)) _aiState.selected.delete(fid);
        else _aiState.selected.add(fid);
        applyCardSelection(card, _aiState.selected.has(fid));
        updateBatchToolbar();
      });

      card.querySelector('.ai-accept')?.addEventListener('click', async () => {
        try {
          await api.acceptAi(s.face_id);
          card.remove();
          _aiState.items = _aiState.items.filter((x) => x.face_id !== s.face_id);
          _aiState.selected.delete(s.face_id);
          _aiState.total--;
          updateTotalLabel();
          toast('Godkänt', 'success');
        } catch (err) { toast(err.message, 'error'); }
      });

      card.querySelector('.ai-reject')?.addEventListener('click', () => {
        showAiRejectModal(s, async ({ correctPersonId, correctPersonName }) => {
          try {
            await api.rejectAi(s.face_id, { correctPersonId, correctPersonName });
            card.remove();
            _aiState.items = _aiState.items.filter((x) => x.face_id !== s.face_id);
            _aiState.selected.delete(s.face_id);
            _aiState.total--;
            updateTotalLabel();
            toast('Avvisat', 'success');
          } catch (err) { toast(err.message, 'error'); }
        });
      });

      grid.appendChild(card);
    });
  };

  const loadPage = async () => {
    if (_aiState.loading) return;
    _aiState.loading = true;
    try {
      const { data, meta } = await api.aiSuggestions({ limit: AI_PAGE, offset: _aiState.offset });
      _aiState.total = meta.total;
      _aiState.offset += data.length;
      updateTotalLabel();

      if (_aiState.offset === 0 && data.length === 0) {
        content.querySelector('#ai-grid').innerHTML = '<div class="col-span-full text-slate-400 text-sm">Inga väntande AI-förslag.</div>';
        return;
      }

      appendSuggestions(data);

      const loadMoreWrap = content.querySelector('#ai-load-more');
      if (_aiState.offset < _aiState.total) {
        loadMoreWrap.classList.remove('hidden');
      } else {
        loadMoreWrap.classList.add('hidden');
      }
    } catch (e) { toast(e.message, 'error'); }
    finally { _aiState.loading = false; }
  };

  content.querySelector('#ai-load-more button').addEventListener('click', loadPage);

  await loadPage();
}

function buildAiCard(s, batchMode) {
  const card = document.createElement('div');
  card.className = 'ai-card relative bg-slate-800 rounded-xl overflow-hidden cursor-pointer select-none';
  card.dataset.faceId = s.face_id;

  // Konfidensens-färg
  const pct = Math.round(s.confidence * 100);
  const confColor = pct >= 80 ? 'text-green-400' : pct >= 60 ? 'text-yellow-400' : 'text-red-400';

  card.innerHTML = `
    <!-- Urklippt ansikts-thumbnail från /api/faces/:id/thumb -->
    <div class="relative bg-slate-900 flex items-center justify-center" style="height:160px">
      <img src="/api/faces/${s.face_id}/thumb"
           class="h-full w-full object-cover"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="hidden w-full h-full items-center justify-center text-4xl bg-slate-900">👤</div>
      <!-- Batch-checkbox -->
      <div class="ai-check ${batchMode ? '' : 'hidden'} absolute top-2 right-2 w-5 h-5 rounded-full border-2 border-slate-400 bg-black/50 flex items-center justify-center text-xs text-transparent transition-colors"></div>
    </div>
    <!-- Info + knappar -->
    <div class="p-3">
      <div class="text-sm font-medium text-white truncate mb-0.5">${s.suggested_person_name}</div>
      <div class="text-xs ${confColor} mb-2">Säkerhet: ${pct}%</div>
      <div class="flex gap-1.5">
        <button class="ai-accept flex-1 bg-green-700 hover:bg-green-600 text-white text-xs py-1.5 rounded-lg transition-colors">✓ Rätt</button>
        <button class="ai-reject flex-1 bg-red-900 hover:bg-red-800 text-white text-xs py-1.5 rounded-lg transition-colors">✗ Fel</button>
      </div>
    </div>`;

  return card;
}

function applyCardSelection(card, selected) {
  const check = card.querySelector('.ai-check');
  if (!check) return;
  if (selected) {
    check.className = 'ai-check absolute top-2 right-2 w-5 h-5 rounded-full border-2 border-blue-500 bg-blue-500 flex items-center justify-center text-xs text-white transition-colors';
    check.textContent = '✓';
    card.classList.add('ring-2', 'ring-blue-500');
  } else {
    check.className = 'ai-check absolute top-2 right-2 w-5 h-5 rounded-full border-2 border-slate-400 bg-black/50 flex items-center justify-center text-xs text-transparent transition-colors';
    check.textContent = '';
    card.classList.remove('ring-2', 'ring-blue-500');
  }
}

function showAiRejectModal(suggestion, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm';
  overlay.innerHTML = `
    <div class="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-80 p-6">
      <h3 class="text-base font-semibold text-white mb-1">Avvisa förslag</h3>
      <p class="text-xs text-slate-400 mb-4">Förslaget var: <strong class="text-white">${suggestion.suggested_person_name}</strong></p>
      <label class="text-xs text-slate-400 mb-1 block">Rätt person (valfritt)</label>
      <input id="ai-reject-name" type="text" placeholder="Skriv namn eller lämna tomt"
        class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 mb-5">
      <div class="flex gap-2 justify-end">
        <button id="ai-reject-cancel" class="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-700">Avbryt</button>
        <button id="ai-reject-ok" class="px-4 py-2 text-sm font-medium bg-red-700 hover:bg-red-600 text-white rounded-lg transition-colors">Avvisa</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  const input = overlay.querySelector('#ai-reject-name');
  input.focus();

  const doCancel = () => overlay.remove();
  const doConfirm = () => {
    const name = input.value.trim();
    overlay.remove();
    onConfirm({ correctPersonName: name || undefined });
  };

  overlay.querySelector('#ai-reject-ok').addEventListener('click', doConfirm);
  overlay.querySelector('#ai-reject-cancel').addEventListener('click', doCancel);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) doCancel(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doConfirm(); if (e.key === 'Escape') doCancel(); });
}

async function renderAuditLog(content) {
  const { data, meta } = await api.auditLog({ limit: 100 });
  content.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <div class="text-xs text-slate-400">${meta.total} händelser totalt</div>
      <a href="/api/admin/audit-log/csv" download
        class="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors">
        ⬇ Ladda ner CSV
      </a>
    </div>
    <div class="space-y-0.5 font-mono text-xs">
      ${data.map((l) => `
        <div class="flex gap-3 py-1 border-b border-slate-800">
          <span class="text-slate-500 flex-shrink-0">${formatDateTime(l.created_at)}</span>
          <span class="text-blue-400 flex-shrink-0 w-20 truncate">${l.username ?? 'anon'}</span>
          <span class="text-slate-300">${l.action}</span>
          <span class="text-slate-500 truncate">${l.ip_address ?? ''}</span>
        </div>`).join('')}
    </div>`;
}

async function renderDuplicates(content) {
  const { data } = await api.duplicates();
  if (!data.length) { content.innerHTML = '<div class="text-slate-400 text-sm">Inga duplikat hittades.</div>'; return; }

  content.innerHTML = `
    <div class="text-sm text-slate-400 mb-3">${data.length} grupper med duplikat</div>
    <div class="space-y-4">
      ${data.map((group) => `
        <div class="bg-slate-800 rounded-xl p-3">
          <div class="text-xs text-slate-400 mb-2">${group.count} kopior · Hash: ${group.file_hash.slice(0,16)}…</div>
          <div class="flex gap-2 overflow-x-auto pb-1">
            ${group.assets.map((a) => `
              <div class="flex-shrink-0 w-20 text-center">
                <div class="w-20 h-20 rounded overflow-hidden mb-1">
                  <img src="/thumbs/${a.thumb_small_path}" class="w-full h-full object-cover">
                </div>
                <div class="text-xs text-slate-400 truncate">${a.file_path}</div>
              </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;
}

async function renderWatchedFolders(content) {
  const reload = () => renderWatchedFolders(content);

  const { data } = await api.watchedFolders();

  content.innerHTML = `
    <div class="space-y-4">

      <!-- SMB/CIFS-montering -->
      <div class="bg-slate-800 rounded-xl p-4">
        <div class="text-sm font-medium text-white mb-1">Nätverksmapp (SMB/CIFS)</div>
        <p class="text-xs text-slate-400 mb-3">
          Anslut direkt till en NAS, nätverksresurs eller Windows-delad mapp.
          Appen monterar resursen automatiskt — ingen Docker-omstart behövs.
        </p>

        <div class="grid grid-cols-2 gap-3">
          <div class="col-span-2">
            <label class="block text-xs text-slate-400 mb-1">Nätverkssökväg</label>
            <input id="cifs-unc" type="text" placeholder="\\\\NAS\\photos  eller  \\\\192.168.1.100\\Bilder"
              class="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2 border border-slate-600 focus:outline-none focus:border-blue-500 font-mono"
              autocomplete="off">
            <p class="text-xs text-slate-500 mt-1">
              Lokal Windows-mapp: aktivera fildelning i Windows Explorer → använd <span class="font-mono text-slate-300">\\\\host.docker.internal\\MappNamn</span>
            </p>
          </div>

          <div>
            <label class="block text-xs text-slate-400 mb-1">Mount-namn (visas som /mnt/…)</label>
            <input id="cifs-name" type="text" placeholder="Semester"
              class="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2 border border-slate-600 focus:outline-none focus:border-blue-500">
          </div>

          <div>
            <label class="block text-xs text-slate-400 mb-1">Visningsnamn (valfritt)</label>
            <input id="cifs-label" type="text" placeholder="Foton på NAS"
              class="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2 border border-slate-600 focus:outline-none focus:border-blue-500">
          </div>

          <div>
            <label class="block text-xs text-slate-400 mb-1">Användarnamn (valfritt)</label>
            <input id="cifs-user" type="text" placeholder="Lämna tomt för gäst"
              class="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2 border border-slate-600 focus:outline-none focus:border-blue-500"
              autocomplete="off">
          </div>

          <div>
            <label class="block text-xs text-slate-400 mb-1">Lösenord (valfritt)</label>
            <input id="cifs-pass" type="password" placeholder=""
              class="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2 border border-slate-600 focus:outline-none focus:border-blue-500"
              autocomplete="new-password">
          </div>
        </div>

        <div class="flex items-center gap-3 mt-3">
          <button id="cifs-mount-btn"
            class="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">
            Montera och bevaka
          </button>
          <span id="cifs-status" class="text-xs text-slate-400 hidden">Ansluter…</span>
        </div>
      </div>

      <!-- Lägg till känd server-sökväg -->
      <div class="bg-slate-800 rounded-xl p-4">
        <div class="text-sm font-medium text-white mb-3">Lägg till bevakad mapp</div>
        <div class="flex gap-2 mb-2">
          <div class="flex-1 flex gap-1">
            <input id="wf-path" type="text" placeholder="/media/Bilder"
              class="flex-1 bg-slate-700 text-white text-sm rounded-lg px-3 py-2 border border-slate-600 focus:outline-none focus:border-blue-500">
            <button id="wf-browse-btn"
              class="px-3 py-2 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded-lg transition-colors whitespace-nowrap">
              📁 Bläddra
            </button>
          </div>
          <input id="wf-label" type="text" placeholder="Namn (valfritt)"
            class="w-36 bg-slate-700 text-white text-sm rounded-lg px-3 py-2 border border-slate-600 focus:outline-none focus:border-blue-500">
          <button id="wf-add-btn"
            class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors whitespace-nowrap">
            + Lägg till
          </button>
        </div>
        <p class="text-xs text-slate-500">
          Välj en mapp på servern (inuti Docker-containern).
          Nätverksmappar måste vara monterade som volymer i docker-compose.yml.
        </p>
      </div>

      <!-- Mappbläddrare modal -->
      <div id="wf-browser-modal" class="hidden fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
        <div class="bg-slate-900 rounded-2xl w-full max-w-xl shadow-2xl flex flex-col" style="max-height:85vh">
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-700 flex-shrink-0">
            <div class="text-sm font-medium text-white">Välj mapp på servern</div>
            <button id="wf-browser-close" class="text-slate-400 hover:text-white text-xl leading-none px-1">×</button>
          </div>

          <!-- Snabbknappar -->
          <div class="px-4 py-2 border-b border-slate-800 flex gap-2 flex-wrap flex-shrink-0">
            <span class="text-xs text-slate-500 self-center mr-1">Snabbval:</span>
            ${['/media/Bilder','/media','/mnt','/'].map((p) =>
              `<button class="quick-path text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-md"
                data-path="${p}">${p}</button>`).join('')}
          </div>

          <!-- Nuvarande sökväg -->
          <div id="wf-browser-path" class="px-4 py-2 text-xs text-blue-300 font-mono bg-slate-800/50 flex-shrink-0"></div>

          <!-- Mappiste -->
          <div id="wf-browser-list" class="overflow-y-auto flex-1 py-1 min-h-32"></div>

          <div class="px-4 py-3 border-t border-slate-700 flex justify-between items-center flex-shrink-0">
            <div id="wf-browser-selected" class="text-xs text-slate-300 font-mono truncate flex-1 mr-3"></div>
            <button id="wf-browser-select"
              class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors flex-shrink-0">
              ✓ Välj denna mapp
            </button>
          </div>
        </div>
      </div>

      <div class="space-y-2">
        ${data.length === 0
          ? '<div class="text-slate-400 text-sm">Inga extra mappar tillagda ännu.</div>'
          : data.map((f) => `
            <div class="bg-slate-800 rounded-xl p-4 flex items-center gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-0.5">
                  <span class="text-white text-sm font-medium truncate">${f.label || f.path}</span>
                  <span class="text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                    f.status === 'watching' ? 'bg-green-900 text-green-300' :
                    f.status === 'error'    ? 'bg-red-900 text-red-300' :
                    'bg-slate-700 text-slate-400'
                  }">${f.status}</span>
                  ${!f.enabled ? '<span class="text-xs text-slate-500">inaktiv</span>' : ''}
                </div>
                <div class="text-xs text-slate-500 truncate">${f.path}</div>
                ${f.error_msg ? `<div class="text-xs text-red-400 mt-1">${f.error_msg}</div>` : ''}
              </div>
              <div class="flex gap-2 flex-shrink-0">
                <button class="wf-toggle text-xs px-3 py-1.5 rounded-lg transition-colors ${
                  f.enabled
                    ? 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                    : 'bg-blue-700 hover:bg-blue-600 text-white'
                }" data-id="${f.id}" data-enabled="${f.enabled}">
                  ${f.enabled ? 'Inaktivera' : 'Aktivera'}
                </button>
                <button class="wf-delete text-xs px-3 py-1.5 bg-red-900 hover:bg-red-800 text-red-300 rounded-lg transition-colors"
                  data-id="${f.id}">Ta bort</button>
              </div>
            </div>`).join('')}
      </div>
    </div>`;

  content.querySelector('#wf-add-btn').addEventListener('click', async () => {
    const path  = content.querySelector('#wf-path').value.trim();
    const label = content.querySelector('#wf-label').value.trim();
    if (!path) return;
    try {
      await api.addWatchedFolder({ path, label });
      toast('Mapp tillagd och bevakas nu', 'success');
      reload();
    } catch (e) { toast(e.message, 'error'); }
  });

  // === SMB/CIFS-montering ===
  const cifsUncEl    = content.querySelector('#cifs-unc');
  const cifsNameEl   = content.querySelector('#cifs-name');
  const cifsStatusEl = content.querySelector('#cifs-status');

  // Auto-fyll mount-namn från UNC-sökväg
  cifsUncEl.addEventListener('input', () => {
    if (cifsNameEl.value.trim()) return; // Rör inte om användaren redan fyllt i
    const unc   = cifsUncEl.value.trim();
    const parts = unc.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length >= 2) cifsNameEl.value = parts[parts.length - 1];
  });

  content.querySelector('#cifs-mount-btn').addEventListener('click', async () => {
    const uncPath   = cifsUncEl.value.trim();
    const mountName = cifsNameEl.value.trim();
    const label     = content.querySelector('#cifs-label').value.trim();
    const username  = content.querySelector('#cifs-user').value.trim();
    const password  = content.querySelector('#cifs-pass').value;

    if (!uncPath || !mountName) {
      toast('Fyll i nätverkssökväg och mount-namn', 'warn');
      return;
    }

    const btn = content.querySelector('#cifs-mount-btn');
    btn.disabled    = true;
    btn.textContent = 'Ansluter…';
    cifsStatusEl.textContent = 'Kontaktar servern, detta kan ta några sekunder…';
    cifsStatusEl.classList.remove('hidden');

    try {
      await api.post('/api/admin/watched-folders/mount', {
        uncPath, mountName, label, username, password,
      });
      toast(`✓ ${mountName} monterad och bevakas nu`, 'success');
      // Töm formuläret
      cifsUncEl.value = '';
      cifsNameEl.value = '';
      content.querySelector('#cifs-label').value = '';
      content.querySelector('#cifs-user').value  = '';
      content.querySelector('#cifs-pass').value  = '';
      reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Montera och bevaka';
      cifsStatusEl.classList.add('hidden');
    }
  });

  // === Mappbläddrare ===
  const modal      = content.querySelector('#wf-browser-modal');
  const pathEl     = content.querySelector('#wf-browser-path');
  const listEl     = content.querySelector('#wf-browser-list');
  const selectedEl = content.querySelector('#wf-browser-selected');
  const pathInput  = content.querySelector('#wf-path');
  let currentBrowsePath = '/';

  async function browseTo(path) {
    currentBrowsePath = path;
    listEl.innerHTML = '<div class="px-4 py-3 text-slate-400 text-sm">Laddar…</div>';
    try {
      const { data } = await api.browseDir(path);
      pathEl.textContent = data.path;
      selectedEl.textContent = data.path;

      listEl.innerHTML = [
        // Gå upp-rad
        data.parent !== null ? `
          <button class="browse-dir w-full text-left px-4 py-2 hover:bg-slate-800 text-slate-300 text-sm flex items-center gap-2"
            data-path="${data.parent}">
            <span class="text-base">⬆️</span> ..
          </button>` : '',
        // Undermappar
        ...data.dirs.map((d) => `
          <button class="browse-dir w-full text-left px-4 py-2 hover:bg-slate-800 text-slate-300 text-sm flex items-center gap-2"
            data-path="${d.path}">
            <span class="text-base">📁</span> ${d.name}
          </button>`),
        data.dirs.length === 0 && data.parent !== null
          ? '<div class="px-4 py-2 text-slate-500 text-sm italic">Inga undermappar</div>'
          : '',
      ].join('');

      listEl.querySelectorAll('.browse-dir').forEach((btn) => {
        btn.addEventListener('click', () => browseTo(btn.dataset.path));
      });
    } catch (e) {
      listEl.innerHTML = `<div class="px-4 py-3 text-red-400 text-sm">${e.message}</div>`;
    }
  }

  content.querySelector('#wf-browse-btn').addEventListener('click', () => {
    modal.classList.remove('hidden');
    browseTo(pathInput.value.trim() || '/media');
  });

  content.querySelectorAll('.quick-path').forEach((btn) => {
    btn.addEventListener('click', () => browseTo(btn.dataset.path));
  });

  content.querySelector('#wf-browser-close').addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  content.querySelector('#wf-browser-select').addEventListener('click', () => {
    pathInput.value = currentBrowsePath;
    modal.classList.add('hidden');
  });

  content.querySelectorAll('.wf-toggle').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const enabled = btn.dataset.enabled === 'true';
      try {
        await api.patchWatchedFolder(btn.dataset.id, { enabled: !enabled });
        reload();
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  content.querySelectorAll('.wf-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!await confirm('Ta bort bevakad mapp?')) return;
      try {
        await api.deleteWatchedFolder(btn.dataset.id);
        toast('Mapp borttagen', 'success');
        reload();
      } catch (e) { toast(e.message, 'error'); }
    });
  });
}

async function renderTrash(content) {
  content.innerHTML = '<div class="text-slate-400 text-sm">Laddar…</div>';
  let data = [];
  try { ({ data } = await api.trashList()); } catch (e) {
    content.innerHTML = `<div class="text-red-400 text-sm">${e.message}</div>`; return;
  }

  if (!data.length) {
    content.innerHTML = '<div class="text-slate-400 text-sm p-4">Papperskorgen är tom.</div>'; return;
  }

  // ── State ──
  const selected = new Set();
  let lastIdx = null;

  // ── Render ──
  function render() {
    const count = selected.size;
    content.innerHTML = `
      <!-- Toolbar -->
      <div class="flex items-center gap-3 mb-4 flex-wrap">
        <label class="flex items-center gap-1.5 cursor-pointer text-sm text-slate-300 hover:text-white select-none">
          <input id="trash-sel-all" type="checkbox" class="w-4 h-4 rounded accent-blue-500"
            ${count === data.length ? 'checked' : ''}>
          Markera alla
        </label>
        ${count > 0 ? `
          <span class="text-sm font-medium text-white bg-blue-600 rounded-full px-2.5 py-0.5">${count} markerade</span>
          <button id="trash-restore-sel" class="flex items-center gap-1 text-xs bg-blue-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg transition-colors">
            ↩ Återställ markerade
          </button>
          <button id="trash-delete-sel" class="flex items-center gap-1 text-xs bg-red-900 hover:bg-red-800 text-red-300 px-3 py-1.5 rounded-lg transition-colors">
            ✕ Radera permanent
          </button>` : ''}
        <button id="trash-empty-all" class="ml-auto text-xs px-3 py-1.5 bg-red-900/60 hover:bg-red-900 text-red-400 hover:text-red-300 rounded-lg transition-colors">
          Töm papperskorg
        </button>
      </div>

      <!-- Grid -->
      <div id="trash-grid" class="grid gap-1" style="grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))">
        ${data.map((a, i) => `
          <div class="trash-cell relative group bg-slate-800 rounded overflow-hidden cursor-pointer select-none
            ${selected.has(a.id) ? 'ring-2 ring-blue-500' : ''}"
            data-id="${a.id}" data-idx="${i}">
            ${a.thumb_small_path
              ? `<img src="/thumbs/${a.thumb_small_path}" class="w-full aspect-square object-cover ${selected.has(a.id) ? 'opacity-80' : 'opacity-50'}">`
              : `<div class="w-full aspect-square bg-slate-700 flex items-center justify-center text-slate-500 text-2xl">🎥</div>`}
            <!-- Checkbox -->
            <div class="absolute top-1.5 left-1.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-all
              ${selected.has(a.id)
                ? 'bg-blue-500 border-blue-500'
                : 'bg-black/40 border-white/60 opacity-0 group-hover:opacity-100'}">
              ${selected.has(a.id) ? '<svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>' : ''}
            </div>
            <div class="p-1.5">
              <div class="text-xs text-slate-300 truncate">${a.file_name}</div>
              <div class="text-xs text-slate-500">${new Date(a.trashed_at).toLocaleDateString('sv-SE')}</div>
            </div>
          </div>`).join('')}
      </div>`;

    // Cell-klick (Ctrl / Shift / normal)
    content.querySelectorAll('.trash-cell').forEach((cell) => {
      cell.addEventListener('click', (e) => {
        const id  = cell.dataset.id;
        const idx = +cell.dataset.idx;

        if (e.shiftKey && lastIdx !== null) {
          const from = Math.min(lastIdx, idx);
          const to   = Math.max(lastIdx, idx);
          for (let i = from; i <= to; i++) selected.add(data[i].id);
        } else if (e.ctrlKey || e.metaKey) {
          selected.has(id) ? selected.delete(id) : selected.add(id);
          lastIdx = idx;
        } else {
          selected.has(id) ? selected.delete(id) : selected.add(id);
          lastIdx = idx;
        }
        render();
      });
    });

    // Markera alla
    content.querySelector('#trash-sel-all')?.addEventListener('change', (e) => {
      if (e.target.checked) data.forEach((a) => selected.add(a.id));
      else selected.clear();
      render();
    });

    // Återställ markerade
    content.querySelector('#trash-restore-sel')?.addEventListener('click', async () => {
      const ids = [...selected];
      try {
        await Promise.all(ids.map((id) => api.restore(id)));
        toast(`${ids.length} bild${ids.length > 1 ? 'er' : ''} återställd${ids.length > 1 ? 'a' : ''}`, 'success');
        renderTrash(content);
      } catch (e) { toast(e.message, 'error'); }
    });

    // Radera permanent markerade
    content.querySelector('#trash-delete-sel')?.addEventListener('click', async () => {
      const ids = [...selected];
      if (!await confirm(`Radera ${ids.length} bild${ids.length > 1 ? 'er' : ''} permanent? Detta går inte att ångra.`)) return;
      try {
        await Promise.all(ids.map((id) => api.permanentDelete(id)));
        toast(`${ids.length} bild${ids.length > 1 ? 'er' : ''} permanent raderad${ids.length > 1 ? 'e' : ''}`, 'success');
        renderTrash(content);
      } catch (e) { toast(e.message, 'error'); }
    });

    // Töm allt
    content.querySelector('#trash-empty-all')?.addEventListener('click', async () => {
      if (!await confirm(`Töm papperskorgen? ${data.length} bilder raderas permanent.`)) return;
      try {
        await Promise.all(data.map((a) => api.permanentDelete(a.id).catch(() => {})));
        toast('Papperskorgen tömd', 'success');
        renderTrash(content);
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  render();
}

async function renderUserSettings(content) {
  const { data: settings } = await api.getSettings();

  content.innerHTML = `
    <div class="max-w-lg space-y-4">
      <h2 class="text-base font-semibold text-white">Mina inställningar</h2>

      <!-- Ansiktsigenkänning toggle -->
      <div class="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-medium text-white">Automatisk ansiktsigenkänning vid import</div>
            <div class="text-xs text-slate-400 mt-0.5">AI analyserar ansikten i nya bilder som läggs till i bevakade mappar</div>
          </div>
          <button id="face-toggle" role="switch"
            aria-checked="${settings.face_detection_enabled ? 'true' : 'false'}"
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${settings.face_detection_enabled ? 'bg-blue-600' : 'bg-slate-600'}">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.face_detection_enabled ? 'translate-x-6' : 'translate-x-1'}"></span>
          </button>
        </div>
      </div>

      <!-- Ansiktskvalitetsfilter -->
      <div class="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <div class="text-sm font-medium text-white mb-1">Lägsta ansiktskvalitet</div>
        <div class="text-xs text-slate-400 mb-3">Ansikten med lägre kvalitetsscore ignoreras. Högt värde = bara tydliga ansikten. Lågt värde = fler träffar men mer brus.</div>
        <div class="flex items-center gap-3">
          <input id="quality-slider" type="range" min="0" max="1" step="0.05"
            value="${settings.face_quality_threshold ?? 0.5}"
            class="flex-1 accent-blue-500">
          <span id="quality-label" class="text-sm text-white w-10 text-right">${Math.round((settings.face_quality_threshold ?? 0.5) * 100)}%</span>
        </div>
        <button id="quality-save" class="mt-3 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">Spara</button>
      </div>
    </div>`;

  let enabled = settings.face_detection_enabled;
  content.querySelector('#face-toggle').addEventListener('click', async () => {
    enabled = !enabled;
    try {
      await api.patchSettings({ faceDetectionEnabled: enabled });
      const btn = content.querySelector('#face-toggle');
      btn.setAttribute('aria-checked', String(enabled));
      btn.className = `relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${enabled ? 'bg-blue-600' : 'bg-slate-600'}`;
      btn.querySelector('span').className = `inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`;
      toast(enabled ? 'Ansiktsigenkänning aktiverad' : 'Ansiktsigenkänning inaktiverad', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });

  const slider = content.querySelector('#quality-slider');
  const label  = content.querySelector('#quality-label');
  slider.addEventListener('input', () => {
    label.textContent = `${Math.round(slider.value * 100)}%`;
  });
  content.querySelector('#quality-save').addEventListener('click', async () => {
    try {
      await api.patchSettings({ faceQualityThreshold: parseFloat(slider.value) });
      toast('Kvalitetsgräns sparad', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
}
