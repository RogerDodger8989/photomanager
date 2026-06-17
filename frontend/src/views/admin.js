import { api } from '../api.js';
import { toast, formatDateTime, formatBytes, confirm } from '../utils.js';

const TABS = ['stats', 'users', 'jobs', 'ai', 'audit', 'duplicates'];

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
  return { stats:'Statistik', users:'Användare', jobs:'Jobb', ai:'AI-förslag', audit:'Logg', duplicates:'Duplikat' }[t] ?? t;
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
    <div class="mb-4 flex flex-wrap gap-2">
      ${stats.map((s) => `
        <div class="bg-slate-800 rounded-lg px-3 py-2 text-xs">
          <span class="text-slate-400">${s.job_type} / ${s.status}</span>
          <span class="ml-2 font-medium text-white">${s.count}</span>
        </div>`).join('')}
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
}

async function renderAiSuggestions(content) {
  const { data, meta } = await api.aiSuggestions({ limit: 50 });
  if (!data.length) { content.innerHTML = '<div class="text-slate-400 text-sm">Inga väntande AI-förslag.</div>'; return; }

  content.innerHTML = `
    <div class="flex justify-between items-center mb-3">
      <div class="text-sm text-slate-400">${meta.total} förslag att granska</div>
    </div>
    <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))">
      ${data.map((s) => `
        <div class="bg-slate-800 rounded-xl overflow-hidden">
          <div class="relative">
            <img src="/thumbs/${s.thumb_small_path}" class="w-full aspect-video object-cover">
            <!-- Face box overlay -->
            <div class="absolute border-2 border-blue-400 rounded" style="
              left:${s.region_x * 100}%; top:${s.region_y * 100}%;
              width:${s.region_w * 100}%; height:${s.region_h * 100}%">
            </div>
          </div>
          <div class="p-3">
            <div class="text-sm text-white font-medium">${s.suggested_person_name}</div>
            <div class="text-xs text-slate-400">Säkerhet: ${Math.round(s.confidence * 100)}%</div>
            <div class="flex gap-2 mt-2">
              <button class="ai-accept flex-1 bg-green-700 hover:bg-green-600 text-white text-xs py-1.5 rounded transition-colors" data-face="${s.face_id}">✓ Rätt</button>
              <button class="ai-reject flex-1 bg-red-800 hover:bg-red-700 text-white text-xs py-1.5 rounded transition-colors" data-face="${s.face_id}">✗ Fel</button>
            </div>
          </div>
        </div>`).join('')}
    </div>`;

  content.querySelectorAll('.ai-accept').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try { await api.acceptAi(btn.dataset.face); btn.closest('.bg-slate-800').remove(); }
      catch (e) { toast(e.message, 'error'); }
    });
  });

  content.querySelectorAll('.ai-reject').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const name = window.prompt('Rätt personnamn (lämna tomt om okänd):');
      try {
        await api.rejectAi(btn.dataset.face, name?.trim() ? { correctPersonName: name.trim() } : {});
        btn.closest('.bg-slate-800').remove();
      } catch (e) { toast(e.message, 'error'); }
    });
  });
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
