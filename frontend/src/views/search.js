import { api } from '../api.js';
import { buildPhotoCell, showAssetContextMenu } from '../components/gridCell.js';
import { openLightbox } from '../components/lightbox.js';
import { createSelectionManager } from '../components/selectionManager.js';
import { debounce } from '../utils.js';
import { getThumbSettings } from '../components/thumbSettings.js';

const FLAG_COLORS = { 0:'#94a3b8', 1:'#ef4444', 2:'#eab308', 3:'#22c55e', 4:'#3b82f6', 5:'#a855f7' };
const FLAG_LABELS = { 0:'Ingen', 1:'Röd', 2:'Gul', 3:'Grön', 4:'Blå', 5:'Lila' };
const COLOR_LABELS = { 0:'Ingen', 1:'Röd', 2:'Gul', 3:'Grön', 4:'Blå', 5:'Lila' };
const COLOR_VALUES = { 1:'#ef4444', 2:'#eab308', 3:'#22c55e', 4:'#3b82f6', 5:'#a855f7' };

// Css-klasser
const INP  = 'w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500';
const NINP = 'bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 w-full';
const DINP = 'bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500 flex-1';

// Modulnivå-state
let _assets     = [];
let _sel        = null;
let _tagChips   = [];
let _personChips = [];
let _allPersons = [];
let _thumbSize  = parseInt(localStorage.getItem('sr-thumb-size') ?? '160', 10);
let _thumbSettings = null;
let _sortField  = 'taken_at';
let _sortOrder  = 'desc';

const _debouncedSearch = debounce(() => doSearch(), 400);

// ── Huvud-render ──────────────────────────────────────────────────────────────

export async function renderSearch(container) {
  _assets = [];
  _tagChips = [];
  _personChips = [];

  container.innerHTML = `
    <div class="flex h-full overflow-hidden">

      <!-- Vänster: sökformulär -->
      <div class="w-72 flex-shrink-0 overflow-y-auto bg-slate-900 border-r border-slate-700 p-3 space-y-2" id="search-form-col">
        <div class="flex items-center gap-2 py-1">
          <span class="text-sm font-semibold text-white">🔍 Sök</span>
          <div class="flex-1"></div>
          <button id="search-reset-btn" class="text-[10px] text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-slate-700 transition-colors">Återställ</button>
          <button id="search-run-btn" class="text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-lg transition-colors">Sök</button>
        </div>

        ${section('Fritext', `
          <input id="sf-q" type="text" placeholder="Filnamn, plats, taggar, metadata…" class="${INP}">
        `)}

        ${section('Datum & tid', `
          <label class="block text-[10px] text-slate-400 mb-1">Fotodatum</label>
          <div class="flex items-center gap-1">
            <input id="sf-date-from" type="date" class="${DINP}">
            <span class="text-slate-500 text-[10px]">–</span>
            <input id="sf-date-to" type="date" class="${DINP}">
          </div>
          <label class="block text-[10px] text-slate-400 mt-2 mb-1">Importdatum</label>
          <div class="flex items-center gap-1">
            <input id="sf-changed-from" type="date" class="${DINP}">
            <span class="text-slate-500 text-[10px]">–</span>
            <input id="sf-changed-to" type="date" class="${DINP}">
          </div>
          <p class="text-[10px] text-slate-500 mt-1">Tomt = ingen begränsning</p>
        `)}

        ${section('Betyg & märkning', `
          <label class="block text-[10px] text-slate-400 mb-1">Betyg (min – max)</label>
          <div class="flex gap-4">
            <div>
              <div class="text-[10px] text-slate-500 mb-0.5">Minst</div>
              <div id="stars-min" class="star-picker flex gap-0.5">${starRow('sf-rating-min')}</div>
              <input type="hidden" id="sf-rating-min" value="">
            </div>
            <div>
              <div class="text-[10px] text-slate-500 mb-0.5">Högst</div>
              <div id="stars-max" class="star-picker flex gap-0.5">${starRow('sf-rating-max')}</div>
              <input type="hidden" id="sf-rating-max" value="">
            </div>
          </div>
          <label class="block text-[10px] text-slate-400 mt-3 mb-1">Flagga</label>
          <div class="flex flex-wrap gap-2">
            ${[0,1,2,3,4,5].map((v) => `
              <label class="flex items-center gap-1 cursor-pointer select-none text-[10px]">
                <input type="checkbox" class="sf-flag" value="${v}" style="accent-color:${FLAG_COLORS[v]}">
                <span style="color:${FLAG_COLORS[v]}">${FLAG_LABELS[v]}</span>
              </label>`).join('')}
          </div>
          <label class="block text-[10px] text-slate-400 mt-3 mb-1">Färgetikett</label>
          <div class="flex flex-wrap gap-2">
            ${[0,1,2,3,4,5].map((v) => `
              <label class="flex items-center gap-1 cursor-pointer select-none text-[10px]">
                <input type="checkbox" class="sf-color" value="${v}" ${v===0?'':'style="accent-color:'+COLOR_VALUES[v]+'"'}>
                <span ${v>0?'style="color:'+COLOR_VALUES[v]+'"':'class="text-slate-400"'}>${COLOR_LABELS[v]}</span>
              </label>`).join('')}
          </div>
        `)}

        ${section('Fil & format', `
          <label class="block text-[10px] text-slate-400 mb-1">Filtyp</label>
          <div class="flex gap-3">
            ${['Alla','Bilder','Videor'].map((l,i) => `
              <label class="flex items-center gap-1 cursor-pointer text-[10px]">
                <input type="radio" name="sf-mime" value="${['','image','video'][i]}" ${i===0?'checked':''} class="accent-blue-500">
                <span class="text-slate-300">${l}</span>
              </label>`).join('')}
          </div>
          <label class="block text-[10px] text-slate-400 mt-2 mb-1">Filstorlek (KiB)</label>
          <div class="flex items-center gap-1">
            <input id="sf-size-min" type="number" min="0" placeholder="Min" class="${NINP}">
            <span class="text-slate-500 text-[10px]">–</span>
            <input id="sf-size-max" type="number" min="0" placeholder="Max" class="${NINP}">
          </div>
          <label class="block text-[10px] text-slate-400 mt-2 mb-1">Bredd (px)</label>
          <div class="flex items-center gap-1">
            <input id="sf-width-min" type="number" min="0" placeholder="Min" class="${NINP}">
            <span class="text-slate-500 text-[10px]">–</span>
            <input id="sf-width-max" type="number" min="0" placeholder="Max" class="${NINP}">
          </div>
          <label class="block text-[10px] text-slate-400 mt-2 mb-1">Höjd (px)</label>
          <div class="flex items-center gap-1">
            <input id="sf-height-min" type="number" min="0" placeholder="Min" class="${NINP}">
            <span class="text-slate-500 text-[10px]">–</span>
            <input id="sf-height-max" type="number" min="0" placeholder="Max" class="${NINP}">
          </div>
          <label class="block text-[10px] text-slate-400 mt-2 mb-1">Motion photo</label>
          <div class="flex gap-3">
            ${['Alla','Ja','Nej'].map((l,i) => `
              <label class="flex items-center gap-1 cursor-pointer text-[10px]">
                <input type="radio" name="sf-motion" value="${['','true','false'][i]}" ${i===0?'checked':''} class="accent-blue-500">
                <span class="text-slate-300">${l}</span>
              </label>`).join('')}
          </div>
        `)}

        ${section('Taggar & album', `
          <label class="block text-[10px] text-slate-400 mb-1">Taggar</label>
          <div class="flex gap-1 items-center mb-1">
            <div class="relative flex-1">
              <input id="sf-tag-input" type="text" placeholder="Skriv tagg…" class="${INP}">
              <div id="sf-tag-sugg" class="absolute left-0 right-0 top-full mt-0.5 bg-slate-800 border border-slate-700 rounded-lg hidden z-50"></div>
            </div>
            <label class="text-[10px] cursor-pointer shrink-0"><input type="radio" name="sf-tags-op" value="AND" checked class="accent-blue-500"> AND</label>
            <label class="text-[10px] cursor-pointer shrink-0"><input type="radio" name="sf-tags-op" value="OR" class="accent-blue-500"> OR</label>
          </div>
          <div id="sf-tag-chips" class="flex flex-wrap gap-1 min-h-[20px]"></div>
          <label class="block text-[10px] text-slate-400 mt-2 mb-1">Album</label>
          <select id="sf-album" class="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500">
            <option value="">Vilket album som helst</option>
          </select>
        `)}

        ${section('Personer', `
          <div class="flex gap-1 items-center mb-1">
            <div class="relative flex-1">
              <input id="sf-person-input" type="text" placeholder="Sök person…" class="${INP}">
              <div id="sf-person-sugg" class="absolute left-0 right-0 top-full mt-0.5 bg-slate-800 border border-slate-700 rounded-lg hidden z-50"></div>
            </div>
            <label class="text-[10px] cursor-pointer shrink-0"><input type="radio" name="sf-persons-op" value="AND" checked class="accent-blue-500"> AND</label>
            <label class="text-[10px] cursor-pointer shrink-0"><input type="radio" name="sf-persons-op" value="OR" class="accent-blue-500"> OR</label>
          </div>
          <div id="sf-person-chips" class="flex flex-wrap gap-1 min-h-[20px]"></div>
        `)}

        ${section('Kamerainformation', `
          <label class="block text-[10px] text-slate-400 mb-1">Märke</label>
          <div class="relative">
            <input id="sf-camera-make" type="text" placeholder="t.ex. Canon, Sony…" class="${INP}">
            <div id="sf-make-sugg" class="absolute left-0 right-0 top-full mt-0.5 bg-slate-800 border border-slate-700 rounded-lg hidden z-50"></div>
          </div>
          <label class="block text-[10px] text-slate-400 mt-2 mb-1">Modell</label>
          <div class="relative">
            <input id="sf-camera-model" type="text" placeholder="t.ex. EOS R5…" class="${INP}">
            <div id="sf-model-sugg" class="absolute left-0 right-0 top-full mt-0.5 bg-slate-800 border border-slate-700 rounded-lg hidden z-50"></div>
          </div>
        `)}

        ${section('Plats', `
          <label class="block text-[10px] text-slate-400 mb-1">GPS</label>
          <div class="flex gap-3">
            ${['Alla','Har GPS','Saknar GPS'].map((l,i) => `
              <label class="flex items-center gap-1 cursor-pointer text-[10px]">
                <input type="radio" name="sf-gps" value="${['','true','false'][i]}" ${i===0?'checked':''} class="accent-blue-500">
                <span class="text-slate-300">${l}</span>
              </label>`).join('')}
          </div>
          <label class="block text-[10px] text-slate-400 mt-2 mb-1">Platsnamn</label>
          <div class="relative">
            <input id="sf-location" type="text" placeholder="t.ex. Stockholm…" class="${INP}">
            <div id="sf-location-sugg" class="absolute left-0 right-0 top-full mt-0.5 bg-slate-800 border border-slate-700 rounded-lg hidden z-50"></div>
          </div>
        `)}

        ${section('Övrigt', `
          <label class="block text-[10px] text-slate-400 mb-1">Favorit</label>
          <div class="flex gap-3">
            ${['Alla','Favoriter','Ej favorit'].map((l,i) => `
              <label class="flex items-center gap-1 cursor-pointer text-[10px]">
                <input type="radio" name="sf-fav" value="${['','true','false'][i]}" ${i===0?'checked':''} class="accent-blue-500">
                <span class="text-slate-300">${l}</span>
              </label>`).join('')}
          </div>
        `)}
      </div>

      <!-- Höger: resultat -->
      <div class="flex-1 flex flex-col overflow-hidden">

        <!-- Toolbar (kopia av Bilder-fliken) -->
        <div class="flex items-center gap-2 px-3 py-2 border-b border-slate-700 bg-slate-900 flex-shrink-0 flex-wrap">
          <div id="sr-sel-toolbar" class="flex items-center gap-3 flex-wrap flex-1 min-h-[28px]"></div>
          <div id="sr-status" class="text-xs text-slate-400 shrink-0">Fyll i filter och tryck Sök.</div>

          <!-- Sort -->
          <select id="sr-sort" class="bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1 cursor-pointer hover:border-slate-400 transition-colors shrink-0">
            <option value="taken_at">Datum taget</option>
            <option value="indexed_at">Tillagd</option>
            <option value="file_size">Storlek</option>
            <option value="file_name">Filnamn</option>
            <option value="view_count">Populärast</option>
            <option value="rating">Betyg</option>
          </select>
          <button id="sr-order-btn" title="Fallande"
            class="p-1.5 rounded hover:bg-slate-700 text-slate-300 hover:text-white transition-colors shrink-0">
            ${orderIcon('desc')}
          </button>

          <div class="w-px h-5 bg-slate-700 shrink-0"></div>

          <!-- S/M/L -->
          <div class="flex gap-0.5 shrink-0">
            <button data-size="80"  class="sr-size-btn px-2 py-1 text-xs rounded transition-colors">S</button>
            <button data-size="160" class="sr-size-btn px-2 py-1 text-xs rounded transition-colors">M</button>
            <button data-size="240" class="sr-size-btn px-2 py-1 text-xs rounded transition-colors">L</button>
          </div>
        </div>

        <!-- Grid -->
        <div id="sr-grid-wrap" class="flex-1 overflow-y-auto p-2">
          <div id="sr-grid" class="grid gap-0.5"
            style="grid-template-columns: repeat(auto-fill, minmax(${_thumbSize}px, 1fr))">
          </div>
        </div>

      </div>
    </div>
  `;

  // Ladda album + personer
  loadAlbums();
  loadPersons();

  // Thumb-inställningar
  getThumbSettings().then((ts) => { _thumbSettings = ts; });

  // Stjärn-pickers
  setupStarPickers();

  // Autocomplete-inputs
  setupTagInput();
  setupPersonInput();
  setupSuggestInput('sf-camera-make',  'sf-make-sugg',   'cameraMake');
  setupSuggestInput('sf-camera-model', 'sf-model-sugg',  'cameraModel');
  setupSuggestInput('sf-location',     'sf-location-sugg','location');

  // Knappar
  document.getElementById('search-run-btn').addEventListener('click', doSearch);
  document.getElementById('search-reset-btn').addEventListener('click', resetForm);
  document.getElementById('sf-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  // Toolbar: sort + order + size
  document.getElementById('sr-sort').value = _sortField;
  document.getElementById('sr-sort').addEventListener('change', (e) => {
    _sortField = e.target.value;
    doSearch();
  });
  document.getElementById('sr-order-btn').addEventListener('click', () => {
    _sortOrder = _sortOrder === 'desc' ? 'asc' : 'desc';
    document.getElementById('sr-order-btn').innerHTML = orderIcon(_sortOrder);
    document.getElementById('sr-order-btn').title = _sortOrder === 'asc' ? 'Stigande' : 'Fallande';
    doSearch();
  });
  document.querySelectorAll('.sr-size-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyThumbSize(parseInt(btn.dataset.size)));
  });
  applyThumbSize(_thumbSize);

  // Selektionshanterare
  _sel = createSelectionManager(
    () => document.getElementById('sr-grid'),
    () => _assets,
  );
  _sel.mountToolbar(document.getElementById('sr-sel-toolbar'));

  // Realtidssökning
  setupRealtimeSearch();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function section(title, body) {
  return `
    <details open class="bg-slate-800 rounded-xl border border-slate-700" style="overflow:visible">
      <summary class="flex items-center justify-between px-3 py-2 cursor-pointer select-none text-[11px] font-semibold text-slate-300 hover:bg-slate-700 list-none">
        ${title}<span class="text-slate-500 text-[10px]">▾</span>
      </summary>
      <div class="px-3 py-2 border-t border-slate-700">${body}</div>
    </details>`;
}

function starRow(id) {
  return [1,2,3,4,5].map((n) =>
    `<button type="button" data-val="${n}" data-target="${id}"
      class="star-btn text-base leading-none text-slate-600 hover:text-yellow-300 transition-colors">★</button>`
  ).join('');
}

function orderIcon(order) {
  return order === 'asc'
    ? '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 4h13M3 8h9M3 12h5m10 4l-4-4m0 0l-4 4m4-4v12"/></svg>'
    : '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 4h13M3 8h9M3 12h5m10-4l-4 4m0 0l-4-4m4 4V4"/></svg>';
}

function applyThumbSize(px) {
  _thumbSize = px;
  localStorage.setItem('sr-thumb-size', String(px));
  const grid = document.getElementById('sr-grid');
  if (grid) grid.style.gridTemplateColumns = `repeat(auto-fill,minmax(${px}px,1fr))`;
  document.querySelectorAll('.sr-size-btn').forEach((btn) => {
    const active = btn.dataset.size === String(px);
    btn.classList.toggle('bg-slate-600', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('text-slate-400', !active);
  });
}

// ── Realtidssökning ───────────────────────────────────────────────────────────

function setupRealtimeSearch() {
  const formCol = document.getElementById('search-form-col');
  if (!formCol) return;
  formCol.addEventListener('input', (e) => {
    if (e.target.id === 'sf-tag-input' || e.target.id === 'sf-person-input') return;
    if (e.target.id === 'sf-camera-make' || e.target.id === 'sf-camera-model') return;
    if (e.target.id === 'sf-location') return;
    if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) _debouncedSearch();
  });
  formCol.addEventListener('change', (e) => {
    if (['INPUT','SELECT'].includes(e.target.tagName)) _debouncedSearch();
  });
}

// ── Stjärn-picker ─────────────────────────────────────────────────────────────

function setupStarPickers() {
  document.querySelectorAll('.star-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.dataset.val);
      const hidden = document.getElementById(btn.dataset.target);
      const cur = parseInt(hidden.value) || 0;
      const next = cur === val ? 0 : val;
      hidden.value = next || '';
      btn.closest('.star-picker').querySelectorAll('.star-btn').forEach((s) => {
        const sv = parseInt(s.dataset.val);
        s.className = `star-btn text-base leading-none transition-colors ${sv <= next ? 'text-yellow-400' : 'text-slate-600'} hover:text-yellow-300`;
      });
      _debouncedSearch();
    });
  });
}

// ── Taggar med autocomplete ───────────────────────────────────────────────────

function setupTagInput() {
  const input = document.getElementById('sf-tag-input');
  const sugg  = document.getElementById('sf-tag-sugg');
  if (!input || !sugg) return;

  document.body.appendChild(sugg);

  const fetchTagSugg = debounce(async (q) => {
    try {
      const { data } = await api.get(`/api/tags?q=${encodeURIComponent(q)}`);
      if (!data?.length) { sugg.classList.add('hidden'); return; }
      sugg.innerHTML = data.map((t) =>
        `<button type="button" data-tag="${t.name}" class="w-full text-left px-3 py-1.5 text-xs text-white hover:bg-slate-700 flex items-center justify-between">
          <span>${t.name}</span><span class="text-slate-500">${t.count}</span>
        </button>`).join('');
      positionDropdown(input, sugg);
      sugg.classList.remove('hidden');
      sugg.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          addTagChip(btn.dataset.tag);
          input.value = '';
          sugg.classList.add('hidden');
        });
      });
    } catch {}
  }, 200);

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (q.length >= 1) fetchTagSugg(q); else sugg.classList.add('hidden');
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.value.trim().replace(/,$/, '');
      if (val) { addTagChip(val); input.value = ''; sugg.classList.add('hidden'); }
    }
    if (e.key === 'Backspace' && !input.value && _tagChips.length) {
      _tagChips.pop(); renderTagChips(); _debouncedSearch();
    }
    if (e.key === 'Escape') sugg.classList.add('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !sugg.contains(e.target)) sugg.classList.add('hidden');
  });
}

function addTagChip(name) {
  if (!_tagChips.includes(name)) { _tagChips.push(name); renderTagChips(); _debouncedSearch(); }
}

function renderTagChips() {
  const el = document.getElementById('sf-tag-chips');
  if (!el) return;
  el.innerHTML = _tagChips.map((t, i) =>
    `<span class="flex items-center gap-1 bg-blue-700 text-white text-[10px] rounded-full px-2 py-0.5">
      ${t}<button type="button" data-ti="${i}" class="tag-rm hover:text-red-300">×</button>
    </span>`).join('');
  el.querySelectorAll('.tag-rm').forEach((btn) => {
    btn.addEventListener('click', () => { _tagChips.splice(parseInt(btn.dataset.ti),1); renderTagChips(); _debouncedSearch(); });
  });
}

// ── Person med autocomplete + thumbnail ───────────────────────────────────────

async function loadPersons() {
  try { const { data } = await api.persons(); _allPersons = data ?? []; } catch {}
}

function setupPersonInput() {
  const input = document.getElementById('sf-person-input');
  const sugg  = document.getElementById('sf-person-sugg');
  if (!input || !sugg) return;

  document.body.appendChild(sugg);

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    if (!q) { sugg.classList.add('hidden'); return; }
    const matches = _allPersons.filter((p) => p.name.toLowerCase().includes(q) && !_personChips.find((c) => c.id === p.id)).slice(0, 8);
    if (!matches.length) { sugg.classList.add('hidden'); return; }
    const faceId = (p) => p.cover_face_id ?? p.fallback_face_id;
    sugg.innerHTML = matches.map((p) => `
      <button type="button" data-pid="${p.id}" data-pname="${p.name}"
        class="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-slate-700 text-left text-xs text-white transition-colors">
        <div class="w-7 h-7 rounded-full overflow-hidden bg-slate-600 flex-shrink-0 flex items-center justify-center">
          ${faceId(p)
            ? `<img src="/api/faces/${faceId(p)}/thumb" class="w-full h-full object-cover" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'👤',className:'text-sm'}))">`
            : '<span class="text-sm">👤</span>'}
        </div>
        <span>${p.name}</span>
        <span class="text-slate-500 ml-auto text-[10px]">${p.photo_count ?? ''}</span>
      </button>`).join('');
    positionDropdown(input, sugg);
    sugg.classList.remove('hidden');
    sugg.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        _personChips.push({ id: btn.dataset.pid, name: btn.dataset.pname });
        renderPersonChips(); input.value = ''; sugg.classList.add('hidden'); _debouncedSearch();
      });
    });
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !sugg.contains(e.target)) sugg.classList.add('hidden');
  });
}

function renderPersonChips() {
  const el = document.getElementById('sf-person-chips');
  if (!el) return;
  el.innerHTML = _personChips.map((p, i) =>
    `<span class="flex items-center gap-1 bg-purple-700 text-white text-[10px] rounded-full px-2 py-0.5">
      👤 ${p.name}<button type="button" data-pi="${i}" class="person-rm hover:text-red-300">×</button>
    </span>`).join('');
  el.querySelectorAll('.person-rm').forEach((btn) => {
    btn.addEventListener('click', () => { _personChips.splice(parseInt(btn.dataset.pi),1); renderPersonChips(); _debouncedSearch(); });
  });
}

// ── Generisk autocomplete (kamera, plats) ─────────────────────────────────────

function positionDropdown(input, sugg) {
  const r = input.getBoundingClientRect();
  sugg.style.position = 'fixed';
  sugg.style.top    = `${r.bottom + 2}px`;
  sugg.style.left   = `${r.left}px`;
  sugg.style.width  = `${r.width}px`;
  sugg.style.zIndex = '9999';
}

function setupSuggestInput(inputId, suggId, type) {
  const input = document.getElementById(inputId);
  const sugg  = document.getElementById(suggId);
  if (!input || !sugg) return;

  // Flytta dropdown till body så overflow-y-auto inte klipper den
  document.body.appendChild(sugg);

  const doFetch = debounce(async (q) => {
    try {
      const { data } = await api.suggestions(type, q);
      if (!data?.length) { sugg.classList.add('hidden'); return; }
      sugg.innerHTML = data.map((row) =>
        `<button type="button" data-val="${row.label}" class="w-full text-left px-3 py-1.5 text-xs text-white hover:bg-slate-700 flex justify-between">
          <span class="truncate">${row.label}</span><span class="text-slate-500 ml-2 shrink-0">${row.count}</span>
        </button>`).join('');
      positionDropdown(input, sugg);
      sugg.classList.remove('hidden');
      sugg.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          input.value = btn.dataset.val;
          sugg.classList.add('hidden');
          _debouncedSearch();
        });
      });
    } catch (err) { console.error('suggestions error', type, err); }
  }, 200);

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (q.length >= 1) doFetch(q); else sugg.classList.add('hidden');
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { sugg.classList.add('hidden'); _debouncedSearch(); }
    if (e.key === 'Escape') sugg.classList.add('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !sugg.contains(e.target)) sugg.classList.add('hidden');
  });
}

// ── Album-dropdown ────────────────────────────────────────────────────────────

async function loadAlbums() {
  try {
    const { data } = await api.albums();
    const sel = document.getElementById('sf-album');
    if (!sel) return;
    (data ?? []).forEach((a) => {
      const opt = document.createElement('option');
      opt.value = a.id; opt.textContent = a.name;
      sel.appendChild(opt);
    });
  } catch {}
}

// ── Samla parametrar ──────────────────────────────────────────────────────────

function collectParams() {
  const v    = (id) => (document.getElementById(id)?.value ?? '').trim();
  const rad  = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value ?? '';
  const p    = {};

  const q   = v('sf-q');
  const loc = v('sf-location');
  const combined = [q, loc].filter(Boolean).join(' ');
  if (combined) p.q = combined;

  const df = v('sf-date-from'), dt = v('sf-date-to');
  if (df) p.dateFrom = df;
  if (dt) p.dateTo   = dt;
  const cf = v('sf-changed-from'), ct = v('sf-changed-to');
  if (cf) p.changedFrom = cf;
  if (ct) p.changedTo   = ct;

  const rMin = v('sf-rating-min'), rMax = v('sf-rating-max');
  if (rMin) p.ratingMin = rMin;
  if (rMax) p.ratingMax = rMax;

  const flagVals = [...document.querySelectorAll('.sf-flag:checked')].map((cb) => cb.value);
  if (flagVals.length) p.flag = flagVals.join(',');
  const colorVals = [...document.querySelectorAll('.sf-color:checked')].map((cb) => cb.value);
  if (colorVals.length) p.colorLabel = colorVals.join(',');

  const mime = rad('sf-mime');
  if (mime) p.mimeType = mime;

  // KiB → bytes
  const sMin = v('sf-size-min'), sMax = v('sf-size-max');
  if (sMin) p.sizeMin = Math.round(parseFloat(sMin) * 1024);
  if (sMax) p.sizeMax = Math.round(parseFloat(sMax) * 1024);

  const wMin=v('sf-width-min'),wMax=v('sf-width-max'),hMin=v('sf-height-min'),hMax=v('sf-height-max');
  if (wMin) p.widthMin  = wMin;
  if (wMax) p.widthMax  = wMax;
  if (hMin) p.heightMin = hMin;
  if (hMax) p.heightMax = hMax;

  const motion = rad('sf-motion');
  if (motion) p.isMotionPhoto = motion;

  if (_tagChips.length) { p.tags = _tagChips.join(','); p.tagsOp = rad('sf-tags-op') || 'AND'; }

  const albumId = v('sf-album');
  if (albumId) p.albumId = albumId;

  if (_personChips.length) { p.personIds = _personChips.map((c)=>c.id).join(','); p.personIdsOp = rad('sf-persons-op') || 'AND'; }

  const make  = v('sf-camera-make'),  model = v('sf-camera-model');
  if (make)  p.cameraMake  = make;
  if (model) p.cameraModel = model;

  const gps = rad('sf-gps');
  if (gps === 'true')  p.hasGps = 'true';
  if (gps === 'false') p.hasGps = 'false';

  const fav = rad('sf-fav');
  if (fav === 'true')  p.isFavorite = 'true';
  if (fav === 'false') p.isFavorite = 'false';


  p.limit = 200;
  p.sort  = _sortField;
  p.order = _sortOrder;
  return p;
}

// ── Kör sökning ───────────────────────────────────────────────────────────────

async function doSearch() {
  const statusEl = document.getElementById('sr-status');
  const grid     = document.getElementById('sr-grid');
  if (!statusEl || !grid) return;

  statusEl.textContent = 'Söker…';
  grid.innerHTML = '<div class="col-span-full text-slate-500 text-sm p-4">Hämtar…</div>';

  try {
    const { data } = await api.search(collectParams());
    _assets = data ?? [];
    renderResults(_assets);

    const count = _assets.length;
    statusEl.textContent = count === 0
      ? 'Inga bilder matchade.'
      : `${count} bild${count !== 1 ? 'er' : ''}${count === 200 ? ' (max 200)' : ''}`;

    if (_sel) _sel.mountToolbar(document.getElementById('sr-sel-toolbar'));
  } catch (err) {
    statusEl.textContent = `Fel: ${err.message}`;
    grid.innerHTML = '';
  }
}

// ── Rendera resultatgaller ────────────────────────────────────────────────────

function renderResults(assets) {
  const grid = document.getElementById('sr-grid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!assets.length) {
    grid.innerHTML = '<div class="col-span-full text-slate-500 text-sm p-4">Inga bilder hittades.</div>';
    return;
  }
  assets.forEach((asset, idx) => {
    const cell = buildPhotoCell(asset, () => openLightbox(assets, idx), null, _thumbSettings);
    if (_sel) _sel.attachToCell(cell, asset, idx);
    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showAssetContextMenu(e, asset, cell, () => {});
    });
    grid.appendChild(cell);
  });
}

// ── Återställ ─────────────────────────────────────────────────────────────────

function resetForm() {
  ['sf-q','sf-date-from','sf-date-to','sf-changed-from','sf-changed-to',
   'sf-rating-min','sf-rating-max','sf-camera-make','sf-camera-model',
   'sf-location','sf-size-min','sf-size-max',
   'sf-width-min','sf-width-max','sf-height-min','sf-height-max',
  ].forEach((id) => { const el=document.getElementById(id); if (el) el.value=''; });

  ['sf-mime','sf-motion','sf-gps','sf-fav'].forEach((name) => {
    const first = document.querySelector(`input[name="${name}"]`);
    if (first) first.checked = true;
  });
  document.querySelectorAll('.sf-flag,.sf-color').forEach((cb) => cb.checked=false);
  document.querySelectorAll('.star-btn').forEach((btn) => {
    btn.className='star-btn text-base leading-none transition-colors text-slate-600 hover:text-yellow-300';
  });

  _tagChips=[]; _personChips=[];
  renderTagChips(); renderPersonChips();

  _assets=[];
  const grid=document.getElementById('sr-grid');
  if (grid) grid.innerHTML='';
  const statusEl=document.getElementById('sr-status');
  if (statusEl) statusEl.textContent='Fyll i filter och tryck Sök.';
}
