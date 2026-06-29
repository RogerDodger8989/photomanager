import { api } from '../api.js';
import { openLightbox } from '../components/lightbox.js';
import { toast as showToast, toastWithUndo } from '../utils.js';
import { buildPhotoCell, showAssetContextMenu } from '../components/gridCell.js';
import { createSelectionManager, downloadBlob } from '../components/selectionManager.js';

// ── State ─────────────────────────────────────────────────────────────────────
/** @type {Array<any>} */
let _tree = [];
/** @type {Set<string>} */
const _expanded = new Set();
/** @type {string|null} */
let _selectedTagId = null;
let _filter = 'all';       // 'all' | 'unused' | 'face' | 'leaf' | 'root' | 'recent' | 'color'
let _searchQ = '';
/** @type {Map<string, any>} */
let _flatMap = new Map();  // id → nod (för snabbt uppslag)
/** @type {HTMLElement|null} */
let _container = null;
/** @type {Record<string,any>} */
let _settings = {};

// ── Entry point ───────────────────────────────────────────────────────────────
export async function renderTags(container) {
  _container = container;
  _container.innerHTML = `
    <div class="flex h-full overflow-hidden bg-slate-900 text-slate-100">
      <!-- Vänster panel: träd -->
      <div id="tag-sidebar" class="w-80 min-w-60 flex flex-col border-r border-slate-700 overflow-hidden">
        <!-- Header -->
        <div class="px-3 pt-3 pb-2 border-b border-slate-700 space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-semibold text-slate-200 text-sm">🏷️ Taggar</span>
            <div class="flex gap-1">
              <button id="tag-btn-import" title="Importera taggar"
                class="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-300">⬆ Import</button>
              <button id="tag-btn-export" title="Exportera taggar"
                class="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-300">⬇ Export</button>
              <button id="tag-btn-new" title="Ny rot-tagg"
                class="px-2 py-1 rounded bg-blue-700 hover:bg-blue-600 text-xs text-white">+</button>
            </div>
          </div>
          <!-- Sök -->
          <input id="tag-search" type="text" placeholder="Sök taggar…"
            class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
          <!-- Statistik-chips -->
          <div id="tag-stats" class="flex flex-wrap gap-1 text-xs text-slate-400"></div>
          <!-- Filter-knappar -->
          <div class="flex flex-wrap gap-1">
            ${[
              ['all',    'Alla'],
              ['unused', 'Oanvända'],
              ['face',   'Ansikten'],
              ['leaf',   'Löv'],
              ['root',   'Rot'],
              ['recent', 'Nya'],
              ['color',  'Med färg'],
            ].map(([k, l]) =>
              `<button data-filter="${k}"
                class="tag-filter-btn px-2 py-0.5 rounded text-xs border border-slate-600 ${k === 'all' ? 'bg-blue-700 text-white border-blue-600' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}">${l}</button>`
            ).join('')}
          </div>
        </div>
        <!-- Träd -->
        <div id="tag-tree" class="flex-1 overflow-y-auto py-1 text-xs"></div>
      </div>

      <!-- Höger panel: detaljer -->
      <div id="tag-detail" class="flex-1 overflow-y-auto p-4">
        <p class="text-slate-500 text-sm mt-8 text-center">Välj en tagg i listan till vänster.</p>
      </div>
    </div>

    <!-- Kontextmeny -->
    <div id="tag-ctx-menu" class="hidden fixed z-50 bg-slate-800 border border-slate-600 rounded shadow-xl py-1 text-sm min-w-44"></div>

    <!-- Redigerings-modal -->
    <div id="tag-edit-modal" class="hidden fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
      <div class="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-full max-w-md p-5 space-y-4">
        <h2 id="tem-title" class="font-semibold text-slate-100 text-sm"></h2>
        <div class="space-y-3 text-sm">
          <div>
            <label class="block text-slate-400 text-xs mb-1">Namn</label>
            <input id="tem-name" class="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-slate-100 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
          </div>
          <div class="flex gap-3">
            <div class="flex-1">
              <label class="block text-slate-400 text-xs mb-1">Färg</label>
              <div class="flex gap-1 items-center">
                <input id="tem-color" type="color" class="h-7 w-12 rounded cursor-pointer bg-transparent border-0">
                <button id="tem-color-reset" class="text-slate-500 hover:text-slate-300 text-xs">✕ Ingen</button>
              </div>
            </div>
          </div>
          <div class="space-y-2">
            <label class="flex items-center gap-2 cursor-pointer">
              <input id="tem-face-tag" type="checkbox" class="rounded">
              <span class="text-slate-300 text-xs">👤 Ansiktstagg (sparas under /Personer/)</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input id="tem-export-leaf" type="checkbox" class="rounded">
              <span class="text-slate-300 text-xs">Exportera bara löv-namn (t.ex. "Asta" istället för "/Personer/A/Asta")</span>
            </label>
            <label id="tem-show-lifespan-row" class="flex items-center gap-2 cursor-pointer hidden">
              <input id="tem-show-lifespan" type="checkbox" class="rounded">
              <span class="text-slate-300 text-xs">Visa livstid inom parantes</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input id="tem-export-synonyms" type="checkbox" class="rounded">
              <span class="text-slate-300 text-xs">Exportera synonymer för denna tagg</span>
            </label>
          </div>
          <div id="tem-person-fields" class="hidden space-y-2 pl-4 border-l border-slate-600">
            <div class="flex gap-2">
              <div class="flex-1">
                <label class="block text-slate-400 text-xs mb-1">ID (valfritt)</label>
                <input id="tem-cid" type="text" placeholder="t.ex. LL30LL" class="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-100 text-sm focus:outline-none">
              </div>
              <div class="flex-1">
                <label class="block text-slate-400 text-xs mb-1">Födelseår</label>
                <input id="tem-birth" type="number" min="1000" max="2100" class="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-100 text-sm focus:outline-none">
              </div>
              <div class="flex-1">
                <label class="block text-slate-400 text-xs mb-1">Dödsår</label>
                <input id="tem-death" type="number" min="1000" max="2100" class="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-100 text-sm focus:outline-none">
              </div>
            </div>
          </div>
          <!-- Synonymer -->
          <div>
            <label class="block text-slate-400 text-xs mb-1">Synonymer</label>
            <div id="tem-synonyms" class="flex flex-wrap gap-1 mb-1"></div>
            <div class="flex gap-1">
              <input id="tem-syn-input" placeholder="Lägg till synonym…" class="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none">
              <button id="tem-syn-add" class="px-2 py-1 rounded bg-slate-600 hover:bg-slate-500 text-xs text-slate-300">+</button>
            </div>
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button id="tem-cancel" class="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-300">Avbryt</button>
          <button id="tem-save" class="px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-600 text-sm text-white">Spara</button>
        </div>
      </div>
    </div>

    <!-- Import-modal -->
    <div id="tag-import-modal" class="hidden fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
      <div class="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4">
        <h2 class="font-semibold text-slate-100 text-sm">Importera taggar</h2>
        <div class="space-y-3 text-sm">
          <div>
            <label class="block text-slate-400 text-xs mb-1">Fil (JSON eller CSV)</label>
            <input id="tim-file" type="file" accept=".json,.csv" class="text-slate-300 text-xs w-full">
          </div>
          <div>
            <label class="block text-slate-400 text-xs mb-1">Vid konflikt</label>
            <select id="tim-conflict" class="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-100 text-sm">
              <option value="skip">Hoppa över (skip)</option>
              <option value="overwrite">Skriv över (overwrite)</option>
            </select>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <button id="tim-cancel" class="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-300">Avbryt</button>
          <button id="tim-ok" class="px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-600 text-sm text-white">Importera</button>
        </div>
      </div>
    </div>

    <!-- Mapp→tagg-regler modal -->
    <div id="tag-rules-modal" class="hidden fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
      <div class="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-full max-w-lg p-5 space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold text-slate-100 text-sm">📁 Mapp → Tagg-regler</h2>
          <button id="trm-close" class="text-slate-400 hover:text-slate-200">✕</button>
        </div>
        <div id="trm-list" class="space-y-1 max-h-64 overflow-y-auto"></div>
        <div class="border-t border-slate-700 pt-3 space-y-2">
          <p class="text-slate-400 text-xs">Ny regel</p>
          <div class="flex gap-2">
            <select id="trm-match-type" class="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200">
              <option value="folder_name">Mappnamn =</option>
              <option value="folder_name_contains">Mappnamn innehåller</option>
              <option value="folder_path_contains">Sökväg innehåller</option>
              <option value="glob">Glob-mönster</option>
            </select>
            <input id="trm-pattern" placeholder="t.ex. 1989" class="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none">
          </div>
          <div>
            <label class="block text-slate-400 text-xs mb-1">Tagg</label>
            <input id="trm-tag-search" placeholder="Sök tagg…" class="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none">
            <div id="trm-tag-results" class="mt-1 space-y-0.5 max-h-32 overflow-y-auto"></div>
            <input id="trm-tag-id" type="hidden">
          </div>
          <button id="trm-add" class="px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 text-xs text-white">Lägg till regel</button>
        </div>
      </div>
    </div>
  `;

  _bindStaticEvents();
  // Ladda inställningar för standardvärden
  try { const sr = await api.getSettings(); _settings = sr.data ?? {}; } catch { /* ok */ }
  await _loadTree();
}

// ── Ladda träd ────────────────────────────────────────────────────────────────
async function _loadTree() {
  try {
    const [treeRes, statsRes] = await Promise.all([api.tagTree(), api.tagStats()]);
    _tree = treeRes.data ?? [];
    _flatMap = new Map();
    _flattenTree(_tree, _flatMap);
    _renderTree();
    _renderStats(statsRes.data);
  } catch (e) {
    _treeEl().innerHTML = `<p class="text-red-400 text-xs p-3">Kunde inte ladda taggar: ${e.message}</p>`;
  }
}

/** @param {Array<any>} nodes @param {Map<string,any>} map */
function _flattenTree(nodes, map) {
  for (const n of nodes) {
    map.set(n.id, n);
    if (n.children?.length) _flattenTree(n.children, map);
  }
}

// ── Rendera träd ──────────────────────────────────────────────────────────────
function _renderTree() {
  const tree = _treeEl();
  const q = _searchQ.toLowerCase();

  // Vid sökning: visa platt filtrerad lista
  if (q) {
    /** @type {Array<any>} */
    const hits = [];
    _flatMap.forEach((n) => {
      if (n.name.toLowerCase().includes(q) || (n.path ?? '').toLowerCase().includes(q) || (n.custom_id ?? '').toLowerCase().includes(q)) hits.push(n);
    });
    tree.innerHTML = hits.map((n) => _nodeHtml(n, 0)).join('');
    return;
  }

  // Normalläge: filtrera och visa träd
  const filtered = _applyFilter(_tree);
  tree.innerHTML = filtered.map((n) => _renderNodeRecursive(n, 0)).join('');
}

/**
 * @param {Array<any>} nodes
 * @returns {Array<any>}
 */
function _applyFilter(nodes) {
  return nodes.flatMap((n) => {
    if (_filter === 'face'   && !n.is_face_tag)   return [];
    if (_filter === 'color'  && !n.color)          return [];
    if (_filter === 'leaf'   && n.children?.length) return [];
    if (_filter === 'root'   && n.parent_id)        return [];
    return [{ ...n, children: _applyFilter(n.children ?? []) }];
  });
}

/**
 * @param {any} node
 * @param {number} depth
 * @returns {string}
 */
function _renderNodeRecursive(node, depth) {
  const expanded = _expanded.has(node.id);
  const hasChildren = node.children?.length > 0;
  let html = _nodeHtml(node, depth, hasChildren, expanded);
  if (expanded && hasChildren) {
    html += node.children.map((c) => _renderNodeRecursive(c, depth + 1)).join('');
  }
  return html;
}

/**
 * @param {any} node
 * @param {number} depth
 * @param {boolean} [hasChildren]
 * @param {boolean} [expanded]
 * @returns {string}
 */
function _nodeHtml(node, depth, hasChildren = false, expanded = false) {
  const indent = depth * 14;
  const isSelected = node.id === _selectedTagId;
  const isRoot = !node.parent_id && depth === 0;
  const dot = node.color
    ? `<span style="width:8px;height:8px;border-radius:50%;background:${node.color};flex-shrink:0;display:inline-block;"></span>`
    : '';
  const arrow = hasChildren
    ? `<span class="tag-arrow text-slate-500 cursor-pointer select-none w-4 inline-block text-center" data-id="${node.id}">${expanded ? '▼' : '▶'}</span>`
    : `<span class="w-4 inline-block"></span>`;
  const icon = node.icon_thumb
    ? `<img src="/thumbs/${node.icon_thumb}" class="w-4 h-4 rounded object-cover flex-shrink-0">`
    : (node.is_face_tag ? '👤' : (isRoot ? '📂' : '🏷️'));
  const countBadge = node.asset_count > 0
    ? `<span class="ml-auto text-slate-500 text-xs">${node.asset_count}</span>`
    : '';

  // Root nodes get a distinct style: bold uppercase label + subtle left border
  const bg = isSelected
    ? 'bg-blue-900/60'
    : (isRoot ? 'hover:bg-slate-700/60' : 'hover:bg-slate-800');
  const rootStyle = isRoot
    ? 'border-l-2 border-slate-500 ml-1 mt-1 mb-0.5'
    : '';
  const nameClass = isRoot
    ? 'truncate text-slate-100 font-semibold tracking-wide'
    : 'truncate text-slate-200';

  return `<div class="tag-node flex items-center gap-1 px-2 py-0.5 cursor-pointer rounded ${bg} ${rootStyle} select-none"
    style="padding-left: ${8 + indent}px"
    data-id="${node.id}"
    draggable="true"
    data-depth="${depth}">
    ${arrow}
    <span class="flex items-center gap-1 flex-1 overflow-hidden">
      <span class="flex-shrink-0">${icon}</span>
      ${dot}
      <span class="${nameClass}">${_esc(node.name)}</span>
      ${node.show_lifespan && (node.birth_year || node.death_year)
        ? `<span class="text-slate-500 text-xs">(${node.birth_year ?? ''}–${node.death_year ?? ''})</span>`
        : ''}
      ${node.custom_id != null
        ? `<span class="text-slate-500 text-xs ml-0.5 cursor-pointer hover:text-slate-300 select-none tag-cid-badge" data-cid="${_esc(node.custom_id)}" title="Klicka för att kopiera ID">🪪 ${_esc(node.custom_id)}</span>`
        : ''}
    </span>
    ${countBadge}
  </div>`;
}

// ── Statistik-chips ────────────────────────────────────────────────────────────
/** @param {any} stats */
function _renderStats(stats) {
  if (!stats) return;
  const el = document.getElementById('tag-stats');
  if (!el) return;
  el.innerHTML = [
    `<span title="Totalt antal taggar">${stats.total} taggar</span>`,
    `<span title="Oanvända taggar" class="${stats.unused_tags > 0 ? 'text-amber-400' : ''}">${stats.unused_tags} oanvända</span>`,
    `<span title="Ansiktstaggar">👤 ${stats.face_tags}</span>`,
  ].join('<span class="text-slate-700">·</span>');
}

// ── Rätt panel: tagg-detaljer + bildgrid ──────────────────────────────────────
async function _showTagDetail(tagId) {
  const prevId = _selectedTagId;
  _selectedTagId = tagId;

  // Uppdatera markeringsstyling direkt på elementet — ingen full omritning
  // (full _renderTree() förstör DOM-noden och bryter dblclick-händelsen)
  const tree = _treeEl();
  if (prevId) {
    tree.querySelector(`[data-id="${prevId}"]`)?.classList.remove('bg-blue-900/60');
  }
  tree.querySelector(`[data-id="${tagId}"]`)?.classList.add('bg-blue-900/60');

  const node = _flatMap.get(tagId);
  if (!node) return;

  const detail = document.getElementById('tag-detail');
  if (!detail) return;

  detail.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <div class="text-slate-500 text-xs mb-0.5">${_esc(node.path ?? node.name)}</div>
          <h2 class="text-slate-100 font-semibold text-lg">${_esc(node.name)}</h2>
          ${node.show_lifespan && (node.birth_year || node.death_year)
            ? `<div class="text-slate-400 text-sm">${node.birth_year ?? ''}–${node.death_year ?? ''}${node.custom_id != null ? ` <span class="cursor-pointer hover:text-white tag-cid-badge" data-cid="${_esc(node.custom_id)}" title="Klicka för att kopiera ID">🪪 ${_esc(node.custom_id)}</span>` : ''}</div>`
            : node.custom_id != null ? `<div class="text-slate-400 text-sm cursor-pointer hover:text-white tag-cid-badge" data-cid="${_esc(node.custom_id)}" title="Klicka för att kopiera ID">🪪 ${_esc(node.custom_id)}</div>` : ''}
        </div>
        <div class="flex gap-2">
          <button id="td-rules-btn" class="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-300">📁 Mappregeler</button>
          <button id="td-edit-btn" class="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-300">✏️ Redigera</button>
        </div>
      </div>
      ${node.color ? `<div class="flex items-center gap-2"><span style="width:16px;height:16px;border-radius:50%;background:${node.color};display:inline-block;"></span><span class="text-slate-400 text-xs">Färg: ${_esc(node.color)}</span></div>` : ''}
      <div id="td-synonyms" class="flex flex-wrap gap-1"></div>
      <div id="td-sel-toolbar" class="flex flex-wrap items-center gap-2 min-h-[28px]"></div>
      <div id="td-grid" class="grid gap-0.5" style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))"></div>
      <div id="td-more" class="hidden text-center mt-2">
        <button id="td-more-btn" class="px-4 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-300">Ladda fler</button>
      </div>
    </div>`;

  document.getElementById('td-edit-btn')?.addEventListener('click', () => _openEditModal(tagId));
  document.getElementById('td-rules-btn')?.addEventListener('click', _openRulesModal);
  document.querySelectorAll('.tag-cid-badge').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const cid = /** @type {HTMLElement} */ (el).dataset.cid ?? '';
      navigator.clipboard.writeText(cid).then(() => showToast(`Kopierade ID: ${cid}`, 'success'));
    });
  });

  // Synonymer
  _loadSynonyms(tagId);

  // Bildgrid med paginering
  let offset = 0;
  const PAGE = 48;
  /** @type {Array<any>} */
  let allAssets = [];

  const grid = document.getElementById('td-grid');
  const sel = createSelectionManager(
    () => grid,
    () => allAssets,
  );
  const toolbarEl = document.getElementById('td-sel-toolbar');
  if (toolbarEl) sel.mountToolbar(toolbarEl);

  async function loadPage() {
    const res = await api.tagAssets(tagId, { limit: PAGE, offset });
    const { rows, total } = res.data;
    const startIdx = allAssets.length;
    allAssets = [...allAssets, ...rows];
    offset += rows.length;

    if (grid) {
      rows.forEach((asset, i) => {
        const cell = buildPhotoCell(
          asset,
          () => openLightbox(allAssets, allAssets.indexOf(asset)),
          null,
        );
        sel.attachToCell(cell, asset, startIdx + i);
        cell.addEventListener('contextmenu', (e) => {
          showAssetContextMenu(e, asset, {
            selectionManager: sel,
            openLightboxFn: openLightbox,
            getAllAssets: () => allAssets,
            allAssets,
            index: allAssets.indexOf(asset),
            onDelete: (id) => {
              allAssets = allAssets.filter((a) => a.id !== id);
              grid.querySelector(`[data-id="${id}"]`)?.remove();
            },
          });
        });
        grid.appendChild(cell);
      });
    }

    const moreEl = document.getElementById('td-more');
    if (moreEl) moreEl.classList.toggle('hidden', offset >= total);
  }

  await loadPage();
  document.getElementById('td-more-btn')?.addEventListener('click', loadPage);
}

async function _loadSynonyms(tagId) {
  try {
    const res = await api.tagSynonyms(tagId);
    const el = document.getElementById('td-synonyms');
    if (!el) return;
    const syns = res.data ?? [];
    el.innerHTML = syns.map((s) =>
      `<span class="flex items-center gap-1 px-2 py-0.5 bg-slate-700 rounded-full text-xs text-slate-300">
        ${_esc(s.synonym)}
        <button class="syn-del text-slate-500 hover:text-red-400" data-syn-id="${s.id}">×</button>
      </span>`
    ).join('');
    el.querySelectorAll('.syn-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = /** @type {HTMLElement} */ (btn).dataset.synId;
        if (id) { await api.deleteTagSynonym(id); _loadSynonyms(tagId); }
      });
    });
  } catch {}
}

// ── Redigeringsmodal ──────────────────────────────────────────────────────────
async function _openEditModal(tagId) {
  const node = _flatMap.get(tagId);
  if (!node) return;

  const modal   = document.getElementById('tag-edit-modal');
  const title   = document.getElementById('tem-title');
  const nameEl  = /** @type {HTMLInputElement|null} */ (document.getElementById('tem-name'));
  const colorEl = /** @type {HTMLInputElement|null} */ (document.getElementById('tem-color'));
  const faceEl  = /** @type {HTMLInputElement|null} */ (document.getElementById('tem-face-tag'));
  const leafEl  = /** @type {HTMLInputElement|null} */ (document.getElementById('tem-export-leaf'));
  const lifEl   = /** @type {HTMLInputElement|null} */ (document.getElementById('tem-show-lifespan'));
  const synExEl = /** @type {HTMLInputElement|null} */ (document.getElementById('tem-export-synonyms'));
  const birthEl = /** @type {HTMLInputElement|null} */ (document.getElementById('tem-birth'));
  const deathEl = /** @type {HTMLInputElement|null} */ (document.getElementById('tem-death'));
  const pfEl    = document.getElementById('tem-person-fields');

  if (!modal || !nameEl || !colorEl || !faceEl || !leafEl || !lifEl || !birthEl || !deathEl) return;

  if (title) title.textContent = node.path ?? node.name;
  nameEl.value  = node.name;
  colorEl.value = node.color ?? '#3b82f6';
  faceEl.checked = node.is_face_tag;
  leafEl.checked = node.export_only_leaf ?? _settings?.default_export_only_leaf ?? true;
  lifEl.checked  = node.show_lifespan    ?? _settings?.default_show_lifespan    ?? true;
  if (synExEl) synExEl.checked = node.export_synonyms ?? _settings?.default_export_synonyms ?? true;
  birthEl.value  = node.birth_year ?? '';
  deathEl.value  = node.death_year ?? '';
  const cidEl = document.getElementById('tem-cid');
  if (cidEl) cidEl.value = node.custom_id ?? '';
  const lifRow = document.getElementById('tem-show-lifespan-row');
  const updatePersonFields = () => {
    pfEl?.classList.toggle('hidden', !faceEl.checked);
    lifRow?.classList.toggle('hidden', !faceEl.checked);
  };
  updatePersonFields();

  faceEl.addEventListener('change', updatePersonFields, { once: false });

  // Ladda synonymer i modal
  try {
    const synRes = await api.tagSynonyms(tagId);
    const synEl  = document.getElementById('tem-synonyms');
    /** @type {Array<any>} */
    let synonyms = synRes.data ?? [];
    const renderSyns = () => {
      if (!synEl) return;
      synEl.innerHTML = synonyms.map((s) =>
        `<span class="flex items-center gap-1 px-2 py-0.5 bg-slate-700 rounded-full text-xs text-slate-300">
          ${_esc(s.synonym)}
          <button class="msyn-del hover:text-red-400" data-sid="${s.id}">×</button>
        </span>`
      ).join('');
      synEl.querySelectorAll('.msyn-del').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const sid = /** @type {HTMLElement} */ (btn).dataset.sid;
          if (sid) { await api.deleteTagSynonym(sid); synonyms = synonyms.filter((s) => s.id !== sid); renderSyns(); }
        });
      });
    };
    renderSyns();

    const synInput = /** @type {HTMLInputElement|null} */ (document.getElementById('tem-syn-input'));
    // Klona knappen för att rensa gamla event-lyssnare (annars staplas de vid varje modal-öppning)
    const oldSynAddBtn = document.getElementById('tem-syn-add');
    const synAddBtn = oldSynAddBtn ? /** @type {HTMLElement} */ (oldSynAddBtn.cloneNode(true)) : null;
    if (oldSynAddBtn && synAddBtn) oldSynAddBtn.replaceWith(synAddBtn);
    synAddBtn?.addEventListener('click', async () => {
      const val = synInput?.value.trim();
      if (!val) return;
      try {
        const res = await api.addTagSynonym({ tagId, synonym: val });
        if (!res?.data) { showToast('Synonymen finns redan', 'warn'); return; }
        synonyms.push(res.data);
        if (synInput) synInput.value = '';
        renderSyns();
      } catch (e) { showToast(`Fel: ${/** @type {Error} */ (e).message}`, 'error'); }
    });
    synInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') synAddBtn?.click(); }, { once: false });
  } catch {}

  modal.classList.remove('hidden');

  // Reset-färg-knapp (klona för att undvika staplade lyssnare)
  const oldColorReset = document.getElementById('tem-color-reset');
  const colorResetBtn = oldColorReset ? /** @type {HTMLElement} */ (oldColorReset.cloneNode(true)) : null;
  if (oldColorReset && colorResetBtn) oldColorReset.replaceWith(colorResetBtn);
  colorResetBtn?.addEventListener('click', () => { if (colorEl) colorEl.value = '#000000'; });

  // Spara (klona för att undvika staplade lyssnare)
  const oldSaveBtn = document.getElementById('tem-save');
  const saveBtn = oldSaveBtn ? /** @type {HTMLElement} */ (oldSaveBtn.cloneNode(true)) : null;
  if (oldSaveBtn && saveBtn) oldSaveBtn.replaceWith(saveBtn);
  saveBtn?.addEventListener('click', async () => {
    try {
      await api.patchTag(tagId, {
        name:             nameEl.value.trim(),
        color:            colorEl.value === '#000000' ? null : colorEl.value,
        is_face_tag:      faceEl.checked,
        export_only_leaf: leafEl.checked,
        show_lifespan:    lifEl.checked,
        export_synonyms:  synExEl ? synExEl.checked : true,
        birth_year:       birthEl.value ? Number(birthEl.value) : null,
        death_year:       deathEl.value ? Number(deathEl.value) : null,
        custom_id:        document.getElementById('tem-cid')?.value.trim() || null,
      });
      modal.classList.add('hidden');
      showToast('Tagg sparad', 'success');
      await _loadTree();
      if (_selectedTagId) _showTagDetail(_selectedTagId);
    } catch (e) { showToast(`Fel: ${/** @type {Error} */ (e).message}`, 'error'); }
  });
}

// ── Kontextmeny ───────────────────────────────────────────────────────────────
/**
 * @param {MouseEvent} e
 * @param {string} tagId
 */
function _showContextMenu(e, tagId) {
  e.preventDefault();
  e.stopPropagation();

  const menu = document.getElementById('tag-ctx-menu');
  if (!menu) return;

  const node = _flatMap.get(tagId);
  const hasChildren = node?.children?.length > 0;

  menu.innerHTML = [
    { label: '➕ Ny tagg här (barn)',         action: () => _newTag(tagId) },
    { label: '➕ Ny tagg (syskonnivå)',        action: () => _newTag(node?.parent_id ?? null) },
    { label: '─', separator: true },
    hasChildren && { label: '▼ Expandera nod',  action: () => { _expanded.add(tagId); _renderTree(); } },
    hasChildren && { label: '▶ Dra ihop nod',   action: () => { _expanded.delete(tagId); _renderTree(); } },
    { label: '─', separator: true },
    { label: '🔍 Hitta dubbletter',            action: _showDuplicates },
    { label: '🔀 Slå ihop med…',              action: () => _mergeWith(tagId) },
    { label: '─', separator: true },
    !node?.is_face_tag && { label: '👤 Märk som ansiktstagg', action: () => _markFaceTag(tagId) },
    { label: '✏️  Redigera',                  action: () => _openEditModal(tagId) },
    { label: '🗑  Radera tagg',               action: () => _deleteTag(tagId) },
  ].filter(Boolean).map((item) => {
    if (!item || /** @type {any} */ (item).separator) {
      return '<div class="border-t border-slate-600 my-1"></div>';
    }
    const it = /** @type {{label:string, action:()=>void}} */ (item);
    return `<div class="ctx-item px-3 py-1.5 hover:bg-slate-700 cursor-pointer text-slate-200">${_esc(it.label)}</div>`;
  }).join('');

  const actions = [
    { label: '➕ Ny tagg här (barn)',         action: () => _newTag(tagId) },
    { label: '➕ Ny tagg (syskonnivå)',        action: () => _newTag(node?.parent_id ?? null) },
    null,
    hasChildren ? { label: '▼ Expandera nod',  action: () => { _expanded.add(tagId); _renderTree(); } } : null,
    hasChildren ? { label: '▶ Dra ihop nod',   action: () => { _expanded.delete(tagId); _renderTree(); } } : null,
    null,
    { label: '🔍 Hitta dubbletter',            action: _showDuplicates },
    { label: '🔀 Slå ihop med…',              action: () => _mergeWith(tagId) },
    null,
    !node?.is_face_tag ? { label: '👤 Märk som ansiktstagg', action: () => _markFaceTag(tagId) } : null,
    { label: '✏️  Redigera',                  action: () => _openEditModal(tagId) },
    { label: '🗑  Radera tagg',               action: () => _deleteTag(tagId) },
  ];

  menu.querySelectorAll('.ctx-item').forEach((el, i) => {
    const actionItems = actions.filter((a) => a !== null);
    const act = actionItems[i];
    if (act) el.addEventListener('click', () => { act.action(); menu.classList.add('hidden'); });
  });

  const x = Math.min(e.clientX, window.innerWidth  - menu.offsetWidth  - 8);
  const y = Math.min(e.clientY, window.innerHeight - 300);
  menu.style.left = `${x}px`;
  menu.style.top  = `${y}px`;
  menu.classList.remove('hidden');
}

// ── Kontextmeny-åtgärder ──────────────────────────────────────────────────────

/** @param {string|null} parentId */
function _newTag(parentId) {
  document.getElementById('new-tag-modal')?.remove();
  const parentNode = parentId ? _flatMap.get(parentId) : null;
  const modal = document.createElement('div');
  modal.id = 'new-tag-modal';
  modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
    <div class="relative bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm">
      <div class="flex items-center justify-between px-5 py-4 border-b border-slate-700">
        <h2 class="text-sm font-semibold text-white">Ny tagg${parentNode ? ` under "${_esc(parentNode.name)}"` : ''}</h2>
        <button id="ntm-close" class="text-slate-400 hover:text-white p-1 rounded">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="px-5 py-4">
        <label class="block text-xs font-medium text-slate-400 mb-1.5">Taggnamn</label>
        <input id="ntm-name" type="text" placeholder="Taggnamn…"
          class="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"/>
      </div>
      <div class="flex justify-end gap-2 px-5 py-4 border-t border-slate-700">
        <button id="ntm-cancel" class="px-4 py-2 text-sm text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-lg">Avbryt</button>
        <button id="ntm-ok" class="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg">Skapa</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById('ntm-name'));
  const close = () => modal.remove();
  document.getElementById('ntm-close')?.addEventListener('click', close);
  document.getElementById('ntm-cancel')?.addEventListener('click', close);
  modal.querySelector('.absolute')?.addEventListener('click', close);
  const onKey = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  setTimeout(() => input?.focus(), 50);
  const submit = async () => {
    const name = input?.value.trim();
    if (!name) return;
    try {
      await api.createTag({ name, parent_id: parentId });
      showToast('Tagg skapad', 'success');
      if (parentId) _expanded.add(parentId);
      close();
      await _loadTree();
    } catch (e) { showToast(`Fel: ${/** @type {Error} */ (e).message}`, 'error'); }
  };
  document.getElementById('ntm-ok')?.addEventListener('click', submit);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

/** @param {string} tagId */
async function _deleteTag(tagId) {
  const node = _flatMap.get(tagId);
  if (!node) return;
  if (!confirm(`Radera taggen "${node.name}"?${node.asset_count > 0 ? `\n(${node.asset_count} bilder påverkas)` : ''}`)) return;
  try {
    const res = await api.deleteTag(tagId, node.asset_count > 0);
    const undoData = res.undo;
    toastWithUndo(
      `"${node.name}" raderad`,
      async () => {
        try {
          await api.createTag({ name: undoData.tag.name, parent_id: undoData.tag.parent_id });
          showToast('Åtgärd ångrad', 'success');
          await _loadTree();
        } catch {}
      },
      undefined
    );
    if (_selectedTagId === tagId) _selectedTagId = null;
    await _loadTree();
  } catch (e) { showToast(`Fel: ${/** @type {Error} */ (e).message}`, 'error'); }
}

/** @param {string} tagId */
async function _markFaceTag(tagId) {
  try {
    await api.markFaceTag(tagId);
    showToast('Tagg märkt som ansiktstagg och flyttad till /Personer/', 'success');
    await _loadTree();
  } catch (e) { showToast(`Fel: ${/** @type {Error} */ (e).message}`, 'error'); }
}

/** @param {string} tagId */
function _mergeWith(tagId) {
  const node = _flatMap.get(tagId);
  if (!node) return;
  document.getElementById('merge-tag-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'merge-tag-modal';
  modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
    <div class="relative bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm">
      <div class="flex items-center justify-between px-5 py-4 border-b border-slate-700">
        <h2 class="text-sm font-semibold text-white">Slå ihop tagg</h2>
        <button id="mtm-close" class="text-slate-400 hover:text-white p-1 rounded">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="px-5 py-4 space-y-3">
        <p class="text-sm text-slate-300">Slå ihop <strong class="text-white">${_esc(node.name)}</strong> med:</p>
        <input id="mtm-search" type="text" placeholder="Sök tagg…"
          class="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"/>
        <div id="mtm-results" class="max-h-40 overflow-y-auto space-y-1 bg-slate-900/50 rounded-lg"></div>
        <div id="mtm-selected" class="text-xs text-slate-400 hidden">Vald: <span id="mtm-sel-name" class="text-white"></span></div>
        <p class="text-xs text-amber-400">Källtaggen "${_esc(node.name)}" tas bort. Alla bilder omfördelas.</p>
      </div>
      <div class="flex justify-end gap-2 px-5 py-4 border-t border-slate-700">
        <button id="mtm-cancel" class="px-4 py-2 text-sm text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-lg">Avbryt</button>
        <button id="mtm-ok" class="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg" disabled>Slå ihop</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  let targetId = '';
  const close = () => modal.remove();
  document.getElementById('mtm-close')?.addEventListener('click', close);
  document.getElementById('mtm-cancel')?.addEventListener('click', close);
  modal.querySelector('.absolute')?.addEventListener('click', close);
  const onKey = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  const searchEl = document.getElementById('mtm-search');
  const resultsEl = document.getElementById('mtm-results');
  const okBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('mtm-ok'));
  searchEl?.addEventListener('input', async () => {
    const q = /** @type {HTMLInputElement} */ (searchEl).value.trim();
    if (!q || !resultsEl) return;
    const res = await api.tagAutoSuggest(q);
    resultsEl.innerHTML = (res.data ?? [])
      .filter((t) => t.id !== tagId)
      .map((t) => `<div class="px-2 py-1.5 hover:bg-slate-700 cursor-pointer text-xs text-slate-200 rounded mtm-item" data-id="${t.id}" data-name="${_esc(t.name)}">${_esc(t.path ?? t.name)}</div>`)
      .join('');
    resultsEl.querySelectorAll('.mtm-item').forEach((el) => {
      el.addEventListener('click', () => {
        targetId = /** @type {HTMLElement} */ (el).dataset.id ?? '';
        const tName = /** @type {HTMLElement} */ (el).dataset.name ?? '';
        const selDiv = document.getElementById('mtm-selected');
        const selName = document.getElementById('mtm-sel-name');
        if (selDiv) selDiv.classList.remove('hidden');
        if (selName) selName.textContent = tName;
        if (okBtn) okBtn.disabled = false;
        resultsEl.innerHTML = '';
        /** @type {HTMLInputElement} */ (searchEl).value = '';
      });
    });
  });
  okBtn?.addEventListener('click', async () => {
    if (!targetId) return;
    if (okBtn) { okBtn.disabled = true; okBtn.textContent = 'Slår ihop…'; }
    try {
      await api.mergeTags({ sourceId: tagId, targetId });
      const tName = document.getElementById('mtm-sel-name')?.textContent ?? '';
      showToast(`Slog ihop till "${tName}"`, 'success');
      close();
      await _loadTree();
    } catch (e) {
      showToast(`Fel: ${/** @type {Error} */ (e).message}`, 'error');
      if (okBtn) { okBtn.disabled = false; okBtn.textContent = 'Slå ihop'; }
    }
  });
  setTimeout(() => searchEl?.focus(), 50);
}

async function _showDuplicates() {
  document.getElementById('dup-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'dup-modal';
  modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
    <div class="relative bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">
      <div class="flex items-center justify-between px-5 py-4 border-b border-slate-700 shrink-0">
        <h2 class="text-sm font-semibold text-white">🔍 Möjliga dubbletter</h2>
        <button id="dup-close" class="text-slate-400 hover:text-white p-1 rounded">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div id="dup-body" class="flex-1 overflow-y-auto px-5 py-4 space-y-2 text-xs">
        <p class="text-slate-400">Laddar…</p>
      </div>
      <div class="flex justify-end px-5 py-4 border-t border-slate-700 shrink-0">
        <button id="dup-ok" class="px-4 py-2 text-sm font-medium text-white bg-slate-600 hover:bg-slate-500 rounded-lg">Stäng</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  document.getElementById('dup-close')?.addEventListener('click', close);
  document.getElementById('dup-ok')?.addEventListener('click', close);
  modal.querySelector('.absolute')?.addEventListener('click', close);
  const onKey = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  try {
    const res = await api.tagsDuplicates();
    const body = document.getElementById('dup-body');
    if (!body) return;
    const pairs = res.data ?? [];
    body.innerHTML = pairs.map((d) => `
      <div class="flex items-center gap-2 p-2 bg-slate-900/60 rounded" data-id-a="${_esc(d.id_a)}" data-id-b="${_esc(d.id_b)}" data-name-a="${_esc(d.name_a)}" data-name-b="${_esc(d.name_b)}">
        <div class="flex flex-col min-w-0 flex-1">
          <span class="text-slate-300 text-xs truncate" title="${_esc(d.path_a)}">${_esc(d.name_a)}</span>
          <span class="text-slate-500 text-[10px] truncate">${_esc(d.path_a)}</span>
        </div>
        <span class="text-slate-500 shrink-0">↔</span>
        <div class="flex flex-col min-w-0 flex-1">
          <span class="text-slate-300 text-xs truncate" title="${_esc(d.path_b)}">${_esc(d.name_b)}</span>
          <span class="text-slate-500 text-[10px] truncate">${_esc(d.path_b)}</span>
        </div>
        <span class="text-slate-500 shrink-0 text-[10px]">${Math.round(d.sim * 100)}%</span>
        <button class="dup-merge-btn shrink-0 px-2 py-1 text-[10px] font-medium bg-amber-600 hover:bg-amber-500 text-white rounded">Slå ihop</button>
      </div>`).join('')
      || '<p class="text-slate-500">Inga dubbletter hittades.</p>';

    body.querySelectorAll('.dup-merge-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const row = /** @type {HTMLElement} */ (e.currentTarget).closest('[data-id-a]');
        if (!row) return;
        const idA   = row.dataset.idA ?? '';
        const idB   = row.dataset.idB ?? '';
        const nameA = row.dataset.nameA ?? '';
        const nameB = row.dataset.nameB ?? '';
        _confirmMergeDup(idA, idB, nameA, nameB, row);
      });
    });
  } catch (e) { showToast(`Fel: ${/** @type {Error} */ (e).message}`, 'error'); close(); }
}

/**
 * Visar en modal som bekräftar sammanslagning av två dubbletttaggar.
 * @param {string} idA @param {string} idB @param {string} nameA @param {string} nameB @param {Element} row
 */
function _confirmMergeDup(idA, idB, nameA, nameB, row) {
  document.getElementById('dup-confirm-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'dup-confirm-modal';
  m.className = 'fixed inset-0 z-[10000] flex items-center justify-center p-4';
  m.innerHTML = `
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
    <div class="relative bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm">
      <div class="flex items-center justify-between px-5 py-4 border-b border-slate-700">
        <h2 class="text-sm font-semibold text-white">Bekräfta sammanslagning</h2>
        <button id="dcm-close" class="text-slate-400 hover:text-white p-1 rounded">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="px-5 py-4 space-y-2 text-sm text-slate-300">
        <p>Slå ihop <strong class="text-amber-400">${_esc(nameA)}</strong> in i <strong class="text-white">${_esc(nameB)}</strong>?</p>
        <p class="text-slate-400 text-xs">Alla bilder kopplade till "${_esc(nameA)}" flyttas till "${_esc(nameB)}" och "${_esc(nameA)}" tas bort.</p>
      </div>
      <div class="flex justify-end gap-2 px-5 py-4 border-t border-slate-700">
        <button id="dcm-cancel" class="px-4 py-2 text-sm text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-lg">Avbryt</button>
        <button id="dcm-ok" class="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-500 rounded-lg">Slå ihop</button>
      </div>
    </div>`;
  document.body.appendChild(m);

  const close = () => m.remove();
  m.querySelector('.absolute')?.addEventListener('click', close);
  document.getElementById('dcm-close')?.addEventListener('click', close);
  document.getElementById('dcm-cancel')?.addEventListener('click', close);

  const onKey = (/** @type {KeyboardEvent} */ ev) => { if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);

  document.getElementById('dcm-ok')?.addEventListener('click', async () => {
    const okBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('dcm-ok'));
    if (okBtn) { okBtn.disabled = true; okBtn.textContent = 'Slår ihop…'; }
    try {
      await api.mergeTags({ sourceId: idA, targetId: idB });
      close();
      row.remove();
      showToast(`Slog ihop "${nameA}" → "${nameB}"`, 'success');
      await _loadTree();
    } catch (err) {
      showToast(`Fel: ${/** @type {Error} */ (err).message}`, 'error');
      close();
    }
    document.removeEventListener('keydown', onKey);
  });
}

// ── Mapp→tagg-regler modal ────────────────────────────────────────────────────
async function _openRulesModal() {
  const modal = document.getElementById('tag-rules-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  await _loadRulesList();

  const tagSearchEl = /** @type {HTMLInputElement|null} */ (document.getElementById('trm-tag-search'));
  const tagResultsEl = document.getElementById('trm-tag-results');
  const tagIdEl = /** @type {HTMLInputElement|null} */ (document.getElementById('trm-tag-id'));

  tagSearchEl?.addEventListener('input', async () => {
    const q = tagSearchEl.value.trim();
    if (!q || !tagResultsEl) return;
    const res = await api.tagAutoSuggest(q);
    tagResultsEl.innerHTML = (res.data ?? []).map((t) =>
      `<div class="ctx-item px-2 py-1 hover:bg-slate-700 cursor-pointer text-xs text-slate-200 rounded" data-id="${t.id}" data-name="${_esc(t.name)}">${_esc(t.path ?? t.name)}</div>`
    ).join('');
    tagResultsEl.querySelectorAll('.ctx-item').forEach((el) => {
      el.addEventListener('click', () => {
        const id = /** @type {HTMLElement} */ (el).dataset.id ?? '';
        const name = /** @type {HTMLElement} */ (el).dataset.name ?? '';
        if (tagIdEl) tagIdEl.value = id;
        if (tagSearchEl) tagSearchEl.value = name;
        tagResultsEl.innerHTML = '';
      });
    });
  });

  document.getElementById('trm-add')?.addEventListener('click', async () => {
    const pattern = (/** @type {HTMLInputElement|null} */ (document.getElementById('trm-pattern')))?.value.trim();
    const matchType = (/** @type {HTMLSelectElement|null} */ (document.getElementById('trm-match-type')))?.value;
    const tagId = tagIdEl?.value;
    if (!pattern || !tagId) { showToast('Fyll i mönster och välj tagg', 'error'); return; }
    try {
      await api.createFolderTagRule({ pattern, tagId, match_type: matchType ?? 'folder_name' });
      showToast('Regel skapad', 'success');
      await _loadRulesList();
    } catch (e) { showToast(`Fel: ${/** @type {Error} */ (e).message}`, 'error'); }
  });
}

async function _loadRulesList() {
  const listEl = document.getElementById('trm-list');
  if (!listEl) return;
  const res = await api.folderTagRules();
  listEl.innerHTML = (res.data ?? []).map((r) =>
    `<div class="flex items-center gap-2 p-2 bg-slate-700 rounded text-xs">
      <span class="text-slate-400">${_esc(r.match_type)}</span>
      <span class="text-slate-200 font-mono">${_esc(r.pattern)}</span>
      <span class="text-slate-500">→</span>
      ${r.tag_color ? `<span style="width:8px;height:8px;border-radius:50%;background:${r.tag_color};display:inline-block;"></span>` : ''}
      <span class="text-slate-200">${_esc(r.tag_name)}</span>
      <button class="ml-auto text-slate-500 hover:text-red-400 rule-del" data-id="${r.id}">🗑</button>
    </div>`
  ).join('') || '<p class="text-slate-500 text-xs">Inga regler ännu.</p>';

  listEl.querySelectorAll('.rule-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = /** @type {HTMLElement} */ (btn).dataset.id;
      if (id) { await api.deleteFolderTagRule(id); await _loadRulesList(); }
    });
  });
}

// ── Import/Export ─────────────────────────────────────────────────────────────
function _openExportModal() {
  // Bygg modal
  const existing = document.getElementById('tag-export-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'tag-export-modal';
  modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
    <div class="relative bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm">
      <div class="flex items-center justify-between px-5 py-4 border-b border-slate-700">
        <h2 class="text-sm font-semibold text-white">Exportera taggar</h2>
        <button id="tex-close" class="text-slate-400 hover:text-white p-1 rounded">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="px-5 py-4 space-y-4">
        <div>
          <label class="block text-xs font-medium text-slate-400 mb-2">Format</label>
          <div class="flex gap-2">
            ${['json','csv','xmp'].map((f) => `
              <label class="flex items-center gap-1.5 text-sm text-slate-300 cursor-pointer">
                <input type="radio" name="tex-fmt" value="${f}" ${f==='json'?'checked':''} class="accent-blue-500"> ${f.toUpperCase()}
              </label>`).join('')}
          </div>
        </div>
      </div>
      <div class="flex justify-end gap-2 px-5 py-4 border-t border-slate-700">
        <button id="tex-cancel" class="px-4 py-2 text-sm text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-lg">Avbryt</button>
        <button id="tex-ok" class="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg">Exportera</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById('tex-close')?.addEventListener('click', close);
  document.getElementById('tex-cancel')?.addEventListener('click', close);
  modal.querySelector('.absolute')?.addEventListener('click', close);
  const onKey = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);

  document.getElementById('tex-ok')?.addEventListener('click', async () => {
    const fmt = /** @type {HTMLInputElement|null} */ (modal.querySelector('input[name="tex-fmt"]:checked'))?.value ?? 'json';
    const okBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('tex-ok'));
    if (okBtn) { okBtn.disabled = true; okBtn.textContent = 'Exporterar…'; }

    try {
      const w = /** @type {any} */ (window);
      const headers = { 'Content-Type': 'application/json' };
      if (w.__pmToken) headers['Authorization'] = `Bearer ${w.__pmToken}`;
      const res = await fetch(`/api/tags/export?format=${fmt}`, { headers, credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const ext = fmt === 'json' ? 'json' : fmt === 'csv' ? 'csv' : 'txt';
      downloadBlob(blob, `taggar.${ext}`);
      showToast('Export klar', 'success');
      close();
    } catch (err) {
      showToast(`Export misslyckades: ${/** @type {Error} */ (err).message}`, 'error');
      if (okBtn) { okBtn.disabled = false; okBtn.textContent = 'Exportera'; }
    }
  });
}

function _openImportModal() {
  document.getElementById('tag-import-modal')?.classList.remove('hidden');
}

// ── Statiska event-lyssnare ───────────────────────────────────────────────────
function _bindStaticEvents() {
  // Sök
  document.getElementById('tag-search')?.addEventListener('input', (e) => {
    _searchQ = /** @type {HTMLInputElement} */ (e.target).value;
    _renderTree();
  });

  // Filter-knappar
  document.querySelectorAll('.tag-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      _filter = /** @type {HTMLElement} */ (btn).dataset.filter ?? 'all';
      document.querySelectorAll('.tag-filter-btn').forEach((b) => {
        b.classList.toggle('bg-blue-700', /** @type {HTMLElement} */ (b).dataset.filter === _filter);
        b.classList.toggle('text-white',  /** @type {HTMLElement} */ (b).dataset.filter === _filter);
        b.classList.toggle('bg-slate-800', /** @type {HTMLElement} */ (b).dataset.filter !== _filter);
        b.classList.toggle('text-slate-400', /** @type {HTMLElement} */ (b).dataset.filter !== _filter);
      });

      if (_filter === 'unused') {
        _loadUnusedView();
      } else {
        _renderTree();
      }
    });
  });

  // Träd-klick (delegerat)
  document.getElementById('tag-tree')?.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const arrow = target.closest('.tag-arrow');
    const node  = target.closest('.tag-node');

    if (arrow) {
      const id = /** @type {HTMLElement} */ (arrow).dataset.id ?? '';
      _expanded.has(id) ? _expanded.delete(id) : _expanded.add(id);
      _renderTree();
      return;
    }

    if (node) {
      const id = /** @type {HTMLElement} */ (node).dataset.id ?? '';
      _showTagDetail(id);
    }
  });

  // Dubbelklick → redigera tagg
  document.getElementById('tag-tree')?.addEventListener('dblclick', (e) => {
    const node = /** @type {HTMLElement} */ (e.target).closest('.tag-node');
    if (node) _openEditModal(/** @type {HTMLElement} */ (node).dataset.id ?? '');
  });

  // Klick på ID-badge — kopiera till urklipp
  document.getElementById('tag-tree')?.addEventListener('click', (e) => {
    const badge = /** @type {HTMLElement} */ (e.target).closest('.tag-cid-badge');
    if (!badge) return;
    e.stopPropagation();
    const cid = /** @type {HTMLElement} */ (badge).dataset.cid ?? '';
    navigator.clipboard.writeText(cid).then(() => showToast(`Kopierade ID: ${cid}`, 'success'));
  });

  // Högerklick
  document.getElementById('tag-tree')?.addEventListener('contextmenu', (e) => {
    const badge = /** @type {HTMLElement} */ (e.target).closest('.tag-cid-badge');
    if (badge) {
      e.preventDefault();
      const cid = /** @type {HTMLElement} */ (badge).dataset.cid ?? '';
      navigator.clipboard.writeText(cid).then(() => showToast(`Kopierade ID: ${cid}`, 'success'));
      return;
    }
    const node = /** @type {HTMLElement} */ (e.target).closest('.tag-node');
    if (node) _showContextMenu(/** @type {MouseEvent} */ (e), /** @type {HTMLElement} */ (node).dataset.id ?? '');
  });

  // Drag & drop
  document.getElementById('tag-tree')?.addEventListener('dragstart', (e) => {
    const node = /** @type {HTMLElement} */ (e.target).closest('.tag-node');
    if (node && e.dataTransfer) {
      e.dataTransfer.setData('text/plain', /** @type {HTMLElement} */ (node).dataset.id ?? '');
    }
  });

  document.getElementById('tag-tree')?.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  });

  document.getElementById('tag-tree')?.addEventListener('drop', (e) => {
    e.preventDefault();
    const sourceId = e.dataTransfer?.getData('text/plain');
    const target   = /** @type {HTMLElement} */ (e.target).closest('.tag-node');
    const targetId = target ? /** @type {HTMLElement} */ (target).dataset.id : null;
    if (!sourceId || sourceId === targetId) return;

    const src = _flatMap.get(sourceId);
    const tgt = targetId ? _flatMap.get(targetId) : null;
    const srcIsLeaf = !src?.children?.length;
    const tgtIsLeaf = !tgt?.children?.length;

    // Bygg popup — alltid samma två alternativ
    document.getElementById('drop-confirm-popup')?.remove();
    const popup = document.createElement('div');
    popup.id = 'drop-confirm-popup';
    popup.className = 'fixed z-[9999] bg-slate-800 border border-slate-600 rounded-xl shadow-2xl py-1 min-w-[200px]';
    const destName = tgt ? `"${_esc(tgt.name)}"` : 'rotnivån';

    popup.innerHTML = `
      <div class="px-3 py-1.5 text-xs text-slate-400 border-b border-slate-700 mb-1">Släpp på ${destName}</div>
      <div id="dcp-move" class="px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 cursor-pointer rounded-lg mx-1">📂 Flytta hit</div>
      <div id="dcp-merge" class="px-3 py-2 text-sm text-amber-300 hover:bg-slate-700 cursor-pointer rounded-lg mx-1">🔀 Slå ihop med ${_esc(tgt?.name ?? '')}</div>
      <div id="dcp-cancel" class="px-3 py-2 text-sm text-slate-400 hover:bg-slate-700 cursor-pointer rounded-lg mx-1">Avbryt</div>`;
    const me = /** @type {MouseEvent} */ (e);
    popup.style.left = `${Math.min(me.clientX, window.innerWidth - 220)}px`;
    popup.style.top  = `${Math.min(me.clientY, window.innerHeight - 140)}px`;
    document.body.appendChild(popup);
    const closePopup = () => popup.remove();
    document.getElementById('dcp-cancel')?.addEventListener('click', closePopup);
    setTimeout(() => document.addEventListener('click', closePopup, { once: true }), 10);

    document.getElementById('dcp-move')?.addEventListener('click', async () => {
      closePopup();
      const origParentId = src?.parent_id ?? null;
      try {
        await api.moveTag(sourceId, { newParentId: targetId ?? null });
        if (targetId) _expanded.add(targetId);
        await _loadTree();
        toastWithUndo(
          `"${src?.name}" flyttad`,
          async () => {
            await api.moveTag(sourceId, { newParentId: origParentId });
            await _loadTree();
          },
          undefined
        );
      } catch (err) { showToast(`Fel: ${/** @type {Error} */ (err).message}`, 'error'); }
    });

    document.getElementById('dcp-merge')?.addEventListener('click', () => {
      closePopup();
      _mergeWith(sourceId);
    });
  });

  // Stäng kontextmeny
  document.addEventListener('click', () => {
    document.getElementById('tag-ctx-menu')?.classList.add('hidden');
  });

  // Header-knappar
  document.getElementById('tag-btn-new')?.addEventListener('click', () => _newTag(null));
  document.getElementById('tag-btn-export')?.addEventListener('click', _openExportModal);
  document.getElementById('tag-btn-import')?.addEventListener('click', _openImportModal);

  // Modal-stäng-knappar
  const _closeEditModal = () => document.getElementById('tag-edit-modal')?.classList.add('hidden');
  document.getElementById('tem-cancel')?.addEventListener('click', _closeEditModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('tag-edit-modal')?.classList.contains('hidden')) {
      _closeEditModal();
    }
  });
  document.getElementById('tim-cancel')?.addEventListener('click', () => {
    document.getElementById('tag-import-modal')?.classList.add('hidden');
  });
  document.getElementById('trm-close')?.addEventListener('click', () => {
    document.getElementById('tag-rules-modal')?.classList.add('hidden');
  });

  // Import-OK
  document.getElementById('tim-ok')?.addEventListener('click', async () => {
    const fileEl = /** @type {HTMLInputElement|null} */ (document.getElementById('tim-file'));
    const conflict = (/** @type {HTMLSelectElement|null} */ (document.getElementById('tim-conflict')))?.value ?? 'skip';
    if (!fileEl?.files?.length) { showToast('Välj en fil', 'error'); return; }
    const fd = new FormData();
    fd.append('file', fileEl.files[0]);
    try {
      const res = await api.importTags(fd, conflict);
      document.getElementById('tag-import-modal')?.classList.add('hidden');
      showToast(`Import klar: ${res.data.created} skapade, ${res.data.skipped} hoppades över`, 'success');
      await _loadTree();
    } catch (e) { showToast(`Fel: ${/** @type {Error} */ (e).message}`, 'error'); }
  });
}

async function _loadUnusedView() {
  const tree = _treeEl();
  tree.innerHTML = '<p class="text-slate-500 text-xs p-3">Laddar…</p>';
  try {
    const res = await api.tagsUnused();
    tree.innerHTML = (res.data ?? []).map((t) => _nodeHtml(t, 0)).join('') ||
      '<p class="text-slate-500 text-xs p-3">Inga oanvända taggar.</p>';
  } catch (e) {
    tree.innerHTML = `<p class="text-red-400 text-xs p-3">${e.message}</p>`;
  }
}

// ── Hjälpfunktioner ───────────────────────────────────────────────────────────
function _treeEl() {
  return /** @type {HTMLElement} */ (document.getElementById('tag-tree') ?? document.createElement('div'));
}

/** @param {string} s @returns {string} */
function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
