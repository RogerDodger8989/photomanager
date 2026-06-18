import { api } from '../api.js';
import { openLightbox } from '../components/lightbox.js';
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
  if (p.cover_face_id) return `/api/persons/${p.id}/face-thumb`;
  if (p.cover_thumb)   return `/thumbs/${p.cover_thumb}`;
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

async function renderPersonList(container) {
  container.innerHTML = `
    <div class="p-4">
      <div class="flex items-center gap-3 mb-3 flex-wrap">
        <h1 class="text-xl font-semibold text-white">Ansikten</h1>
        <div class="flex-1 min-w-[180px]">
          <input id="person-search" type="text" placeholder="Sök person…"
            class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500">
        </div>
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

      <div id="ai-suggestion-banner" class="hidden mb-4 bg-blue-900/40 border border-blue-700 rounded-xl p-3 text-sm text-blue-300 flex items-center justify-between">
        <span>🤖 AI har nya personförslag att granska</span>
        <a href="#/admin/ai" class="underline hover:text-white">Granska →</a>
      </div>
      <div id="persons-grid" class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(130px, 1fr))">
        <div class="col-span-full text-slate-400 text-sm">Laddar…</div>
      </div>
    </div>`;

  try {
    const { data: aiStatus } = await api.aiStatus();
    if (aiStatus.available) {
      const { meta } = await api.aiSuggestions({ limit: 1 });
      if (meta.total > 0) {
        document.getElementById('ai-suggestion-banner').classList.remove('hidden');
        document.querySelector('#ai-suggestion-banner span').textContent =
          `🤖 AI har ${meta.total} personförslag att granska`;
      }
    }
  } catch {}

  try {
    const { data } = await api.persons();
    _allPersons = data ?? [];
    _selectedIds.clear();
    renderPersonGrid(_allPersons, false);
  } catch (e) { toast(e.message, 'error'); }

  document.getElementById('person-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = q ? _allPersons.filter((p) => p.name.toLowerCase().includes(q)) : _allPersons;
    const merging = !document.getElementById('merge-toolbar').classList.contains('hidden');
    renderPersonGrid(filtered, merging);
  });

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
    const selected = _allPersons.filter((p) => _selectedIds.has(p.id));
    showMergeModal(selected, async ({ keepId, newName }) => {
      try {
        await api.mergePeople({ personIds: [..._selectedIds], keepId, newName: newName || undefined });
        toast('Sammanslagning klar', 'success');
        _selectedIds.clear();
        const { data } = await api.persons();
        _allPersons = data ?? [];
        document.getElementById('merge-toolbar').classList.add('hidden');
        document.getElementById('merge-mode-btn').classList.remove('hidden');
        renderPersonGrid(_allPersons, false);
      } catch (e) { toast(e.message, 'error'); }
    });
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
          ${src ? `<img src="${src}" class="w-full h-full object-cover">` : '<div class="w-full h-full flex items-center justify-center text-3xl">👤</div>'}
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
      <div class="flex gap-4 border-b border-slate-700 mb-4" id="person-tabs">
        <button data-tab="photos"   class="tab-btn pb-2 text-sm font-medium text-white border-b-2 border-blue-500">Foton</button>
        <button data-tab="timeline" class="tab-btn pb-2 text-sm font-medium text-slate-400 border-b-2 border-transparent hover:text-white">Livslinje</button>
        <button data-tab="map"      class="tab-btn pb-2 text-sm font-medium text-slate-400 border-b-2 border-transparent hover:text-white">Karta</button>
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
        ${src ? `<img src="${src}" class="w-full h-full object-cover">` : '<div class="w-full h-full flex items-center justify-center text-4xl">👤</div>'}
      </div>
      <div>
        <div class="text-xl font-semibold text-white">${person.name}</div>
        <div class="text-sm text-slate-400">${assets.length} bilder${ageLabel ? ` · ${ageLabel}` : ''}</div>
        <button id="edit-person-btn" class="text-blue-400 hover:text-blue-300 text-sm mt-1">Redigera</button>
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
      <img src="/thumbs/${asset.thumb_small_path}" loading="lazy" class="w-full aspect-square object-cover">
      ${age !== null ? `<div class="absolute bottom-0 left-0 right-0 bg-black/60 text-xs text-white text-center py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">${age} år</div>` : ''}`;

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
      </div>
      <div class="grid gap-0.5" style="grid-template-columns: repeat(auto-fill, minmax(120px, 1fr))">
        ${yearAssets.map((a) => `
          <div class="photo-cell cursor-pointer" data-idx="${a._idx}">
            <img src="/thumbs/${a.thumb_small_path}" loading="lazy" class="w-full aspect-square object-cover">
          </div>`).join('')}
      </div>`;

    section.querySelectorAll('[data-idx]').forEach((el) => {
      el.addEventListener('click', () => openLightbox(assets, +el.dataset.idx));
    });
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
