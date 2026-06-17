import { api } from '../api.js';
import { toast, formatDateTime, formatBytes, confirm } from '../utils.js';

const TABS = ['stats', 'users', 'jobs', 'ai', 'audit', 'duplicates', 'folders'];

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
  return { stats:'Statistik', users:'Användare', jobs:'Jobb', ai:'AI-förslag', audit:'Logg', duplicates:'Duplikat', folders:'Mappar' }[t] ?? t;
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

async function renderWatchedFolders(content) {
  const reload = () => renderWatchedFolders(content);

  const { data } = await api.watchedFolders();

  content.innerHTML = `
    <div class="space-y-4">

      <!-- Windows/nätverksmapp-guide -->
      <div class="bg-slate-800 rounded-xl p-4">
        <div class="text-sm font-medium text-white mb-1">Windows- eller nätverksmapp</div>
        <p class="text-xs text-slate-400 mb-3">
          Vill du bevaka en mapp på din Windows-dator eller ett nätverksdelat ställe (t.ex. en NAS)?
          Klicka nedan så öppnas en riktig Windows-dialog.
        </p>
        <button id="wf-winpick-btn"
          class="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-xl transition-colors">
          🪟 Välj Windows-mapp…
        </button>
        <!-- Instruktionsruta — visas efter val -->
        <div id="wf-winpick-info" class="hidden mt-4 bg-slate-900 border border-amber-700 rounded-xl p-4 space-y-3">
          <div class="flex items-start gap-2">
            <span class="text-amber-400 text-lg leading-none mt-0.5">ℹ️</span>
            <div>
              <div class="text-amber-300 text-sm font-medium mb-1">
                Du valde mappen: <span id="wf-win-name" class="font-mono text-white"></span>
              </div>
              <div class="text-slate-400 text-xs">
                Webbläsaren kan inte visa den fullständiga Windows-sökvägen av säkerhetsskäl.
                Följ stegen nedan för att koppla in mappen.
              </div>
            </div>
          </div>

          <div class="space-y-2 text-sm">
            <div class="text-slate-300 font-medium">Steg 1 — Lägg till denna rad i <span class="font-mono text-blue-300">docker-compose.dev.yml</span> under <span class="font-mono text-green-300">volumes:</span> för photomanager-tjänsten:</div>
            <div class="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2">
              <code id="wf-win-mountline" class="flex-1 text-xs text-green-300 font-mono break-all"></code>
              <button id="wf-win-copy" class="flex-shrink-0 text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded">Kopiera</button>
            </div>
            <div class="text-xs text-slate-500">
              Ersätt <span class="text-amber-300 font-mono">C:\DIN\SÖKVÄG</span> med den faktiska sökvägen på din dator.
              Exempel: <span class="font-mono text-slate-300">- D:\Bilder\Semester:/mnt/Semester</span>
            </div>

            <div class="text-slate-300 font-medium mt-1">Steg 2 — Starta om Docker med det nya mount:</div>
            <div class="bg-slate-800 rounded-lg px-3 py-2">
              <code class="text-xs text-green-300 font-mono">docker-compose -f docker-compose.dev.yml up -d</code>
            </div>

            <div class="text-slate-300 font-medium mt-1">Steg 3 — Lägg till mappen i fältet nedan:</div>
            <div class="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2">
              <code id="wf-win-containerpath" class="flex-1 text-xs text-blue-300 font-mono"></code>
              <button id="wf-win-use" class="flex-shrink-0 text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded">Använd</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Lägg till känd server-sökväg -->
      <div class="bg-slate-800 rounded-xl p-4">
        <div class="text-sm font-medium text-white mb-3">Lägg till bevakad mapp</div>
        <div class="flex gap-2 mb-2">
          <div class="flex-1 flex gap-1">
            <input id="wf-path" type="text" placeholder="/media/photos"
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
            ${['/media/photos','/media/thumbs','/mnt','/'].map((p) =>
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

  // === Windows-mappväljare ===
  content.querySelector('#wf-winpick-btn').addEventListener('click', async () => {
    if (!('showDirectoryPicker' in window)) {
      toast('Din webbläsare stöder inte Windows-dialogrutan. Ange sökvägen manuellt.', 'warn');
      return;
    }
    let handle;
    try {
      handle = await window.showDirectoryPicker();
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, 'error');
      return;
    }
    const folderName = handle.name;
    const containerPath = `/mnt/${folderName}`;
    const mountLine = `      - C:\\DIN\\SÖKVÄG\\${folderName}:${containerPath}`;

    const infoEl       = content.querySelector('#wf-winpick-info');
    const nameEl       = content.querySelector('#wf-win-name');
    const mountEl      = content.querySelector('#wf-win-mountline');
    const cpathEl      = content.querySelector('#wf-win-containerpath');

    nameEl.textContent  = folderName;
    mountEl.textContent = mountLine;
    cpathEl.textContent = containerPath;
    infoEl.classList.remove('hidden');

    content.querySelector('#wf-win-copy').onclick = () => {
      navigator.clipboard.writeText(mountLine.trim())
        .then(() => toast('Kopierat!', 'success'))
        .catch(() => toast('Kunde inte kopiera — markera och kopiera manuellt', 'warn'));
    };

    content.querySelector('#wf-win-use').onclick = () => {
      content.querySelector('#wf-path').value = containerPath;
      content.querySelector('#wf-label').value = folderName;
      content.querySelector('#wf-path').focus();
      toast(`Sökväg ifylld: ${containerPath}`, 'info');
    };
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
    browseTo(pathInput.value.trim() || '/media/photos');
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
