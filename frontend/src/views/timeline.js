import { api } from '../api.js';
import { openLightbox } from '../components/lightbox.js';
import { thumbUrl, isVideo, formatDate, debounce } from '../utils.js';

let cursor = null;
let loading = false;
let hasMore = true;
let allItems = [];
let currentParams = {};
let sentinel = null;
let observer = null;

export function renderTimeline(container, params = {}) {
  currentParams = params;
  cursor  = null;
  hasMore = true;
  allItems = [];

  container.innerHTML = `
    <div class="p-4">
      <!-- Sort-bar -->
      <div class="flex items-center gap-3 mb-4 flex-wrap">
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
        <button id="sort-order-toggle" class="ml-auto text-slate-400 hover:text-white text-sm flex items-center gap-1">
          <span id="sort-order-label">${params.order === 'asc' ? '↑ Äldst' : '↓ Senast'}</span>
        </button>
      </div>

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
      || !!currentParams.dateFrom || !!currentParams.mimeType;

    const params = { ...currentParams, limit: 50 };
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
    const cell = document.createElement('div');
    cell.className = 'photo-cell relative group';
    cell.innerHTML = `
      <img src="/thumbs/${asset.thumb_small_path}"
           loading="lazy"
           alt="${asset.file_name}"
           class="w-full h-full object-cover">
      ${isVideo(asset.mime_type) ? `
        <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div class="bg-black/50 rounded-full p-2">
            <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        </div>` : ''}
      <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors"></div>
    `;
    cell.addEventListener('click', () => openLightbox(allItems, globalIndex));
    grid.appendChild(cell);
  });
}

function onSentinelVisible(entries) {
  if (entries[0].isIntersecting) loadMore();
}

export function destroyTimeline() {
  observer?.disconnect();
  observer = null;
}
