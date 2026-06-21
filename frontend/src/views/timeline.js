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

  container.innerHTML = `
    <div class="p-4">
      <!-- Sort-bar -->
      <div class="flex items-center gap-3 mb-2 flex-wrap">
        <span class="text-sm text-slate-400">Sortera:</span>
        ${[
          ['taken_at',   'Datum'],
          ['file_size',  'Storlek'],
          ['view_count', 'Populärast'],
          ['indexed_at', 'Tillagd'],
        ].map(([val, label]) => `
          <button data-sort="${val}" class="sort-btn text-sm px-3 py-1 rounded-full border border-slate-700
            ${(params.sort ?? 'taken_at') === val ? 'bg-blue-600 border-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'}">
            ${label}
          </button>`).join('')}
        <button id="sort-order-toggle" class="text-slate-400 hover:text-white text-sm flex items-center gap-1">
          <span id="sort-order-label">${params.order === 'asc' ? '↑ Äldst' : '↓ Senast'}</span>
        </button>
      </div>

      <!-- Urvals-toolbar -->
      <div id="selection-toolbar" class="flex items-center gap-3 mb-3 flex-wrap min-h-[28px]"></div>

      <!-- Grid -->
      <div id="photo-grid" class="grid gap-0.5"
        style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))">
      </div>

      <!-- Spinner-sentinel -->
      <div id="grid-sentinel" class="h-16 flex items-center justify-center mt-4">
        <div class="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    </div>`;

  // Sort-knappar
  container.querySelectorAll('.sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sort = btn.dataset.sort;
      renderTimeline(container, { ...currentParams, sort });
    });
  });

  // Order-toggle
  container.querySelector('#sort-order-toggle').addEventListener('click', () => {
    const order = currentParams.order === 'asc' ? 'desc' : 'asc';
    renderTimeline(container, { ...currentParams, order });
  });

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
        openLightboxFn: openLightbox,
        allAssets: allItems,
        index: globalIndex,
        onAddToAlbum: openAddToAlbumModal,
        onDelete: (id) => { allItems = allItems.filter((a) => a.id !== id); },
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
