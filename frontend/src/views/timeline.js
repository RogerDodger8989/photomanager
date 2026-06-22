import { api } from '../api.js';
import { openLightbox } from '../components/lightbox.js';
import { buildPhotoCell, showAssetContextMenu } from '../components/gridCell.js';
import { createSelectionManager } from '../components/selectionManager.js';
import { openAddToAlbumModal } from './albums.js';
import { thumbUrl, isVideo, formatDate, debounce } from '../utils.js';

let cursor = null;
let loading = false;
let hasMore = true;
let allItems = [];
let currentParams = {};
let sentinel = null;
let observer = null;
let selection = null;
let _thumbSize = parseInt(localStorage.getItem('tl-thumb-size') ?? '160', 10);

function _applyThumbSize(px) {
  _thumbSize = px;
  localStorage.setItem('tl-thumb-size', String(px));
  const grid = document.getElementById('photo-grid');
  if (grid) grid.style.gridTemplateColumns = `repeat(auto-fill,minmax(${px}px,1fr))`;
  document.querySelectorAll('.tl-size-btn').forEach((btn) => {
    const active = /** @type {HTMLElement} */ (btn).dataset.size === String(px);
    btn.classList.toggle('bg-slate-600', active);
    btn.classList.toggle('text-white',   active);
    btn.classList.toggle('text-slate-400', !active);
  });
}

// Virtuell urladdning: celler utanför ~3× viewport får sin img.src rensad för att spara minne
const _virt = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const img = /** @type {HTMLElement} */ (entry.target).querySelector('img');
    if (!img) continue;
    if (entry.isIntersecting) {
      const stored = /** @type {HTMLElement} */ (entry.target).dataset.vsrc;
      if (stored && /** @type {HTMLImageElement} */ (img).src !== stored) {
        /** @type {HTMLImageElement} */ (img).src = stored;
      }
    } else {
      const realSrc = /** @type {HTMLImageElement} */ (img).src;
      if (realSrc && !realSrc.endsWith('placeholder.svg')) {
        /** @type {HTMLElement} */ (entry.target).dataset.vsrc = realSrc;
        /** @type {HTMLImageElement} */ (img).src = '';
      }
    }
  }
}, { rootMargin: '300% 0px' });

// DEL-tangent: radera markerade bilder när lightbox är stängd och inget inputfält är aktivt
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Delete') return;
  if (document.getElementById('lightbox')?.classList.contains('open')) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (selection) selection.deleteSelected();
});

// Synka grid när lightbox raderar/återställer en bild
window.addEventListener('pm:asset-trashed', (e) => {
  const id = /** @type {CustomEvent} */ (e).detail?.id;
  if (!id) return;
  allItems = allItems.filter((a) => a.id !== id);
  document.getElementById('photo-grid')?.querySelector(`[data-id="${id}"]`)?.remove();
});

window.addEventListener('pm:asset-restored', (e) => {
  const { asset, index } = /** @type {CustomEvent} */ (e).detail ?? {};
  if (!asset) return;
  const insertAt = typeof index === 'number' ? index : allItems.length;
  allItems.splice(insertAt, 0, asset);
  const grid = document.getElementById('photo-grid');
  if (!grid) return;
  const cell = buildPhotoCell(asset, () => openLightbox(allItems, allItems.indexOf(asset)));
  selection?.attachToCell(cell, asset, insertAt);
  grid.insertBefore(cell, grid.children[insertAt] ?? null);
  _virt.observe(cell);
});

export function renderTimeline(container, params = {}) {
  _virt.disconnect(); // rensa virtualisering från föregående vy
  currentParams = params;
  cursor  = null;
  hasMore = true;
  allItems = [];

  const sortLabel = { taken_at: 'Datum taget', file_size: 'Storlek', view_count: 'Populärast', indexed_at: 'Tillagd', file_name: 'Filnamn' };
  const curSort  = params.sort ?? 'taken_at';
  const curOrder = params.order ?? 'desc';

  container.innerHTML = `
    <div class="p-4">
      <!-- Toolbar -->
      <div class="flex items-center gap-2 mb-3 flex-wrap">
        <!-- Urvals-toolbar (växer och tar plats till vänster) -->
        <div id="selection-toolbar" class="flex items-center gap-3 flex-wrap flex-1 min-h-[28px]"></div>

        <!-- Sort-dropdown -->
        <select id="tl-sort-select" class="bg-slate-800 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1 cursor-pointer hover:border-slate-400 transition-colors shrink-0">
          ${Object.entries(sortLabel).map(([val, lbl]) =>
            `<option value="${val}"${curSort === val ? ' selected' : ''}>${lbl}</option>`
          ).join('')}
        </select>

        <!-- Order-toggle -->
        <button id="tl-order-btn" title="${curOrder === 'asc' ? 'Stigande' : 'Fallande'}"
          class="p-1.5 rounded hover:bg-slate-700 text-slate-300 hover:text-white transition-colors shrink-0">
          ${curOrder === 'asc'
            ? '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 4h13M3 8h9M3 12h5m10 4l-4-4m0 0l-4 4m4-4v12"/></svg>'
            : '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 4h13M3 8h9M3 12h5m10-4l-4 4m0 0l-4-4m4 4V4"/></svg>'}
        </button>

        <div class="w-px h-5 bg-slate-700 shrink-0"></div>

        <!-- S/M/L thumbnail-storlek -->
        <div class="flex gap-0.5 shrink-0">
          <button data-size="80"  class="tl-size-btn px-2 py-1 text-xs rounded transition-colors">S</button>
          <button data-size="160" class="tl-size-btn px-2 py-1 text-xs rounded transition-colors">M</button>
          <button data-size="240" class="tl-size-btn px-2 py-1 text-xs rounded transition-colors">L</button>
        </div>
      </div>

      <!-- Grid -->
      <div id="photo-grid" class="grid gap-0.5"
        style="grid-template-columns: repeat(auto-fill, minmax(${_thumbSize}px, 1fr))">
      </div>

      <!-- Spinner-sentinel -->
      <div id="grid-sentinel" class="h-16 flex items-center justify-center mt-4">
        <div class="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    </div>`;

  // Sort-dropdown
  container.querySelector('#tl-sort-select')?.addEventListener('change', (e) => {
    const sort = /** @type {HTMLSelectElement} */ (e.target).value;
    renderTimeline(container, { ...currentParams, sort });
  });

  // Order-toggle
  container.querySelector('#tl-order-btn')?.addEventListener('click', () => {
    const order = (currentParams.order ?? 'desc') === 'asc' ? 'desc' : 'asc';
    renderTimeline(container, { ...currentParams, order });
  });

  // S/M/L
  container.querySelectorAll('.tl-size-btn').forEach((btn) => {
    btn.addEventListener('click', () => _applyThumbSize(parseInt(/** @type {HTMLElement} */ (btn).dataset.size ?? '160', 10)));
  });
  _applyThumbSize(_thumbSize);

  sentinel = container.querySelector('#grid-sentinel');
  observer = new IntersectionObserver(onSentinelVisible, { rootMargin: '200px' });
  observer.observe(sentinel);

  // Urval
  selection = createSelectionManager(
    () => document.getElementById('photo-grid'),
    () => allItems,
  );
  selection.mountToolbar(container.querySelector('#selection-toolbar'));

  loadMore();
}

async function loadMore() {
  if (loading || !hasMore) {
    sentinel?.classList.add('hidden');
    return;
  }
  loading = true;

  try {
    const isSearch = !!currentParams.q || !!currentParams.tags || !!currentParams.personId
      || !!currentParams.personIds || !!currentParams.dateFrom || !!currentParams.mimeType;

    const params = /** @type {Record<string, any>} */ ({ ...currentParams, limit: 50 });
    if (cursor) params.cursor = cursor;

    const res = isSearch
      ? await api.search(params)
      : await api.assets(params);

    const { data, meta } = res;
    allItems.push(...data);
    appendToGrid(data);

    hasMore  = meta.hasMore;
    cursor   = meta.nextCursor;
    if (!hasMore) sentinel?.classList.add('hidden');
  } catch (err) {
    console.error(err);
  } finally {
    loading = false;
  }
}

function appendToGrid(items) {
  const grid = document.getElementById('photo-grid');
  if (!grid) return;

  items.forEach((asset, i) => {
    const globalIndex = allItems.length - items.length + i;
    const cell = buildPhotoCell(
      asset,
      () => openLightbox(allItems, globalIndex),
    );
    selection?.attachToCell(cell, asset, globalIndex);
    cell.addEventListener('contextmenu', (e) => {
      showAssetContextMenu(e, asset, {
        selectionManager: selection,
        getAllAssets: () => allItems,
        openLightboxFn: openLightbox,
        allAssets: allItems,
        index: globalIndex,
        onAddToAlbum: openAddToAlbumModal,
        onDelete: (id) => { allItems = allItems.filter((a) => a.id !== id); },
        onRefresh: () => { allItems = []; renderTimeline(document.getElementById('main-content'), currentParams); },
      });
    });
    grid.appendChild(cell);
    _virt.observe(cell);
  });
}

function onSentinelVisible(entries) {
  if (entries[0].isIntersecting) loadMore();
}

export function destroyTimeline() {
  observer?.disconnect();
  observer = null;
}
