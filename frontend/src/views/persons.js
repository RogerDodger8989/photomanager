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

// Modulnivå-state för åternavigering efter lightbox
let _unknownFacesState = { lastClusterId: null, scrollY: 0 };
// Temporärt dolda kluster (Hoppa över) — nollställs vid ny sidinladdning
const _skippedClusterKeys = new Set();
// Aktuell sortering
let _ufSort = 'size'; // 'size' | 'date'

function injectUnknownFacesStyles() {
  if (document.getElementById('uf-styles')) return;
  const style = document.createElement('style');
  style.id = 'uf-styles';
  style.textContent = `
    .uf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:1rem;padding-bottom:2rem}
    .uf-card{background:#1e293b;border:1px solid #334155;border-radius:.75rem;display:flex;flex-direction:column;gap:.4rem;padding:.5rem;transition:box-shadow .2s,opacity .3s;position:relative}
    .uf-card:focus-within{box-shadow:0 0 0 2px #3b82f6}
    .uf-card--drag-over{box-shadow:0 0 0 3px #a78bfa!important;background:#312e81}
    .uf-card--highlight{animation:uf-highlight 1.8s ease-out}
    @keyframes uf-highlight{0%{box-shadow:0 0 0 3px #f59e0b}100%{box-shadow:none}}
    .uf-card--fade-out{opacity:0;pointer-events:none}
    .uf-face-primary{position:relative;width:100%;aspect-ratio:1;border-radius:.5rem;overflow:hidden;background:#0f172a}
    .uf-thumb{width:100%;height:100%;object-fit:cover;display:block}
    .uf-expand-badge{position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,.65);color:#fff;font-size:.65rem;font-weight:600;padding:1px 5px;border-radius:9999px;cursor:pointer;border:1px solid rgba(255,255,255,.2);line-height:1.5;transition:background .15s}
    .uf-expand-badge:hover{background:#3b82f6}
    .uf-card-actions{position:absolute;top:6px;left:6px;display:flex;gap:4px;opacity:0;transition:opacity .15s;z-index:10}
    .uf-card:hover .uf-card-actions{opacity:1}
    .uf-action-btn{width:22px;height:22px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:700;line-height:1;transition:transform .1s}
    .uf-action-btn:hover{transform:scale(1.15)}
    .uf-dismiss-btn{background:rgba(239,68,68,.8);color:#fff}
    .uf-dismiss-btn:hover{background:#ef4444}
    .uf-skip-btn{background:rgba(100,116,139,.8);color:#fff}
    .uf-skip-btn:hover{background:#64748b}
    .uf-extra-faces{display:flex;flex-wrap:wrap;gap:3px;max-height:0;overflow:hidden;transition:max-height .3s ease}
    .uf-extra-faces.uf-expanded{max-height:600px}
    .uf-thumb-sm{width:46px;height:46px;object-fit:cover;border-radius:5px;cursor:grab}
    .uf-filename{font-size:.68rem;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;width:100%;cursor:pointer;background:none;border:none;padding:0 2px;transition:color .15s}
    .uf-filename:hover{color:#60a5fa;text-decoration:underline}
    .uf-assign-wrap{position:relative}
    .uf-assign-input{width:100%;background:#0f172a;border:1px solid #334155;border-radius:.45rem;padding:4px 8px;font-size:.72rem;color:#f1f5f9;outline:none;box-sizing:border-box;transition:border-color .15s}
    .uf-assign-input:focus{border-color:#3b82f6}
    .uf-autocomplete{background:#1e293b;border:1px solid #475569;border-radius:.5rem;max-height:200px;overflow-y:auto;z-index:9999;list-style:none;margin:0;padding:2px 0;box-shadow:0 8px 24px rgba(0,0,0,.7)}
    .uf-ac-item{padding:5px 8px;font-size:.72rem;color:#e2e8f0;cursor:pointer;display:flex;align-items:center;gap:6px}
    .uf-ac-item:hover,.uf-ac-item.uf-ac-active{background:#334155}
    .uf-ac-avatar{width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0;background:#334155}
    .uf-ac-create{padding:5px 8px;font-size:.72rem;color:#4ade80;cursor:pointer;border-top:1px solid #334155;font-weight:500}
    .uf-ac-create:hover,.uf-ac-create.uf-ac-active{background:#334155}
    .uf-toolbar{display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem;flex-wrap:wrap}
    .uf-sort-btn{padding:3px 10px;font-size:.7rem;border-radius:9999px;border:1px solid #475569;background:transparent;color:#94a3b8;cursor:pointer;transition:all .15s}
    .uf-sort-btn.uf-sort-active{background:#3b82f6;border-color:#3b82f6;color:#fff}
    .uf-show-skipped{font-size:.7rem;color:#64748b;cursor:pointer;margin-left:auto;text-decoration:underline}
    .uf-show-skipped:hover{color:#94a3b8}
  `;
  document.head.appendChild(style);
}

function buildAssignWidget(faceIds, allPersons, onAssigned) {
  const wrap = document.createElement('div');
  wrap.className = 'uf-assign-wrap';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'uf-assign-input';
  input.placeholder = 'Vem är det här?';
  input.autocomplete = 'off';
  input.spellcheck = false;

  // Dropdown renderas i body för att undvika clipping från föräldra-element
  const dropdown = document.createElement('ul');
  dropdown.className = 'uf-autocomplete';
  dropdown.hidden = true;
  document.body.appendChild(dropdown);

  wrap.appendChild(input);

  let debounceTimer = null;
  let activeIndex = -1;

  const positionDropdown = () => {
    const rect = input.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom + 2}px`;
    dropdown.style.width = `${rect.width}px`;
  };

  const closeDropdown = () => { dropdown.hidden = true; activeIndex = -1; };

  const openDropdown = (matches) => {
    dropdown.innerHTML = '';
    activeIndex = -1;

    matches.slice(0, 8).forEach(person => {
      const li = document.createElement('li');
      li.className = 'uf-ac-item';
      li.dataset.personId = person.id;

      const faceId = person.cover_face_id ?? person.fallback_face_id;
      if (faceId) {
        const av = document.createElement('img');
        av.className = 'uf-ac-avatar';
        av.src = `/api/faces/${faceId}/thumb`;
        av.alt = '';
        li.appendChild(av);
      }
      li.appendChild(document.createTextNode(person.name));

      li.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        closeDropdown();
        input.value = '';
        try {
          await api.assignFaces({ faceIds, personId: String(person.id) });
          toast(`Tilldelad ${person.name}`, 'success');
          onAssigned();
        } catch (err) { toast(err.message, 'error'); }
      });
      dropdown.appendChild(li);
    });

    const createLi = document.createElement('li');
    createLi.className = 'uf-ac-create';
    createLi.textContent = '+ Skapa ny person';
    createLi.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const typedName = input.value.trim();
      closeDropdown();
      input.value = '';
      showSimpleCreatePersonModal(faceIds, typedName, onAssigned, allPersons);
    });
    dropdown.appendChild(createLi);

    positionDropdown();
    dropdown.hidden = false;
  };

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const q = input.value.trim().toLowerCase();
      if (!q) { closeDropdown(); return; }
      const matches = allPersons.filter(p => p.name.toLowerCase().includes(q));
      openDropdown(matches);
    }, 120);
  });

  input.addEventListener('keydown', (e) => {
    if (dropdown.hidden) {
      if (e.key === 'Enter') {
        const q = input.value.trim();
        if (q) showSimpleCreatePersonModal(faceIds, q, onAssigned, allPersons);
      }
      return;
    }
    const items = dropdown.querySelectorAll('.uf-ac-item, .uf-ac-create');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('uf-ac-active', i === activeIndex));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      items.forEach((el, i) => el.classList.toggle('uf-ac-active', i === activeIndex));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && items[activeIndex]) {
        items[activeIndex].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  });

  input.addEventListener('focus', positionDropdown);
  input.addEventListener('blur', () => { setTimeout(closeDropdown, 160); });

  // Städa upp dropdown från body när kortet tas bort
  const observer = new MutationObserver(() => {
    if (!document.body.contains(wrap)) { dropdown.remove(); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return wrap;
}

function showSimpleCreatePersonModal(faceIds, prefillName, onDone, allPersons) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[400] flex items-center justify-center bg-black/60 backdrop-blur-sm';

  const safeName = (prefillName ?? '').replace(/"/g, '&quot;');
  overlay.innerHTML = `
    <div class="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-80 p-6">
      <h3 class="text-sm font-semibold text-white mb-4">Skapa ny person</h3>
      <label class="text-xs text-slate-400 mb-1 block">Namn</label>
      <input id="scp-name" type="text" placeholder="Namn" value="${safeName}"
        class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 mb-3">
      <div class="flex gap-2 mb-5">
        <div class="flex-1">
          <label class="text-xs text-slate-400 mb-1 block">Födelseår</label>
          <input id="scp-birth" type="number" min="1900" max="2099" placeholder="t.ex. 1985"
            class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
        </div>
        <div class="flex-1">
          <label class="text-xs text-slate-400 mb-1 block">Dödsår</label>
          <input id="scp-death" type="number" min="1900" max="2099" placeholder="t.ex. 2020"
            class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
        </div>
      </div>
      <div class="flex gap-2 justify-end">
        <button id="scp-cancel" class="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition-colors">Avbryt</button>
        <button id="scp-ok" class="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">OK</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  const nameInput = overlay.querySelector('#scp-name');
  const birthInput = overlay.querySelector('#scp-birth');
  const deathInput = overlay.querySelector('#scp-death');
  nameInput.focus();
  nameInput.select();

  const doCancel = () => overlay.remove();
  const doOk = async () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    const birthYear = birthInput.value ? parseInt(birthInput.value, 10) : null;
    const deathYear = deathInput.value ? parseInt(deathInput.value, 10) : null;
    overlay.remove();
    try {
      const { data } = await api.assignFaces({ faceIds, personName: name, birthYear, deathYear });
      if (data?.personId && !allPersons.find(p => p.id === data.personId)) {
        allPersons.push({ id: data.personId, name, cover_face_id: null, fallback_face_id: null });
      }
      toast(`Person "${name}" skapad`, 'success');
      onDone();
    } catch (e) { toast(e.message, 'error'); }
  };

  overlay.querySelector('#scp-ok').addEventListener('click', doOk);
  overlay.querySelector('#scp-cancel').addEventListener('click', doCancel);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) doCancel(); });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doOk();
    if (e.key === 'Escape') doCancel();
  });
}

function buildClusterCard(cluster, allPersons, onAssigned, onSkip, grid) {
  const primaryFace = cluster.faces[0];
  const extraFaces  = cluster.faces.slice(1);
  const faceIds     = cluster.faces.map(f => f.id);
  const clusterKey  = cluster.clusterId ?? `face-${primaryFace.id}`;

  const card = document.createElement('div');
  card.className = 'uf-card';
  card.dataset.clusterKey = clusterKey;
  card.draggable = true;

  // ── Hover-knappar (Avfärda / Hoppa över) ────────────────────────────────────
  const actions = document.createElement('div');
  actions.className = 'uf-card-actions';

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'uf-action-btn uf-dismiss-btn';
  dismissBtn.title = 'Inte ett ansikte — avfärda';
  dismissBtn.textContent = '✕';
  dismissBtn.addEventListener('click', async () => {
    if (!confirm('Markera som "inte ett ansikte" och ta bort?')) return;
    try {
      await api.dismissFaces(faceIds);
      card.classList.add('uf-card--fade-out');
      setTimeout(() => card.remove(), 300);
    } catch (e) { toast(e.message, 'error'); }
  });

  const skipBtn = document.createElement('button');
  skipBtn.className = 'uf-action-btn uf-skip-btn';
  skipBtn.title = 'Hoppa över tillfälligt';
  skipBtn.textContent = '→';
  skipBtn.addEventListener('click', () => {
    _skippedClusterKeys.add(clusterKey);
    card.classList.add('uf-card--fade-out');
    setTimeout(() => {
      card.style.display = 'none';
      card.classList.remove('uf-card--fade-out');
      onSkip();
    }, 300);
  });

  actions.appendChild(dismissBtn);
  actions.appendChild(skipBtn);
  card.appendChild(actions);

  // ── Primär ansiktsthumbnail ──────────────────────────────────────────────────
  const primaryWrap = document.createElement('div');
  primaryWrap.className = 'uf-face-primary';

  const img = document.createElement('img');
  img.src = `/api/faces/${primaryFace.id}/thumb`;
  img.className = 'uf-thumb';
  img.alt = '';
  img.onerror = () => {
    img.replaceWith(Object.assign(document.createElement('div'), {
      className: 'uf-thumb flex items-center justify-center text-3xl text-slate-500',
      textContent: '?',
    }));
  };
  primaryWrap.appendChild(img);

  // ── Expand-badge för kluster med flera ansikten ──────────────────────────────
  let extraEl = null;
  if (extraFaces.length > 0) {
    const badge = document.createElement('button');
    badge.className = 'uf-expand-badge';
    badge.textContent = `+${extraFaces.length}`;
    badge.title = 'Visa alla ansikten i gruppen';

    extraEl = document.createElement('div');
    extraEl.className = 'uf-extra-faces';
    extraEl.setAttribute('aria-hidden', 'true');

    extraFaces.forEach(face => {
      const ei = document.createElement('img');
      ei.src = `/api/faces/${face.id}/thumb`;
      ei.className = 'uf-thumb-sm';
      ei.alt = '';
      ei.title = face.file_name ?? '';
      extraEl.appendChild(ei);
    });

    badge.addEventListener('click', () => {
      const expanded = extraEl.classList.toggle('uf-expanded');
      badge.textContent = expanded ? '−' : `+${extraFaces.length}`;
      extraEl.setAttribute('aria-hidden', String(!expanded));
    });

    primaryWrap.appendChild(badge);
  }

  card.appendChild(primaryWrap);
  if (extraEl) card.appendChild(extraEl);

  // ── Filnamn (klickbart → lightbox) ──────────────────────────────────────────
  const filename = primaryFace.file_name ?? `Asset ${primaryFace.asset_id.slice(0, 8)}`;
  const filenameBtn = document.createElement('button');
  filenameBtn.className = 'uf-filename';
  filenameBtn.textContent = filename;
  filenameBtn.title = `Öppna ${filename}`;
  filenameBtn.addEventListener('click', () => {
    _unknownFacesState = { lastClusterId: clusterKey, scrollY: window.scrollY };
    const assetItem = {
      id: primaryFace.asset_id,
      mime_type: primaryFace.mime_type ?? 'image/jpeg',
      thumb_small_path: primaryFace.thumb_small_path,
      thumb_large_path: primaryFace.thumb_large_path,
      file_name: primaryFace.file_name,
    };
    openLightbox([assetItem], 0);
  });
  card.appendChild(filenameBtn);

  // ── Autocomplete-inmatning för namngivning ───────────────────────────────────
  const assignWidget = buildAssignWidget(faceIds, allPersons, () => {
    card.classList.add('uf-card--fade-out');
    setTimeout(() => { card.remove(); onAssigned(); }, 300);
  });
  card.appendChild(assignWidget);

  // ── Drag-and-drop för klustersammanslagning ──────────────────────────────────
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', clusterKey);
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    card.classList.add('uf-card--drag-over');
  });
  card.addEventListener('dragleave', () => card.classList.remove('uf-card--drag-over'));
  card.addEventListener('drop', async (e) => {
    e.preventDefault();
    card.classList.remove('uf-card--drag-over');
    const fromKey = e.dataTransfer.getData('text/plain');
    if (fromKey === clusterKey) return;

    const fromCard = grid.querySelector(`[data-cluster-key="${fromKey}"]`);
    if (!fromCard) return;

    if (!confirm('Slå ihop dessa grupper till en? (De verkar vara samma person)')) return;

    // Hämta faceIds från source-kortet
    const fromFaceIds = [...fromCard.querySelectorAll('[data-face-id]')].map(el => el.dataset.faceId);
    const allMergedFaceIds = [...faceIds, ...fromFaceIds];

    try {
      await api.mergeClusters(fromFaceIds, faceIds);
      // Flytta extra ansikten visuellt till detta korts expand-vy
      fromCard.classList.add('uf-card--fade-out');
      setTimeout(() => fromCard.remove(), 300);

      // Uppdatera badge
      if (!extraEl) {
        const newExtra = document.createElement('div');
        newExtra.className = 'uf-extra-faces';
        card.insertBefore(newExtra, filenameBtn);
        extraEl = newExtra;
        const newBadge = document.createElement('button');
        newBadge.className = 'uf-expand-badge';
        primaryWrap.appendChild(newBadge);
        newBadge.addEventListener('click', () => {
          const exp = extraEl.classList.toggle('uf-expanded');
          newBadge.textContent = exp ? '−' : `+${extraEl.children.length}`;
        });
      }
      fromFaceIds.forEach(fid => {
        const ei = document.createElement('img');
        ei.src = `/api/faces/${fid}/thumb`;
        ei.className = 'uf-thumb-sm';
        ei.alt = '';
        extraEl.appendChild(ei);
      });
      const badge = primaryWrap.querySelector('.uf-expand-badge');
      if (badge) badge.textContent = `+${extraEl.children.length}`;

      // Uppdatera assign-widget med de sammanslagna faceIds
      faceIds.length = 0;
      allMergedFaceIds.forEach(id => faceIds.push(id));
      toast('Grupper sammanslagna', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  return card;
}

function restoreUnknownFacesState(cards) {
  const { lastClusterId, scrollY } = _unknownFacesState;
  if (!lastClusterId && !scrollY) return;

  const targetCard = lastClusterId ? cards.get(lastClusterId) : null;
  if (targetCard) {
    requestAnimationFrame(() => {
      targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetCard.classList.add('uf-card--highlight');
      targetCard.addEventListener('animationend', () => {
        targetCard.classList.remove('uf-card--highlight');
      }, { once: true });
    });
  } else if (scrollY) {
    window.scrollTo({ top: scrollY });
  }
  _unknownFacesState = { lastClusterId: null, scrollY: 0 };
}

async function renderUnknownFacesTab(container, allPersons) {
  injectUnknownFacesStyles();

  container.innerHTML = `
    <div class="p-4">
      <div id="uf-meta" class="text-xs text-slate-500 mb-2"></div>
      <div id="uf-toolbar" class="uf-toolbar">
        <span class="text-xs text-slate-500">Sortera:</span>
        <button class="uf-sort-btn uf-sort-active" data-sort="size">Storlek ↓</button>
        <button class="uf-sort-btn" data-sort="date">Datum ↓</button>
        <button id="uf-show-skipped" class="uf-show-skipped hidden">Visa dolda (0)</button>
      </div>
      <div id="uf-grid" class="uf-grid"></div>
    </div>`;

  // Sätt rätt sorteringsknapp aktiv
  container.querySelectorAll('.uf-sort-btn').forEach(btn => {
    btn.classList.toggle('uf-sort-active', btn.dataset.sort === _ufSort);
    btn.addEventListener('click', () => {
      if (btn.dataset.sort === _ufSort) return;
      _ufSort = btn.dataset.sort;
      container.querySelectorAll('.uf-sort-btn').forEach(b => b.classList.toggle('uf-sort-active', b.dataset.sort === _ufSort));
      renderGrid(clusters);
    });
  });

  let clusters = [];

  const renderGrid = (clusterData) => {
    const sorted = [...clusterData].sort((a, b) => {
      if (_ufSort === 'size') return b.faces.length - a.faces.length;
      // date: backend returnerar redan i desc created_at, ordningen bevaras
      return 0;
    });

    const grid = document.getElementById('uf-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const cards = new Map();
    let skippedCount = 0;

    sorted.forEach(cluster => {
      const key = cluster.clusterId ?? `face-${cluster.faces[0].id}`;
      const card = buildClusterCard(
        cluster,
        allPersons,
        () => updateSkippedBtn(),
        () => updateSkippedBtn(),
        grid
      );
      if (_skippedClusterKeys.has(key)) {
        card.style.display = 'none';
        skippedCount++;
      }
      grid.appendChild(card);
      cards.set(key, card);
    });

    updateSkippedBtn(skippedCount);

    // Lyssnare för åternavigering från lightbox
    const onLbClosed = () => {
      restoreUnknownFacesState(cards);
      window.removeEventListener('lightbox:closed', onLbClosed);
      // Registrera nytt lyssnare för nästa öppning
      window.addEventListener('lightbox:closed', onLbClosed, { once: true });
    };
    window.removeEventListener('lightbox:closed', onLbClosed);
    window.addEventListener('lightbox:closed', onLbClosed, { once: true });
  };

  const updateSkippedBtn = (count) => {
    const btn = document.getElementById('uf-show-skipped');
    if (!btn) return;
    const n = count !== undefined ? count : _skippedClusterKeys.size;
    btn.classList.toggle('hidden', n === 0);
    btn.textContent = `Visa dolda (${n})`;
  };

  document.getElementById('uf-show-skipped')?.addEventListener('click', () => {
    _skippedClusterKeys.clear();
    document.querySelectorAll('#uf-grid .uf-card').forEach(c => { c.style.display = ''; });
    updateSkippedBtn(0);
  });

  try {
    const { data, meta } = await api.unassignedFaces();
    clusters = data ?? [];

    const metaEl = document.getElementById('uf-meta');
    if (metaEl) metaEl.textContent = `${meta.total_faces} okände ansikten i ${meta.total_clusters} grupper`;

    if (!clusters.length) {
      const grid = document.getElementById('uf-grid');
      if (grid) grid.innerHTML = '<div class="text-slate-400 text-sm col-span-full">Inga okända ansikten hittades.</div>';
      return;
    }

    renderGrid(clusters);
  } catch (e) { toast(e.message, 'error'); }
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
