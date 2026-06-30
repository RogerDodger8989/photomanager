import { api } from '../api.js';
import { openLightbox } from '../components/lightbox.js';
import { buildPhotoCell, showAssetContextMenu, refreshCellOverlay, refreshCellStackBadge } from '../components/gridCell.js';
import { createSelectionManager } from '../components/selectionManager.js';
import { openAddToAlbumModal } from './albums.js';
import { thumbUrl, isVideo, formatDate, debounce } from '../utils.js';
import { getThumbSettings } from '../components/thumbSettings.js';
import { expandStack, collapseStack, openStackModal, dissolveStackOp } from '../components/contextActions/stackAction.js';

let cursor = null;
let loading = false;
let hasMore = true;
let allItems = [];
let currentParams = {};
let sentinel = null;

export function getNavState() { return Object.keys(currentParams).length ? { ...currentParams } : null; }
let observer = null;
let selection = null;
let _thumbSize = parseInt(localStorage.getItem('tl-thumb-size') ?? '160', 10);
let _thumbSettings = null;
let expandedStacks = new Set();
let _focusedIdx = -1;

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

// Kortkommandon för flagg, betyg och färg (aktiva när Bilder-vyn är öppen)
document.addEventListener('keydown', async (e) => {
  if (document.getElementById('lightbox')?.classList.contains('open')) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (!document.getElementById('photo-grid')) return; // bara aktiv i Bilder-vyn

  const key = e.key.toLowerCase();
  const targets = _getShortcutTargets();
  if (!targets.length) return;

  // Flagga: p=röd flagga (1), x/u=ta bort flagga (0)
  if (key === 'p') { e.preventDefault(); await _applyToTargets(targets, { flag: 1 }); }
  else if (key === 'x' || key === 'u') { e.preventDefault(); await _applyToTargets(targets, { flag: 0 }); }
  // Betyg: 1–5
  else if (['1','2','3','4','5'].includes(e.key) && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    await _applyToTargets(targets, { rating: Number(e.key) });
  }
  // Färg: 6=röd, 7=gul, 8=grön, 9=blå, 0=ingen
  else if (['6','7','8','9','0'].includes(e.key) && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    const colorMap = { '6': 1, '7': 2, '8': 3, '9': 4, '0': 0 };
    await _applyToTargets(targets, { colorLabel: colorMap[e.key] });
  }
});

function _getShortcutTargets() {
  if (!selection) return [];
  const sel = selection.getSelected();
  if (sel.size > 0) return allItems.filter((a) => sel.has(a.id));
  // Ingen markering — kolla fokuserad cell
  const focused = document.querySelector('.photo-cell:focus, .photo-cell.ring-2');
  if (focused) {
    const id = /** @type {HTMLElement} */ (focused).dataset.id;
    return allItems.filter((a) => a.id === id);
  }
  return [];
}

async function _applyToTargets(targets, patch) {
  const { toast } = await import('../utils.js');
  await Promise.all(targets.map((asset) => api.patchMeta(asset.id, patch).then(() => {
    if (patch.flag !== undefined)       asset.flag        = patch.flag;
    if (patch.rating !== undefined)     asset.rating      = patch.rating;
    if (patch.colorLabel !== undefined) asset.color_label = patch.colorLabel;
    refreshCellOverlay(asset);
  }).catch(() => {})));
  const n = targets.length;
  const what = patch.flag !== undefined
    ? patch.flag === 0 ? 'Flagga borttagen' : 'Flagga satt'
    : patch.rating !== undefined ? `Betyg ${patch.rating} ⭐`
    : patch.colorLabel !== undefined ? (patch.colorLabel === 0 ? 'Färg borttagen' : 'Färg satt')
    : '';
  toast(`${what}${n > 1 ? ` (${n} bilder)` : ''}`, 'success');
}

// ── Tangentbordsnavigering i grid ─────────────────────────────────────────────

function _countCols() {
  const grid = document.getElementById('photo-grid');
  if (!grid) return 1;
  const cells = /** @type {NodeListOf<HTMLElement>} */ (grid.querySelectorAll('.photo-cell'));
  if (cells.length < 2) return 1;
  const firstTop = cells[0].getBoundingClientRect().top;
  let cols = 0;
  while (cols < cells.length && Math.abs(cells[cols].getBoundingClientRect().top - firstTop) < 4) cols++;
  return Math.max(1, cols);
}

function _focusCell(idx, smooth = true) {
  const grid = document.getElementById('photo-grid');
  if (!grid) return;
  const cells = /** @type {NodeListOf<HTMLElement>} */ (grid.querySelectorAll('.photo-cell'));
  if (!cells.length || idx < 0 || idx >= cells.length) return;

  // Ta bort outline från föregående fokus
  if (_focusedIdx >= 0 && _focusedIdx < cells.length) {
    cells[_focusedIdx].style.outline = '';
    cells[_focusedIdx].style.outlineOffset = '';
    cells[_focusedIdx].removeAttribute('tabindex');
  }

  _focusedIdx = idx;
  const cell = cells[idx];
  cell.tabIndex = 0;
  cell.style.outline = '2px solid #60a5fa';
  cell.style.outlineOffset = '-2px';
  cell.focus({ preventScroll: true });
  if (smooth) cell.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

document.addEventListener('keydown', (e) => {
  if (document.getElementById('lightbox')?.classList.contains('open')) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const grid = document.getElementById('photo-grid');
  if (!grid) return;

  // Ctrl+A — markera alla
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    selection?.selectAll();
    return;
  }

  const navKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
  if (!navKeys.includes(e.key)) return;

  const cells = /** @type {NodeListOf<HTMLElement>} */ (grid.querySelectorAll('.photo-cell'));
  const total = cells.length;
  if (!total) return;
  e.preventDefault();

  // Sätt startfokus om inget är fokuserat
  if (_focusedIdx < 0 || _focusedIdx >= total) {
    _focusCell(0);
    return;
  }

  const cols = _countCols();

  if (e.key === 'ArrowRight') {
    _focusCell(Math.min(_focusedIdx + 1, total - 1));
  } else if (e.key === 'ArrowLeft') {
    _focusCell(Math.max(_focusedIdx - 1, 0));
  } else if (e.key === 'ArrowDown') {
    const next = _focusedIdx + cols;
    _focusCell(Math.min(next, total - 1));
  } else if (e.key === 'ArrowUp') {
    _focusCell(Math.max(_focusedIdx - cols, 0));
  } else if (e.key === 'Enter') {
    const cell = cells[_focusedIdx];
    const id = cell?.dataset.id;
    const idx = allItems.findIndex((a) => a.id === id);
    if (idx >= 0) openLightbox(allItems, idx);
  } else if (e.key === ' ') {
    const cell = cells[_focusedIdx];
    const id = cell?.dataset.id;
    const idx = allItems.findIndex((a) => a.id === id);
    if (idx >= 0 && selection) selection.toggle(id, idx, { ctrlKey: true });
  }
});

// Stack-badge click från celler som inte byggdes via buildPhotoCell med onExpandStack
document.addEventListener('pm:stack-badge-click', (e) => {
  const assetId = /** @type {CustomEvent} */ (e).detail?.assetId;
  if (!assetId) return;
  const asset = allItems.find((a) => a.id === assetId);
  if (!asset?.stack_id) return;
  const grid = document.getElementById('photo-grid');
  if (!grid) return;
  if (expandedStacks.has(asset.stack_id)) collapseStack(asset, { grid, expandedStacks });
  else expandStack(asset, { grid, allItems, thumbSettings: _thumbSettings, expandedStacks,
    onCellBuilt: (cell, member) => selection?.attachToCell(cell, member, allItems.findIndex((x) => x.id === member.id)) });
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

window.addEventListener('pm:asset-added', (e) => {
  const { asset } = /** @type {CustomEvent} */ (e).detail ?? {};
  if (!asset) return;
  // Push to end so lightbox's currentIndex isn't shifted for open sessions
  allItems.push(asset);
  const grid = document.getElementById('photo-grid');
  if (!grid) return;
  const cell = buildPhotoCell(asset, () => openLightbox(allItems, allItems.indexOf(asset)));
  selection?.attachToCell(cell, asset, allItems.length - 1);
  grid.prepend(cell);
  _virt.observe(cell);
});

export function renderTimeline(container, params = {}) {
  _virt.disconnect(); // rensa virtualisering från föregående vy
  currentParams = params;
  cursor  = null;
  hasMore = true;
  allItems = [];
  expandedStacks = new Set();
  _focusedIdx = -1;

  const sortLabel = { taken_at: 'Datum taget', file_size: 'Storlek', view_count: 'Populärast', indexed_at: 'Tillagd', file_name: 'Filnamn', rating: 'Betyg' };
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
  window.__pmCurrentSelection = {
    getSelected: () => selection?.getSelected(),
    getAllItems: () => allItems,
    onDone: () => { allItems = []; renderTimeline(document.getElementById('main-content'), currentParams); },
  };

  // Hämta thumbSettings asynkront, ladda sedan gridet
  getThumbSettings().then((ts) => {
    _thumbSettings = ts;
    loadMore();
  });
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
      undefined,
      _thumbSettings,
      {
        onExpandStack: (a) => {
          const g = document.getElementById('photo-grid');
          if (!g) return;
          if (expandedStacks.has(a.stack_id)) collapseStack(a, { grid: g, expandedStacks });
          else expandStack(a, { grid: g, allItems, thumbSettings: _thumbSettings, expandedStacks,
            onCellBuilt: (cell, member) => selection?.attachToCell(cell, member, allItems.findIndex((x) => x.id === member.id)) });
        },
      },
    );
    selection?.attachToCell(cell, asset, globalIndex);

    // Spåra musklick för att synka _focusedIdx med tangentbordsnavigering
    cell.addEventListener('mousedown', () => {
      const cells = grid.querySelectorAll('.photo-cell');
      const clickedIdx = Array.from(cells).indexOf(cell);
      if (clickedIdx >= 0) {
        // Rensa outline från föregående kb-fokus
        if (_focusedIdx >= 0 && _focusedIdx < cells.length && _focusedIdx !== clickedIdx) {
          /** @type {HTMLElement} */ (cells[_focusedIdx]).style.outline = '';
          /** @type {HTMLElement} */ (cells[_focusedIdx]).style.outlineOffset = '';
        }
        _focusedIdx = clickedIdx;
      }
    }, { capture: true });

    // ── Kontextmeny ────────────────────────────────────────────────────────
    cell.addEventListener('contextmenu', (e) => {
      // Högerklick på ej markerat objekt → välj bara detta (Digikam/Lightroom-beteende)
      // Högerklick på redan markerat i multi-urval → behåll hela urvalet
      if (selection && !selection.isSelected(asset.id)) {
        selection.toggle(asset.id, globalIndex, {}); // {} = plain → clear + select only this
      }
      showAssetContextMenu(e, asset, {
        selectionManager: selection,
        getAllAssets: () => allItems,
        openLightboxFn: openLightbox,
        allAssets: allItems,
        index: globalIndex,
        onAddToAlbum: openAddToAlbumModal,
        onDelete: (id) => { allItems = allItems.filter((a) => a.id !== id); },
        onRefresh: () => { expandedStacks = new Set(); allItems = []; renderTimeline(document.getElementById('main-content'), currentParams); },

        // Stack DOM-callbacks (undviker full omladdning)
        onStackCreated: (stackId, coverAssetId, memberIds) => {
          memberIds.filter((id) => id !== coverAssetId).forEach((id) => {
            allItems = allItems.filter((a) => a.id !== id);
            grid.querySelector(`[data-id="${id}"]`)?.remove();
          });
          const cover = allItems.find((a) => a.id === coverAssetId);
          if (cover) { cover.stack_id = stackId; cover.stack_size = memberIds.length; }
          const coverCell = grid.querySelector(`[data-id="${coverAssetId}"]`);
          if (coverCell) coverCell.dataset.stackId = stackId;
          refreshCellStackBadge(coverAssetId, memberIds.length);
        },
        onRemoved: (removedId, res) => {
          if (res?.stackDeleted) {
            allItems.forEach((a) => { if (a.stack_id === asset.stack_id) { a.stack_id = null; a.stack_size = null; } });
            grid.querySelectorAll(`[data-stack-id="${asset.stack_id}"]`).forEach((c) => {
              c.querySelector('.photo-img-wrap')?.classList.remove('is-stack-wrap');
              c.querySelector('.stack-badge')?.remove();
            });
          } else {
            const cover = allItems.find((a) => a.stack_id === asset.stack_id && a.id !== removedId);
            if (cover) { cover.stack_size = Math.max(1, (cover.stack_size ?? 2) - 1); refreshCellStackBadge(cover.id, cover.stack_size); }
            grid.querySelector(`[data-stack-member="${asset.stack_id}"][data-id="${removedId}"]`)?.remove();
          }
        },

        // Expand / Collapse
        isExpanded: (stackId) => expandedStacks.has(stackId),
        onExpandStack: (a) => expandStack(a, { grid, allItems, thumbSettings: _thumbSettings, expandedStacks,
          onCellBuilt: (cell, member) => selection?.attachToCell(cell, member, allItems.findIndex((x) => x.id === member.id)) }),
        onCollapseStack: (a) => collapseStack(a, { grid, expandedStacks }),

        // Hantera stack-modal
        onManageStack: (a) => openStackModal(a, {
          onMemberRemoved: (removedId, res) => {
            if (res?.stackDeleted) {
              allItems.forEach((item) => { if (item.stack_id === a.stack_id) { item.stack_id = null; item.stack_size = null; } });
              grid.querySelectorAll(`[data-stack-member="${a.stack_id}"]`).forEach((el) => el.remove());
              grid.querySelectorAll(`[data-stack-id="${a.stack_id}"]`).forEach((c) => {
                c.querySelector('.photo-img-wrap')?.classList.remove('is-stack-wrap', 'overflow-visible');
                c.querySelector('.photo-img-wrap')?.classList.add('overflow-hidden');
                c.querySelector('.stack-badge')?.remove();
              });
              expandedStacks.delete(a.stack_id);
            } else {
              grid.querySelector(`[data-stack-member="${a.stack_id}"][data-id="${removedId}"]`)?.remove();
              const cover = allItems.find((item) => item.stack_id === a.stack_id && item.id !== removedId);
              if (cover) { cover.stack_size = Math.max(1, (cover.stack_size ?? 2) - 1); refreshCellStackBadge(cover.id, cover.stack_size); }
            }
          },
          onDissolve: () => {
            allItems.forEach((item) => { if (item.stack_id === a.stack_id) { item.stack_id = null; item.stack_size = null; } });
            grid.querySelectorAll(`[data-stack-member="${a.stack_id}"]`).forEach((el) => el.remove());
            grid.querySelectorAll(`[data-stack-id="${a.stack_id}"]`).forEach((c) => {
              c.querySelector('.photo-img-wrap')?.classList.remove('is-stack-wrap');
              c.querySelector('.stack-badge')?.remove();
            });
            expandedStacks.delete(a.stack_id);
          },
          onCoverChanged: () => {},
        }),

        // Lös upp stack direkt
        onDissolveStack: (a) => dissolveStackOp(a, { grid, allItems, expandedStacks }),
      });
    });

    // ── Drag-and-drop: drop target (cellerna är redan draggable via buildPhotoCell) ──
    cell.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types?.includes('text/plain')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      cell.classList.add('drop-target');
    });

    cell.addEventListener('dragleave', (e) => {
      if (!cell.contains(/** @type {Node} */ (e.relatedTarget))) cell.classList.remove('drop-target');
    });

    cell.addEventListener('drop', async (e) => {
      e.preventDefault();
      cell.classList.remove('drop-target');

      let dragData;
      try { dragData = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      const { id: srcId } = dragData;
      if (!srcId || srcId === asset.id) return;

      const srcAsset = allItems.find((a) => a.id === srcId);
      if (!srcAsset) return;

      const { toast } = await import('../utils.js');

      if (asset.stack_id) {
        if (!confirm(`Lägg till "${srcAsset.file_name ?? srcId}" i stacken?`)) return;
        try {
          await api.addToStack(asset.stack_id, { assetIds: [srcId] });
          toast('Bilden lagd i stacken', 'success');
          allItems = allItems.filter((a) => a.id !== srcId);
          grid.querySelector(`[data-id="${srcId}"]`)?.remove();
          const cover = allItems.find((a) => a.id === asset.id);
          if (cover) { cover.stack_size = (cover.stack_size ?? 1) + 1; refreshCellStackBadge(asset.id, cover.stack_size); }
        } catch (err) {
          toast('Kunde inte lägga till i stack: ' + err.message, 'error');
        }
      } else {
        if (!confirm(`Skapa stack av "${srcAsset.file_name ?? srcId}" och "${asset.file_name ?? asset.id}"?`)) return;
        try {
          const { data } = await api.createStack({ assetIds: [asset.id, srcId], coverId: asset.id });
          toast('Stack skapad med 2 bilder', 'success');
          allItems = allItems.filter((a) => a.id !== srcId);
          grid.querySelector(`[data-id="${srcId}"]`)?.remove();
          const cover = allItems.find((a) => a.id === asset.id);
          if (cover) { cover.stack_id = data.stackId; cover.stack_size = 2; }
          cell.dataset.stackId = data.stackId;
          refreshCellStackBadge(asset.id, 2);
        } catch (err) {
          toast('Kunde inte skapa stack: ' + err.message, 'error');
        }
      }
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
  window.__pmCurrentSelection = null;
}
