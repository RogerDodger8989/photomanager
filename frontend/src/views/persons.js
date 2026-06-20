import { api } from '../api.js';
import { openLightbox } from '../components/lightbox.js';
import { buildPhotoCell, attachFavHeart } from '../components/gridCell.js';
import { toast } from '../utils.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function ageAtPhoto(birthYear, takenAt) {
  if (!birthYear || !takenAt) return null;
  const age = new Date(takenAt).getFullYear() - birthYear;
  return age >= 0 ? age : null;
}

function personAgeLabel(person) {
  const { birth_year, death_year } = person;
  if (birth_year && death_year) return `Född ${birth_year} · Avliden ${death_year}`;
  if (birth_year) return `Född ${birth_year} · ${new Date().getFullYear() - birth_year} år`;
  if (death_year) return `Avliden ${death_year}`;
  return null;
}

function coverSrc(p) {
  const faceId = p.cover_face_id ?? p.fallback_face_id;
  if (faceId) return `/api/faces/${faceId}/thumb`;
  return null;
}

// ── Edit Person Modal ─────────────────────────────────────────────────────────

function showEditPersonModal(person, onSave) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm';
  overlay.innerHTML = `
    <div class="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-80 p-6">
      <h3 class="text-base font-semibold text-white mb-4">Redigera person</h3>
      <label class="text-xs text-slate-400 mb-1 block">Namn</label>
      <input id="ep-name" type="text" value="${(person.name ?? '').replace(/"/g, '&quot;')}"
        class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 mb-3">
      <label class="text-xs text-slate-400 mb-1 block">Födelseår (valfritt)</label>
      <input id="ep-birth" type="number" min="1900" max="2099" value="${person.birth_year ?? ''}"
        placeholder="t.ex. 1985"
        class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 mb-3">
      <label class="text-xs text-slate-400 mb-1 block">Dödsår (valfritt)</label>
      <input id="ep-death" type="number" min="1900" max="2099" value="${person.death_year ?? ''}"
        placeholder="t.ex. 2020"
        class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 mb-5">
      <div class="flex gap-2 justify-end">
        <button id="ep-cancel" class="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-700">Avbryt</button>
        <button id="ep-ok" class="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">Spara</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  const nameInput  = overlay.querySelector('#ep-name');
  const birthInput = overlay.querySelector('#ep-birth');
  const deathInput = overlay.querySelector('#ep-death');
  nameInput.focus(); nameInput.select();

  const original = { name: person.name ?? '', birth: String(person.birth_year ?? ''), death: String(person.death_year ?? '') };
  const isDirty = () =>
    nameInput.value.trim() !== original.name ||
    birthInput.value.trim() !== original.birth ||
    deathInput.value.trim() !== original.death;

  const doCancel = () => {
    if (isDirty() && !confirm('Du har osparade ändringar. Vill du ändå avbryta?')) return;
    overlay.remove();
  };
  const doSave = () => {
    const name = nameInput.value.trim();
    if (!name) return;
    overlay.remove();
    onSave({
      name,
      birthYear: birthInput.value ? parseInt(birthInput.value, 10) : null,
      deathYear: deathInput.value ? parseInt(deathInput.value, 10) : null,
    });
  };

  overlay.querySelector('#ep-ok').addEventListener('click', doSave);
  overlay.querySelector('#ep-cancel').addEventListener('click', doCancel);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) doCancel(); });
  [nameInput, birthInput, deathInput].forEach((inp) => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); if (e.key === 'Escape') doCancel(); });
  });
}

// ── Merge Modal ───────────────────────────────────────────────────────────────

function showMergeModal(selectedPersons, onMerge) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm';
  overlay.innerHTML = `
    <div class="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-[420px] p-6">
      <h3 class="text-base font-semibold text-white mb-1">Slå ihop personer</h3>
      <p class="text-xs text-slate-400 mb-4">${selectedPersons.length} personer slås ihop till en.</p>
      <label class="text-xs text-slate-400 mb-2 block">Välj vilken person som ska behållas:</label>
      <div id="merge-keep-list" class="space-y-1 mb-4 max-h-48 overflow-y-auto">
        ${selectedPersons.map((p, i) => `
          <label class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-700 cursor-pointer">
            <input type="radio" name="merge-keep" value="${p.id}" ${i === 0 ? 'checked' : ''} class="accent-blue-500">
            <div class="w-8 h-8 rounded-full overflow-hidden bg-slate-600 flex-shrink-0">
              ${coverSrc(p) ? `<img src="${coverSrc(p)}" class="w-full h-full object-cover">` : '<div class="w-full h-full flex items-center justify-center text-sm">👤</div>'}
            </div>
            <span class="text-sm text-white">${p.name}</span>
            <span class="text-xs text-slate-400 ml-auto">${p.photo_count} bilder</span>
          </label>`).join('')}
      </div>
      <label class="text-xs text-slate-400 mb-1 block">Nytt namn (lämna tomt för att behålla valt):</label>
      <input id="merge-new-name" type="text" placeholder="Nytt namn (valfritt)"
        class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 mb-5">
      <div class="flex gap-2 justify-end">
        <button id="merge-cancel" class="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-700">Avbryt</button>
        <button id="merge-ok" class="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">Slå ihop</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  const newNameInput = overlay.querySelector('#merge-new-name');

  const doCancel = () => overlay.remove();
  const doMerge = () => {
    const keepId  = overlay.querySelector('input[name="merge-keep"]:checked')?.value;
    if (!keepId) return;
    overlay.remove();
    onMerge({ keepId, newName: newNameInput.value.trim() || null });
  };

  overlay.querySelector('#merge-ok').addEventListener('click', doMerge);
  overlay.querySelector('#merge-cancel').addEventListener('click', doCancel);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) doCancel(); });
  const escHandler = (e) => { if (e.key === 'Escape') { doCancel(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);
  newNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doMerge(); });
}

// ── Create/Assign Person Modal (from unknown faces) ───────────────────────────

function showCreatePersonModal(selectedFaceIds, allPersons, onDone) {
  const preview = selectedFaceIds.slice(0, 6).map(id =>
    `<img src="/api/faces/${id}/thumb" class="w-14 h-14 rounded-lg object-cover border-2 border-slate-600" onerror="this.style.display='none'">`
  ).join('');
  const more = selectedFaceIds.length > 6 ? `<div class="w-14 h-14 rounded-lg bg-slate-700 flex items-center justify-center text-xs text-slate-400">+${selectedFaceIds.length - 6}</div>` : '';

  const personOptions = allPersons.map(p =>
    `<option value="${p.id}">${p.name} (${p.photo_count} bilder)</option>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm';
  overlay.innerHTML = `
    <div class="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-96 p-6">
      <h3 class="text-base font-semibold text-white mb-3">Tilldela ${selectedFaceIds.length} ansikten</h3>
      <div class="flex gap-2 mb-5 flex-wrap">${preview}${more}</div>

      <div id="cp-tabs" class="flex gap-1 mb-4 bg-slate-900 rounded-lg p-1">
        <button data-tab="new" class="cp-tab flex-1 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white transition-colors">Skapa ny person</button>
        <button data-tab="existing" class="cp-tab flex-1 py-1.5 text-xs font-medium rounded-md text-slate-400 hover:text-white transition-colors">Tilldela befintlig</button>
      </div>

      <div id="cp-new">
        <label class="text-xs text-slate-400 mb-1 block">Namn <span class="text-red-400">*</span></label>
        <input id="cp-name" type="text" placeholder="Fullständigt namn"
          class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 mb-3">
        <div class="flex gap-3">
          <div class="flex-1">
            <label class="text-xs text-slate-400 mb-1 block">Födelseår</label>
            <input id="cp-birth" type="number" min="1900" max="2099" placeholder="t.ex. 1985"
              class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
          </div>
          <div class="flex-1">
            <label class="text-xs text-slate-400 mb-1 block">Dödsår</label>
            <input id="cp-death" type="number" min="1900" max="2099" placeholder="t.ex. 2020"
              class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
          </div>
        </div>
      </div>

      <div id="cp-existing" class="hidden">
        <label class="text-xs text-slate-400 mb-1 block">Välj person</label>
        <select id="cp-person-select" class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
          <option value="">-- Välj person --</option>
          ${personOptions}
        </select>
      </div>

      <div class="flex gap-2 justify-end mt-5">
        <button id="cp-cancel" class="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-700">Avbryt</button>
        <button id="cp-ok" class="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">Tilldela</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  let activeTab = 'new';
  overlay.querySelectorAll('.cp-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      overlay.querySelectorAll('.cp-tab').forEach(b => {
        b.className = `cp-tab flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${b.dataset.tab === activeTab ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`;
      });
      overlay.querySelector('#cp-new').classList.toggle('hidden', activeTab !== 'new');
      overlay.querySelector('#cp-existing').classList.toggle('hidden', activeTab !== 'existing');
    });
  });

  const doCancel = () => overlay.remove();
  const doOk = async () => {
    try {
      if (activeTab === 'new') {
        const name = overlay.querySelector('#cp-name').value.trim();
        if (!name) { toast('Ange ett namn', 'error'); return; }
        const birth = overlay.querySelector('#cp-birth').value;
        const death = overlay.querySelector('#cp-death').value;
        await api.assignFaces({
          faceIds: selectedFaceIds,
          personName: name,
          birthYear: birth ? parseInt(birth, 10) : null,
          deathYear: death ? parseInt(death, 10) : null,
        });
        toast(`Person "${name}" skapad och ansikten tilldelade`, 'success');
      } else {
        const personId = overlay.querySelector('#cp-person-select').value;
        if (!personId) { toast('Välj en person', 'error'); return; }
        await api.assignFaces({ faceIds: selectedFaceIds, personId });
        toast('Ansikten tilldelade', 'success');
      }
      overlay.remove();
      onDone();
    } catch (e) { toast(e.message, 'error'); }
  };

  overlay.querySelector('#cp-ok').addEventListener('click', doOk);
  overlay.querySelector('#cp-cancel').addEventListener('click', doCancel);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) doCancel(); });
  overlay.querySelector('#cp-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') doOk(); });
  overlay.querySelector('#cp-name').focus();
}

// ── Unknown Faces Tab ─────────────────────────────────────────────────────────

async function renderUnknownFacesTab(container, allPersons) {
  container.innerHTML = `
    <div class="p-4">
      <div id="unknown-content">
        <div class="text-slate-400 text-sm">Laddar okända ansikten…</div>
      </div>
      <!-- Bulk-balk -->
      <div id="face-bulk-bar" class="hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-900 border-t border-slate-700 p-3 flex items-center gap-3 flex-wrap">
        <span id="face-bulk-count" class="text-sm text-slate-300 font-medium">0 valda</span>
        <button id="face-assign-btn" class="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">Tilldela befintlig person</button>
        <button id="face-create-btn" class="px-4 py-2 text-sm bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors">Skapa ny person</button>
        <button id="face-clear-btn" class="px-3 py-2 text-sm text-slate-400 hover:text-white transition-colors">Avbryt</button>
      </div>
    </div>`;

  const selectedFaceIds = new Set();
  let lastClickedFaceIndex = -1;
  let allFaceElements = [];

  const updateBulkBar = () => {
    const bar = document.getElementById('face-bulk-bar');
    const count = document.getElementById('face-bulk-count');
    if (!bar) return;
    bar.classList.toggle('hidden', selectedFaceIds.size === 0);
    if (count) count.textContent = `${selectedFaceIds.size} vald${selectedFaceIds.size === 1 ? '' : 'a'}`;
  };

  const clearSelection = () => {
    selectedFaceIds.clear();
    allFaceElements.forEach(el => {
      el.classList.remove('ring-2', 'ring-blue-500');
      const check = el.querySelector('.face-check');
      if (check) check.classList.add('hidden');
    });
    updateBulkBar();
  };

  const toggleFace = (faceId, el) => {
    if (selectedFaceIds.has(faceId)) {
      selectedFaceIds.delete(faceId);
      el.classList.remove('ring-2', 'ring-blue-500');
      el.querySelector('.face-check')?.classList.add('hidden');
    } else {
      selectedFaceIds.add(faceId);
      el.classList.add('ring-2', 'ring-blue-500');
      el.querySelector('.face-check')?.classList.remove('hidden');
    }
    updateBulkBar();
  };

  let clusters = [];
  try {
    const { data, meta } = await api.unassignedFaces();
    clusters = data ?? [];

    const uc = document.getElementById('unknown-content');
    if (!uc) return;

    if (!clusters.length) {
      uc.innerHTML = '<div class="text-slate-400 text-sm">Inga okända ansikten hittades.</div>';
      return;
    }

    uc.innerHTML = `<p class="text-xs text-slate-500 mb-4">${meta.total_faces} okände ansikten i ${meta.total_clusters} grupper</p>`;

    allFaceElements = [];

    clusters.forEach((cluster, ci) => {
      const card = document.createElement('div');
      card.className = 'mb-5';
      const label = cluster.clusterId
        ? `Grupp ${ci + 1} · ${cluster.faces.length} ansikten`
        : `Enskilt ansikte`;
      card.innerHTML = `
        <div class="text-xs text-slate-400 mb-2 font-medium">${label}</div>
        <div class="flex flex-wrap gap-2" data-cluster="${cluster.clusterId ?? 'none'}"></div>`;

      const faceRow = card.querySelector('[data-cluster]');
      const clusterFaceEls = [];

      cluster.faces.forEach((face, fi) => {
        const el = document.createElement('div');
        el.className = 'relative w-16 h-16 rounded-lg overflow-hidden bg-slate-700 cursor-pointer hover:opacity-90 transition-opacity select-none';
        el.dataset.faceId = face.id;
        el.innerHTML = `
          <img src="/api/faces/${face.id}/thumb" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<div class=\\'w-full h-full flex items-center justify-center text-xl text-slate-500\\'>?</div>'">
          <div class="face-check hidden absolute inset-0 bg-blue-500/30 flex items-center justify-center">
            <div class="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">✓</div>
          </div>`;

        el.addEventListener('click', (e) => {
          const globalIdx = allFaceElements.indexOf(el);
          if (e.shiftKey && lastClickedFaceIndex >= 0) {
            const from = Math.min(lastClickedFaceIndex, globalIdx);
            const to   = Math.max(lastClickedFaceIndex, globalIdx);
            for (let k = from; k <= to; k++) {
              const target = allFaceElements[k];
              const tid = target.dataset.faceId;
              if (!selectedFaceIds.has(tid)) {
                selectedFaceIds.add(tid);
                target.classList.add('ring-2', 'ring-blue-500');
                target.querySelector('.face-check')?.classList.remove('hidden');
              }
            }
            updateBulkBar();
          } else if (e.ctrlKey || e.metaKey) {
            toggleFace(face.id, el);
          } else {
            clearSelection();
            toggleFace(face.id, el);
          }
          lastClickedFaceIndex = allFaceElements.indexOf(el);
        });

        faceRow.appendChild(el);
        clusterFaceEls.push(el);
        allFaceElements.push(el);
      });

      // Snabb-knapp för hela klustret
      if (cluster.faces.length > 1) {
        const selectAll = document.createElement('button');
        selectAll.className = 'mt-1 text-xs text-blue-400 hover:text-blue-300';
        selectAll.textContent = 'Markera hela gruppen';
        selectAll.addEventListener('click', () => {
          clusterFaceEls.forEach(el => {
            const fid = el.dataset.faceId;
            if (!selectedFaceIds.has(fid)) {
              selectedFaceIds.add(fid);
              el.classList.add('ring-2', 'ring-blue-500');
              el.querySelector('.face-check')?.classList.remove('hidden');
            }
          });
          updateBulkBar();
        });
        card.appendChild(selectAll);
      }

      uc.appendChild(card);
    });

  } catch (e) { toast(e.message, 'error'); }

  // Bulk-knappar
  const onDone = async () => {
    clearSelection();
    await renderUnknownFacesTab(container, allPersons);
  };

  document.getElementById('face-clear-btn')?.addEventListener('click', clearSelection);

  document.getElementById('face-create-btn')?.addEventListener('click', () => {
    if (!selectedFaceIds.size) return;
    showCreatePersonModal([...selectedFaceIds], allPersons, onDone);
  });

  document.getElementById('face-assign-btn')?.addEventListener('click', () => {
    if (!selectedFaceIds.size) return;
    // Visa modal i "tilldela befintlig"-läge direkt
    showCreatePersonModal([...selectedFaceIds], allPersons, onDone);
  });
}

// ── Person List ───────────────────────────────────────────────────────────────

export async function renderPersons(container, personId = null) {
  if (personId) {
    await renderPersonDetail(container, personId);
  } else {
    await renderPersonList(container);
  }
}

let _allPersons = [];
const _selectedIds = new Set();
let _activeFilter = null;
let _activeSort = 'most_photos';

async function renderPersonList(container) {
  container.innerHTML = `
    <div class="p-4">
      <div class="flex items-center gap-3 mb-3 flex-wrap">
        <h1 class="text-xl font-semibold text-white">Ansikten</h1>
        <button id="find-dupes-btn"
          class="ml-auto px-3 py-1.5 text-xs border border-slate-600 hover:border-yellow-500 text-slate-400 hover:text-yellow-400 rounded-lg transition-colors">
          🔍 Hitta dubbletter
        </button>
        <button id="face-search-btn"
          class="px-3 py-1.5 text-xs border border-slate-600 hover:border-blue-500 text-slate-400 hover:text-blue-400 rounded-lg transition-colors">
          📷 Sök via bild
        </button>
      </div>

      <!-- Huvud-tabbar -->
      <div class="flex gap-1 mb-4 bg-slate-900 rounded-xl p-1 max-w-xs">
        <button id="tab-named" data-view="named"
          class="view-tab flex-1 py-1.5 text-xs font-medium rounded-lg bg-slate-700 text-white transition-colors">
          Namngivna
        </button>
        <button id="tab-unknown" data-view="unknown"
          class="view-tab flex-1 py-1.5 text-xs font-medium rounded-lg text-slate-400 hover:text-white transition-colors">
          Okända ansikten
        </button>
      </div>

      <!-- Namngivna-innehåll -->
      <div id="view-named">
        <div class="flex items-center gap-3 mb-3 flex-wrap">
          <div class="flex-1 min-w-[180px]">
            <input id="person-search" type="text" placeholder="Sök person…"
              class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500">
          </div>
          <select id="persons-sort" class="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
            <option value="most_photos">Flest bilder</option>
            <option value="least_photos">Färst bilder</option>
            <option value="name_asc">Namn A–Ö</option>
            <option value="name_desc">Namn Ö–A</option>
            <option value="newest">Nyast tillagd</option>
            <option value="birth_year">Födelseår</option>
          </select>
        </div>

        <!-- Filterchips -->
        <div class="flex flex-wrap gap-2 mb-4">
          <button class="filter-chip px-3 py-1 text-xs rounded-full border transition-colors bg-blue-600 border-blue-500 text-white" data-filter="">Alla</button>
          <button class="filter-chip px-3 py-1 text-xs rounded-full border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 transition-colors" data-filter="no_photos">Utan foton</button>
          <button class="filter-chip px-3 py-1 text-xs rounded-full border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 transition-colors" data-filter="no_birth">Saknar födelseår</button>
          <button class="filter-chip px-3 py-1 text-xs rounded-full border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 transition-colors" data-filter="no_death">Saknar dödsår</button>
          <button class="filter-chip px-3 py-1 text-xs rounded-full border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 transition-colors" data-filter="dead">Enbart döda</button>
          <button class="filter-chip px-3 py-1 text-xs rounded-full border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 transition-colors" data-filter="alive">Enbart levande</button>
        </div>

        <button id="merge-mode-btn"
          class="mb-4 flex items-center gap-2 px-3 py-1.5 text-sm border border-slate-600 hover:border-blue-500 text-slate-300 hover:text-white rounded-lg transition-colors">
          🔀 Välj för sammanslagning
        </button>
        <div id="merge-toolbar" class="hidden mb-4 flex items-center gap-3 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2">
          <span id="merge-count" class="text-sm text-slate-400">0 valda</span>
          <button id="do-merge-btn" class="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors opacity-40 pointer-events-none" data-disabled="true">
            Slå ihop
          </button>
          <button id="cancel-merge-btn" class="px-3 py-1.5 text-sm text-slate-400 hover:text-white transition-colors">Avbryt</button>
        </div>

        <!-- AI-förslag -->
        <div id="ai-suggestions-section" class="hidden mb-5"></div>

        <div id="persons-grid" class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(130px, 1fr))">
          <div class="col-span-full text-slate-400 text-sm">Laddar…</div>
        </div>
      </div>

      <!-- Okända ansikten-innehåll -->
      <div id="view-unknown" class="hidden"></div>
    </div>`;

  // Laddning av AI-förslag
  try {
    const { data: aiStatus } = await api.aiStatus();
    if (aiStatus.available) {
      const { data: suggestions } = await api.aiSuggestions({ limit: 100 });
      if (suggestions?.length) {
        renderAiSuggestions(suggestions);
      }
    }
  } catch {}

  // Laddning av personlistan
  const reloadPersons = async () => {
    try {
      const params = {};
      if (_activeFilter) params.filter = _activeFilter;
      if (_activeSort)   params.sort   = _activeSort;
      const { data } = await api.persons(params);
      _allPersons = data ?? [];
      _selectedIds.clear();
      const q = document.getElementById('person-search')?.value?.toLowerCase() ?? '';
      const filtered = q ? _allPersons.filter(p => p.name.toLowerCase().includes(q)) : _allPersons;
      const merging = !document.getElementById('merge-toolbar')?.classList.contains('hidden');
      renderPersonGrid(filtered, merging);
    } catch (e) { toast(e.message, 'error'); }
  };

  await reloadPersons();

  // Sök
  document.getElementById('person-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = q ? _allPersons.filter(p => p.name.toLowerCase().includes(q)) : _allPersons;
    const merging = !document.getElementById('merge-toolbar').classList.contains('hidden');
    renderPersonGrid(filtered, merging);
  });

  // Sortering
  document.getElementById('persons-sort').value = _activeSort;
  document.getElementById('persons-sort').addEventListener('change', (e) => {
    _activeSort = e.target.value;
    reloadPersons();
  });

  // Filterchips
  document.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeFilter = btn.dataset.filter || null;
      document.querySelectorAll('.filter-chip').forEach(b => {
        const active = b.dataset.filter === (btn.dataset.filter);
        b.className = `filter-chip px-3 py-1 text-xs rounded-full border transition-colors ${
          active ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-600 text-slate-400 hover:text-white hover:border-slate-400'
        }`;
      });
      reloadPersons();
    });
  });

  // Sammanslagning
  document.getElementById('merge-mode-btn').addEventListener('click', () => {
    _selectedIds.clear();
    document.getElementById('merge-toolbar').classList.remove('hidden');
    document.getElementById('merge-mode-btn').classList.add('hidden');
    renderPersonGrid(_allPersons, true);
  });

  document.getElementById('cancel-merge-btn').addEventListener('click', () => {
    _selectedIds.clear();
    document.getElementById('merge-toolbar').classList.add('hidden');
    document.getElementById('merge-mode-btn').classList.remove('hidden');
    renderPersonGrid(_allPersons, false);
  });

  document.getElementById('do-merge-btn').addEventListener('click', () => {
    if (_selectedIds.size < 2) return;
    const selected = _allPersons.filter(p => _selectedIds.has(p.id));
    showMergeModal(selected, async ({ keepId, newName }) => {
      try {
        await api.mergePeople({ personIds: [..._selectedIds], keepId, newName: newName || undefined });
        toast('Sammanslagning klar', 'success');
        _selectedIds.clear();
        document.getElementById('merge-toolbar').classList.add('hidden');
        document.getElementById('merge-mode-btn').classList.remove('hidden');
        await reloadPersons();
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  // Dubbletter och ansiktssökning
  document.getElementById('find-dupes-btn').addEventListener('click', () => showDuplicatePersonsModal());
  document.getElementById('face-search-btn').addEventListener('click', () => showFaceSearchModal());

  // Huvud-tabbar
  let activeView = 'named';
  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', async () => {
      activeView = btn.dataset.view;
      document.querySelectorAll('.view-tab').forEach(b => {
        const active = b.dataset.view === activeView;
        b.className = `view-tab flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${active ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`;
      });
      document.getElementById('view-named').classList.toggle('hidden', activeView !== 'named');
      const unknownEl = document.getElementById('view-unknown');
      unknownEl.classList.toggle('hidden', activeView !== 'unknown');
      if (activeView === 'unknown' && !unknownEl.children.length) {
        await renderUnknownFacesTab(unknownEl, _allPersons);
      }
    });
  });
}

// ── Statistik-flik ────────────────────────────────────────────────────────────

async function renderStatsTab(container, personId, person) {
  container.innerHTML = '<div class="text-slate-400 text-sm p-2">Laddar statistik…</div>';
  try {
    const { data } = await api.personStats(personId);
    const { photoYears, topMonths, topPlaces, yearRange } = data;

    const topYear = photoYears[0];
    const span = (yearRange.first_year && yearRange.last_year)
      ? `${yearRange.first_year}–${yearRange.last_year} (${yearRange.active_years} aktiva år)`
      : '—';

    container.innerHTML = `
      <div class="space-y-5 pb-4">
        <!-- Sammanfattning -->
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
          ${[
            ['Tidsspan', span],
            ['Mest fotograferad', topYear ? `${topYear.year} (${topYear.count} bilder)` : '—'],
            ['Favoritplatser', topPlaces.length ? topPlaces[0].location_label : '—'],
          ].map(([label, val]) => `
            <div class="bg-slate-800 rounded-xl p-3">
              <div class="text-sm font-medium text-white truncate">${val}</div>
              <div class="text-xs text-slate-500 mt-0.5">${label}</div>
            </div>`).join('')}
        </div>

        ${photoYears.length ? `
        <!-- År-staplar -->
        <div>
          <div class="text-xs font-medium text-slate-400 mb-2">Bilder per år</div>
          <div class="space-y-1.5 max-h-48 overflow-y-auto">
            ${photoYears.map(r => {
              const pct = Math.round((r.count / photoYears[0].count) * 100);
              const age = person.birth_year ? r.year - person.birth_year : null;
              return `<div class="flex items-center gap-2 text-xs">
                <span class="text-slate-400 w-12 text-right">${r.year}${age !== null && age >= 0 ? ` (${age})` : ''}</span>
                <div class="flex-1 bg-slate-700 rounded-full h-2">
                  <div class="bg-blue-500 h-2 rounded-full" style="width:${pct}%"></div>
                </div>
                <span class="text-slate-300 w-8 text-right">${r.count}</span>
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}

        ${topMonths.length ? `
        <!-- Favoritperioder -->
        <div>
          <div class="text-xs font-medium text-slate-400 mb-2">Mest fotograferade månader</div>
          <div class="flex gap-2 flex-wrap">
            ${topMonths.map(m => `
              <div class="bg-slate-800 rounded-lg px-3 py-2 text-xs">
                <span class="text-white">${m.month.trim()}</span>
                <span class="text-slate-500 ml-1">${m.count} bilder</span>
              </div>`).join('')}
          </div>
        </div>` : ''}

        ${topPlaces.length ? `
        <!-- Platser -->
        <div>
          <div class="text-xs font-medium text-slate-400 mb-2">Vanligaste platser</div>
          <div class="space-y-1">
            ${topPlaces.map(pl => `
              <div class="flex justify-between text-xs">
                <span class="text-slate-300 truncate">${pl.location_label}</span>
                <span class="text-slate-500 ml-2 flex-shrink-0">${pl.count} bilder</span>
              </div>`).join('')}
          </div>
        </div>` : ''}
      </div>`;
  } catch (e) { container.innerHTML = `<div class="text-red-400 text-sm p-2">${e.message}</div>`; }
}

// ── Dubblettpersoner-modal ────────────────────────────────────────────────────

async function showDuplicatePersonsModal() {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm';
  overlay.innerHTML = `
    <div class="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-base font-semibold text-white">Möjliga dubblettpersoner</h3>
        <button id="dupe-close" class="text-slate-400 hover:text-white text-lg leading-none">✕</button>
      </div>
      <div id="dupe-content" class="overflow-y-auto flex-1 text-slate-400 text-sm">Söker…</div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#dupe-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) overlay.remove(); });

  const content = overlay.querySelector('#dupe-content');
  try {
    const { data: pairs } = await api.personsDuplicates();
    if (!pairs.length) {
      content.innerHTML = '<div class="text-slate-400">Inga möjliga dubbletter hittades.</div>';
      return;
    }
    content.innerHTML = `<div class="space-y-4">${pairs.map((pair, i) => `
      <div class="bg-slate-900 rounded-xl p-3 border border-slate-700" data-pair="${i}">
        <div class="text-xs text-slate-400 mb-2">Likhet: ${Math.round(pair.similarity * 100)}%</div>
        <div class="flex gap-4 items-start mb-3">
          ${[pair.personA, pair.personB].map(p => {
            const faceId = p.cover_face_id ?? p.fallback_face_id;
            return `<div class="flex items-center gap-2 flex-1">
              <div class="w-12 h-12 rounded-full overflow-hidden bg-slate-700 flex-shrink-0">
                ${faceId ? `<img src="/api/faces/${faceId}/thumb" class="w-full h-full object-cover" onerror="this.style.display='none'">` : '<div class="w-full h-full flex items-center justify-center text-xl">👤</div>'}
              </div>
              <div>
                <div class="text-sm text-white font-medium">${p.name}</div>
                <div class="text-xs text-slate-500">${p.face_count} ansikten</div>
              </div>
            </div>`;
          }).join('')}
        </div>
        <button class="merge-dupe-btn w-full py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          data-a="${pair.personA.id}" data-b="${pair.personB.id}" data-aname="${pair.personA.name}" data-bname="${pair.personB.name}">
          Slå ihop
        </button>
      </div>`).join('')}</div>`;

    content.querySelectorAll('.merge-dupe-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const keepId = btn.dataset.a;
        const removeId = btn.dataset.b;
        try {
          await api.mergePeople({ personIds: [keepId, removeId], keepId });
          toast(`${btn.dataset.aname} och ${btn.dataset.bname} slogs ihop`, 'success');
          btn.closest('[data-pair]').remove();
          if (!content.querySelector('[data-pair]')) {
            content.innerHTML = '<div class="text-slate-400">Inga fler dubbletter.</div>';
          }
        } catch (e) { toast(e.message, 'error'); }
      });
    });
  } catch (e) { content.innerHTML = `<div class="text-red-400">${e.message}</div>`; }
}

// ── Ansikte-sökning via uppladdad bild ───────────────────────────────────────

function showFaceSearchModal() {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm';
  overlay.innerHTML = `
    <div class="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-base font-semibold text-white">Sök person via bild</h3>
        <button id="fs-close" class="text-slate-400 hover:text-white text-lg leading-none">✕</button>
      </div>
      <div class="mb-4">
        <label class="block text-xs text-slate-400 mb-2">Ladda upp ett foto med ansiktet du vill söka efter</label>
        <input id="fs-file" type="file" accept="image/*"
          class="w-full text-sm text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-slate-700 file:text-white hover:file:bg-slate-600 cursor-pointer">
      </div>
      <button id="fs-search" class="mb-4 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">Sök</button>
      <div id="fs-results" class="overflow-y-auto flex-1"></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#fs-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#fs-search').addEventListener('click', async () => {
    const file = overlay.querySelector('#fs-file').files[0];
    if (!file) { toast('Välj en bild', 'error'); return; }
    const results = overlay.querySelector('#fs-results');
    results.innerHTML = '<div class="text-slate-400 text-sm">Analyserar…</div>';
    try {
      const fd = new FormData();
      fd.append('image', file);
      const { data } = await api.faceSearchByImage(fd);
      if (!data.length) {
        results.innerHTML = '<div class="text-slate-400 text-sm">Inga matchande personer hittades.</div>';
        return;
      }
      results.innerHTML = data.map(result => `
        <div class="mb-4">
          <div class="text-xs text-slate-500 mb-2">Matchningar för detta ansikte:</div>
          <div class="space-y-2">
            ${result.matches.map(m => {
              const faceId = m.cover_face_id ?? m.fallback_face_id;
              return `<div class="flex items-center gap-3 bg-slate-900 rounded-lg p-2 cursor-pointer hover:bg-slate-700 transition-colors" onclick="overlay.remove();location.hash='#/faces/${m.id}'">
                <div class="w-10 h-10 rounded-full overflow-hidden bg-slate-700 flex-shrink-0">
                  ${faceId ? `<img src="/api/faces/${faceId}/thumb" class="w-full h-full object-cover">` : '<div class="w-full h-full flex items-center justify-center">👤</div>'}
                </div>
                <div class="flex-1">
                  <div class="text-sm text-white">${m.name}</div>
                  ${m.birth_year ? `<div class="text-xs text-slate-500">f. ${m.birth_year}</div>` : ''}
                </div>
                <div class="text-xs font-medium ${m.similarity >= 0.8 ? 'text-green-400' : m.similarity >= 0.65 ? 'text-yellow-400' : 'text-orange-400'}">${Math.round(m.similarity * 100)}%</div>
              </div>`;
            }).join('')}
          </div>
        </div>`).join('');
    } catch (e) { results.innerHTML = `<div class="text-red-400 text-sm">${e.message}</div>`; }
  });
}

// ── Relationer-flik ───────────────────────────────────────────────────────────

const RELATION_LABELS = {
  parent:  'Förälder',
  child:   'Barn',
  sibling: 'Syskon',
  partner: 'Partner',
  other:   'Annan relation',
};

async function renderRelationsTab(container, personId) {
  container.innerHTML = '<div class="text-slate-400 text-sm p-2">Laddar relationer…</div>';
  try {
    const { data: relations } = await api.personRelations(personId);
    const reload = () => renderRelationsTab(container, personId);

    const grouped = {};
    for (const r of relations) {
      const key = r.relation;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(r);
    }

    container.innerHTML = `
      <div class="space-y-4 pb-4">
        ${Object.entries(grouped).map(([rel, rels]) => `
          <div>
            <div class="text-xs font-medium text-slate-400 mb-2">${RELATION_LABELS[rel] ?? rel}</div>
            <div class="space-y-2">
              ${rels.map(r => {
                const faceId = r.cover_face_id ?? r.fallback_face_id;
                return `<div class="flex items-center gap-3 bg-slate-800 rounded-xl p-3">
                  <div class="w-10 h-10 rounded-full overflow-hidden bg-slate-700 flex-shrink-0 cursor-pointer"
                    onclick="location.hash='#/faces/${r.other_id}'">
                    ${faceId ? `<img src="/api/faces/${faceId}/thumb" class="w-full h-full object-cover">` : '<div class="w-full h-full flex items-center justify-center text-xl">👤</div>'}
                  </div>
                  <div class="flex-1 cursor-pointer" onclick="location.hash='#/faces/${r.other_id}'">
                    <div class="text-sm text-white">${r.other_name}</div>
                    ${r.label ? `<div class="text-xs text-slate-400">${r.label}</div>` : ''}
                    ${r.other_birth_year ? `<div class="text-xs text-slate-500">f. ${r.other_birth_year}</div>` : ''}
                  </div>
                  <button class="text-slate-500 hover:text-red-400 transition-colors text-sm" data-rel-id="${r.id}" title="Ta bort relation">✕</button>
                </div>`;
              }).join('')}
            </div>
          </div>`).join('')}

        ${!relations.length ? '<div class="text-slate-500 text-sm">Inga relationer tillagda ännu.</div>' : ''}

        <!-- Lägg till relation -->
        <div class="border-t border-slate-700 pt-4">
          <div class="text-xs font-medium text-slate-400 mb-2">Lägg till relation</div>
          <div class="flex gap-2 flex-wrap">
            <select id="rel-type" class="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
              ${Object.entries(RELATION_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
            </select>
            <input id="rel-label" type="text" placeholder="Etikett (valfritt, t.ex. farfar)"
              class="flex-1 min-w-[140px] bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
          </div>
          <div class="mt-2">
            <select id="rel-person" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
              <option value="">-- Välj person --</option>
              ${_allPersons.filter(p => p.id !== personId).map(p =>
                `<option value="${p.id}">${p.name}${p.birth_year ? ` (f. ${p.birth_year})` : ''}</option>`
              ).join('')}
            </select>
          </div>
          <button id="add-relation-btn" class="mt-2 w-full py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">Lägg till</button>
        </div>
      </div>`;

    container.querySelectorAll('[data-rel-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api.deleteRelation(btn.dataset.relId);
          toast('Relation borttagen', 'success');
          reload();
        } catch (e) { toast(e.message, 'error'); }
      });
    });

    container.querySelector('#add-relation-btn').addEventListener('click', async () => {
      const otherPersonId = container.querySelector('#rel-person').value;
      const relation      = container.querySelector('#rel-type').value;
      const label         = container.querySelector('#rel-label').value.trim();
      if (!otherPersonId) { toast('Välj en person', 'error'); return; }
      try {
        await api.addRelation(personId, { otherPersonId, relation, label: label || undefined });
        toast('Relation tillagd', 'success');
        reload();
      } catch (e) { toast(e.message, 'error'); }
    });
  } catch (e) { container.innerHTML = `<div class="text-red-400 text-sm p-2">${e.message}</div>`; }
}

function renderAiSuggestions(suggestions) {
  const section = document.getElementById('ai-suggestions-section');
  if (!section) return;

  // Gruppera per person
  const byPerson = {};
  for (const s of suggestions) {
    if (!byPerson[s.person_id]) {
      byPerson[s.person_id] = { name: s.suggested_person_name, faces: [] };
    }
    byPerson[s.person_id].faces.push(s);
  }

  const entries = Object.entries(byPerson);
  if (!entries.length) return;

  section.classList.remove('hidden');
  section.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <span class="text-sm font-medium text-white">🤖 AI-förslag</span>
      <button id="ai-collapse-btn" class="text-xs text-slate-400 hover:text-white">Dölj</button>
    </div>
    <div id="ai-suggestions-list" class="space-y-3"></div>`;

  const list = section.querySelector('#ai-suggestions-list');
  let collapsed = false;

  section.querySelector('#ai-collapse-btn').addEventListener('click', () => {
    collapsed = !collapsed;
    list.classList.toggle('hidden', collapsed);
    section.querySelector('#ai-collapse-btn').textContent = collapsed ? 'Visa' : 'Dölj';
  });

  entries.forEach(([personId, { name, faces }]) => {
    const card = document.createElement('div');
    card.className = 'bg-slate-800/60 border border-slate-700 rounded-xl p-3';
    const thumbs = faces.slice(0, 5).map(f =>
      `<img src="/api/faces/${f.face_id}/thumb" class="w-12 h-12 rounded-lg object-cover border border-slate-600" onerror="this.style.display='none'">`
    ).join('');
    const moreCount = faces.length > 5 ? `<div class="w-12 h-12 rounded-lg bg-slate-700 flex items-center justify-center text-xs text-slate-400">+${faces.length - 5}</div>` : '';

    card.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm text-white font-medium">${name}</span>
        <span class="text-xs text-slate-400">${faces.length} bild${faces.length === 1 ? '' : 'er'}</span>
      </div>
      <div class="flex gap-1.5 mb-3 flex-wrap">${thumbs}${moreCount}</div>
      <div class="flex gap-2">
        <button class="ai-accept-all flex-1 py-1.5 text-xs font-medium bg-green-700 hover:bg-green-600 text-white rounded-lg transition-colors">✓ Bekräfta alla</button>
        <button class="ai-reject-all flex-1 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-lg transition-colors">✕ Avvisa alla</button>
      </div>`;

    card.querySelector('.ai-accept-all').addEventListener('click', async () => {
      try {
        await api.batchAcceptAi(faces.map(f => f.face_id));
        toast(`Bekräftade ${faces.length} bilder för ${name}`, 'success');
        card.remove();
        if (!list.children.length) section.classList.add('hidden');
      } catch (e) { toast(e.message, 'error'); }
    });

    card.querySelector('.ai-reject-all').addEventListener('click', async () => {
      try {
        for (const f of faces) await api.rejectAi(f.face_id, {});
        toast('Avvisade förslag', 'success');
        card.remove();
        if (!list.children.length) section.classList.add('hidden');
      } catch (e) { toast(e.message, 'error'); }
    });

    list.appendChild(card);
  });
}

function updateMergeBtn() {
  const btn = document.getElementById('do-merge-btn');
  if (!btn) return;
  const enabled = _selectedIds.size >= 2;
  btn.dataset.disabled = enabled ? 'false' : 'true';
  btn.className = `px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg transition-colors ${enabled ? 'hover:bg-blue-500' : 'opacity-40 pointer-events-none'}`;
  document.getElementById('merge-count').textContent = `${_selectedIds.size} valda`;
}

function renderPersonGrid(persons, mergeMode) {
  const grid = document.getElementById('persons-grid');
  if (!grid) return;

  if (!persons?.length) {
    grid.innerHTML = '<div class="col-span-full text-slate-400 text-sm">Inga namngivna ansikten ännu.</div>';
    return;
  }

  grid.innerHTML = persons.map((p) => {
    const sel = _selectedIds.has(p.id);
    const src = coverSrc(p);
    return `
      <div class="cursor-pointer group text-center relative select-none" data-person-id="${p.id}">
        ${mergeMode ? `
          <div class="absolute top-0 right-2 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors
            ${sel ? 'bg-blue-500 border-blue-500 text-white' : 'bg-black/60 border-slate-400 text-transparent'}">✓</div>` : ''}
        <div class="w-24 h-24 mx-auto rounded-full overflow-hidden bg-slate-700 mb-2 border-2 transition-colors
          ${sel ? 'border-blue-500' : 'border-slate-600 group-hover:border-blue-500'}">
          ${src ? `<img src="${src}" class="w-full h-full object-cover" onerror="this.outerHTML='<div class=\\'w-full h-full flex items-center justify-center text-3xl\\'>👤</div>'">` : '<div class="w-full h-full flex items-center justify-center text-3xl">👤</div>'}
        </div>
        <div class="text-sm font-medium text-white truncate">${p.name}</div>
        <div class="text-xs text-slate-400">${p.photo_count} bilder${p.birth_year ? ` · f. ${p.birth_year}` : ''}</div>
      </div>`;
  }).join('');

  grid.querySelectorAll('[data-person-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const pid = el.dataset.personId;
      if (mergeMode) {
        if (_selectedIds.has(pid)) _selectedIds.delete(pid);
        else _selectedIds.add(pid);
        updateMergeBtn();
        // Uppdatera visuell state på cellen
        const sel = _selectedIds.has(pid);
        el.querySelector('.rounded-full.border-2.overflow-hidden').className =
          `w-24 h-24 mx-auto rounded-full overflow-hidden bg-slate-700 mb-2 border-2 transition-colors ${sel ? 'border-blue-500' : 'border-slate-600 group-hover:border-blue-500'}`;
        const check = el.querySelector('.absolute');
        if (check) check.className = `absolute top-0 right-2 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors ${sel ? 'bg-blue-500 border-blue-500 text-white' : 'bg-black/60 border-slate-400 text-transparent'}`;
      } else {
        location.hash = `#/faces/${pid}`;
      }
    });
  });
}

// ── Person Detail ─────────────────────────────────────────────────────────────

async function renderPersonDetail(container, personId) {
  container.innerHTML = `
    <div class="p-4 h-full flex flex-col">
      <button onclick="location.hash='#/faces'" class="text-slate-400 hover:text-white text-sm mb-4 flex items-center gap-1">← Alla ansikten</button>
      <div id="person-header" class="flex items-center gap-4 mb-5"></div>
      <div class="flex gap-4 border-b border-slate-700 mb-4 flex-wrap" id="person-tabs">
        <button data-tab="photos"   class="tab-btn pb-2 text-sm font-medium text-white border-b-2 border-blue-500">Foton</button>
        <button data-tab="timeline" class="tab-btn pb-2 text-sm font-medium text-slate-400 border-b-2 border-transparent hover:text-white">Livslinje</button>
        <button data-tab="map"      class="tab-btn pb-2 text-sm font-medium text-slate-400 border-b-2 border-transparent hover:text-white">Karta</button>
        <button data-tab="stats"     class="tab-btn pb-2 text-sm font-medium text-slate-400 border-b-2 border-transparent hover:text-white">Statistik</button>
        <button data-tab="relations" class="tab-btn pb-2 text-sm font-medium text-slate-400 border-b-2 border-transparent hover:text-white">Relationer</button>
      </div>
      <div id="person-content" class="flex-1 overflow-auto"></div>
    </div>`;

  let person = null;
  let assets = [];

  try {
    let allAssets = [];
    let cursor = null;
    do {
      const params = { limit: 200 };
      if (cursor) params.cursor = cursor;
      const { data, meta } = await api.person(personId, params);
      person = data.person;
      allAssets = allAssets.concat(data.assets);
      cursor = meta.hasMore ? meta.nextCursor : null;
    } while (cursor);
    assets = allAssets;
  } catch (e) {
    toast(e.message, 'error');
    return;
  }

  const updateHeader = () => {
    const src = coverSrc(person);
    const ageLabel = personAgeLabel(person);
    document.getElementById('person-header').innerHTML = `
      <div class="w-20 h-20 rounded-full overflow-hidden bg-slate-700 flex-shrink-0 border-2 border-slate-600">
        ${src ? `<img src="${src}" class="w-full h-full object-cover" onerror="this.outerHTML='<div class=\\'w-full h-full flex items-center justify-center text-4xl\\'>👤</div>'">` : '<div class="w-full h-full flex items-center justify-center text-4xl">👤</div>'}
      </div>
      <div>
        <div class="text-xl font-semibold text-white">${person.name}</div>
        <div class="text-sm text-slate-400">${assets.length} bilder${ageLabel ? ` · ${ageLabel}` : ''}</div>
        <div class="flex gap-3 mt-1 flex-wrap">
          <button id="edit-person-btn" class="text-blue-400 hover:text-blue-300 text-sm">Redigera</button>
          <a id="export-person-btn" href="${api.personsExport(personId)}" download
            class="text-slate-400 hover:text-white text-sm">⬇ Exportera JSON</a>
        </div>
      </div>`;

    document.getElementById('edit-person-btn').addEventListener('click', () => {
      showEditPersonModal(person, async ({ name, birthYear, deathYear }) => {
        try {
          await api.patchPerson(personId, { name, birthYear, deathYear });
          person.name       = name;
          person.birth_year = birthYear;
          person.death_year = deathYear;
          updateHeader();
          toast('Sparat', 'success');
        } catch (e) { toast(e.message, 'error'); }
      });
    });
  };
  updateHeader();

  let activeTab = 'photos';
  const renderTab = (tab) => {
    activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      const active = btn.dataset.tab === tab;
      btn.className = `tab-btn pb-2 text-sm font-medium border-b-2 transition-colors ${active ? 'text-white border-blue-500' : 'text-slate-400 border-transparent hover:text-white'}`;
    });
    const content = document.getElementById('person-content');
    if (tab === 'photos')   renderPhotosTab(content, assets, person, personId, updateHeader);
    if (tab === 'timeline') renderTimelineTab(content, assets, person);
    if (tab === 'map')      renderMapTab(content, assets);
    if (tab === 'stats')     renderStatsTab(content, personId, person);
    if (tab === 'relations') renderRelationsTab(content, personId);
  };

  document.getElementById('person-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (btn) renderTab(btn.dataset.tab);
  });

  renderTab('photos');
}

// ── Foton-flik ────────────────────────────────────────────────────────────────

function renderPhotosTab(container, assets, person, personId, onCoverUpdated) {
  if (!assets.length) {
    container.innerHTML = '<div class="text-slate-400 text-sm p-2">Inga bilder.</div>';
    return;
  }
  container.innerHTML = `<div id="photo-grid" class="grid gap-0.5" style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))"></div>`;

  const grid = document.getElementById('photo-grid');
  assets.forEach((asset, i) => {
    const cell = document.createElement('div');
    cell.className = 'photo-cell relative group cursor-pointer';
    const age = ageAtPhoto(person.birth_year, asset.taken_at);
    cell.innerHTML = `
      ${asset.thumb_small_path
        ? `<img src="/thumbs/${asset.thumb_small_path}" loading="lazy" class="w-full aspect-square object-cover">`
        : `<div class="w-full aspect-square bg-slate-700"></div>`}
      ${age !== null ? `<div class="absolute bottom-0 left-0 right-0 bg-black/60 text-xs text-white text-center py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">${age} år</div>` : ''}`;

    attachFavHeart(cell, asset);
    cell.addEventListener('click', () => openLightbox(assets, i));
    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showPhotoContextMenu(e, asset, personId, (newCoverFaceId) => {
        if (newCoverFaceId) person.cover_face_id = newCoverFaceId;
        onCoverUpdated();
      });
    });
    grid.appendChild(cell);
  });
}

function showPhotoContextMenu(e, asset, personId, onCoverSet) {
  document.querySelectorAll('.photo-ctx-menu').forEach((m) => m.remove());
  const menu = document.createElement('div');
  menu.className = 'photo-ctx-menu fixed z-[400] bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-1 text-sm';
  menu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
  menu.style.top  = `${Math.min(e.clientY, window.innerHeight - 80)}px`;
  menu.innerHTML = `<button class="w-full text-left px-4 py-2 hover:bg-slate-700 text-white">Sätt som profilbild</button>`;
  document.body.appendChild(menu);

  menu.querySelector('button').addEventListener('click', async () => {
    menu.remove();
    try {
      const { data: faces } = await api.faces(asset.id);
      const face = faces.find((f) => f.person_id);
      if (!face) { toast('Inget ansikte hittat på bilden', 'error'); return; }
      await api.patchPerson(personId, { coverFaceId: face.id });
      toast('Profilbild uppdaterad', 'success');
      onCoverSet(face.id);
    } catch (err) { toast(err.message, 'error'); }
  });

  const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
  setTimeout(() => document.addEventListener('mousedown', close), 0);
}

// ── Livslinje-flik ────────────────────────────────────────────────────────────

function renderTimelineTab(container, assets, person) {
  container.innerHTML = `<div id="timeline-content" class="space-y-6 pb-4"></div>`;
  const tc = document.getElementById('timeline-content');

  // Gruppera foton per år
  const byYear = {};
  assets.forEach((a, i) => {
    if (!a.taken_at) return;
    const year = new Date(a.taken_at).getFullYear();
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push({ ...a, _idx: i });
  });

  const photoYears = Object.keys(byYear).map(Number).sort((a, b) => b - a);

  // Dödsdatum-markör högst upp
  if (person.death_year) {
    const el = document.createElement('div');
    el.innerHTML = `
      <div class="flex items-center gap-3 text-slate-300">
        <div class="text-lg">✝</div>
        <div class="font-semibold">Avliden ${person.death_year}</div>
      </div>`;
    tc.appendChild(el);
  }

  if (!photoYears.length) {
    const el = document.createElement('div');
    el.innerHTML = `<div class="text-slate-400 text-sm">Inga bilder med datuminformation.</div>`;
    tc.appendChild(el);
  }

  photoYears.forEach((year) => {
    const yearAssets = byYear[year];
    const age = person.birth_year ? year - person.birth_year : null;

    const section = document.createElement('div');
    section.innerHTML = `
      <div class="flex items-center gap-3 mb-2">
        <div class="text-base font-semibold text-white">${year}${age !== null && age >= 0 ? ` · ${age} år` : ''}</div>
        <div class="text-xs text-slate-500">${yearAssets.length} bilder</div>
      </div>`;

    const tlGrid = document.createElement('div');
    tlGrid.className = 'grid gap-0.5 mb-4';
    tlGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(120px, 1fr))';
    yearAssets.forEach((a) => {
      const cell = buildPhotoCell(a, () => openLightbox(assets, a._idx));
      tlGrid.appendChild(cell);
    });
    section.appendChild(tlGrid);
    tc.appendChild(section);
  });

  // Födelseår-markör längst ned
  if (person.birth_year) {
    const oldestPhotoYear = photoYears.length ? Math.min(...photoYears) : Infinity;
    if (person.birth_year < oldestPhotoYear) {
      const el = document.createElement('div');
      el.innerHTML = `
        <div class="flex items-center gap-3 text-slate-300 border-t border-slate-700 pt-4 mt-2">
          <div class="text-lg">📅</div>
          <div class="font-semibold">Född ${person.birth_year}</div>
        </div>`;
      tc.appendChild(el);
    }
  }

  if (!person.birth_year && !photoYears.length) {
    tc.innerHTML = '<div class="text-slate-400 text-sm">Inga bilder och inget födelseår angivet.</div>';
  }
}

// ── Karta-flik ────────────────────────────────────────────────────────────────

function renderMapTab(container, assets) {
  const withGps = assets.filter((a) => a.lat != null && a.lon != null);

  if (!withGps.length) {
    container.innerHTML = '<div class="text-slate-400 text-sm p-4">Inga bilder med GPS-koordinater.</div>';
    return;
  }

  container.innerHTML = `<div id="person-map" class="w-full rounded-xl overflow-hidden" style="height:480px"></div>`;

  if (!window.L) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => initPersonMap(withGps, assets);
    document.head.appendChild(script);
  } else {
    initPersonMap(withGps, assets);
  }
}

function initPersonMap(withGps, allAssets) {
  const el = document.getElementById('person-map');
  if (!el || !window.L) return;

  const lats = withGps.map((a) => a.lat);
  const lons = withGps.map((a) => a.lon);
  const map = L.map('person-map').setView(
    [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2], 7
  );
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
  }).addTo(map);

  withGps.forEach((a) => {
    const idx = allAssets.indexOf(a);
    const marker = L.marker([a.lat, a.lon]).addTo(map);

    const popupHtml = `
      <div style="text-align:center;min-width:100px">
        ${a.thumb_small_path ? `<img src="/thumbs/${a.thumb_small_path}" style="width:90px;height:90px;object-fit:cover;border-radius:6px;margin-bottom:6px;display:block;margin-inline:auto">` : ''}
        <div style="font-size:11px;color:#94a3b8;margin-bottom:6px">${a.taken_at ? new Date(a.taken_at).toLocaleDateString('sv-SE') : ''}</div>
        <button class="open-lb-btn" style="background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer">Öppna bild →</button>
      </div>`;

    marker.bindPopup(popupHtml, { maxWidth: 160 });

    marker.on('popupopen', () => {
      setTimeout(() => {
        document.querySelector('.open-lb-btn')?.addEventListener('click', () => {
          map.closePopup();
          openLightbox(allAssets, idx);
        });
      }, 0);
    });
  });

  map.fitBounds(withGps.map((a) => [a.lat, a.lon]), { padding: [40, 40] });
}
