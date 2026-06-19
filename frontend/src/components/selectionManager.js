import { api } from '../api.js';
import { showUndoToast } from './lightbox.js';
import { openAddToAlbumModal } from '../views/albums.js';

/**
 * Hanterar multi-select för ett fotogalleri.
 *
 * Användning:
 *   const sel = createSelectionManager(gridEl, getAllAssets);
 *   // sedan i buildPhotoCell: sel.attachToCell(cell, asset, idx)
 *   // och i vyn: sel.mountToolbar(toolbarEl)
 */
export function createSelectionManager(getGrid, getAllAssets) {
  const selected = new Set(); // asset-id → true
  let lastIdx = null;         // för shift-click range
  let toolbarEl = null;

  // ── Toolbar ──────────────────────────────────────────────────────────────────

  function mountToolbar(el) {
    toolbarEl = el;
    render();
  }

  function render() {
    if (!toolbarEl) return;
    const count = selected.size;
    const total = getAllAssets().length;
    const allSelected = total > 0 && count === total;

    toolbarEl.innerHTML = `
      <label class="flex items-center gap-1.5 cursor-pointer select-none text-sm text-slate-300 hover:text-white">
        <input id="sel-toggle-all" type="checkbox" class="w-4 h-4 rounded accent-blue-500 cursor-pointer"
          ${allSelected ? 'checked' : ''}>
        <span>Markera alla</span>
      </label>
      ${count > 0 ? `
        <span class="text-sm font-medium text-white bg-blue-600 rounded-full px-2.5 py-0.5">${count} markerade</span>
        <button id="sel-clear" class="text-xs text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-slate-700 transition-colors">Avmarkera alla</button>
        <button id="sel-add-album" class="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded hover:bg-slate-700 transition-colors">
          📁 Lägg till i album
        </button>
        <button id="sel-delete" class="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-slate-700 transition-colors">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
          </svg>
          Radera markerade
        </button>` : ''}`;

    toolbarEl.querySelector('#sel-toggle-all')?.addEventListener('change', (e) => {
      if (e.target.checked) selectAll(); else clearAll();
    });
    toolbarEl.querySelector('#sel-clear')?.addEventListener('click', clearAll);
    toolbarEl.querySelector('#sel-add-album')?.addEventListener('click', () => {
      openAddToAlbumModal([...selected]);
    });
    toolbarEl.querySelector('#sel-delete')?.addEventListener('click', deleteSelected);
  }

  // ── Select / deselect ────────────────────────────────────────────────────────

  function toggle(assetId, idx, event) {
    const assets = getAllAssets();

    if (event?.shiftKey && lastIdx !== null) {
      // Markera range
      const from = Math.min(lastIdx, idx);
      const to   = Math.max(lastIdx, idx);
      for (let i = from; i <= to; i++) {
        if (assets[i]) selected.add(assets[i].id);
      }
    } else if (event?.ctrlKey || event?.metaKey) {
      // Toggle enskild
      if (selected.has(assetId)) selected.delete(assetId);
      else selected.add(assetId);
      lastIdx = idx;
    } else {
      // Vanligt klick på checkbox — toggle
      if (selected.has(assetId)) selected.delete(assetId);
      else selected.add(assetId);
      lastIdx = idx;
    }

    syncCellVisuals();
    render();
  }

  function selectAll() {
    getAllAssets().forEach((a) => selected.add(a.id));
    syncCellVisuals();
    render();
  }

  function clearAll() {
    selected.clear();
    lastIdx = null;
    syncCellVisuals();
    render();
  }

  function syncCellVisuals() {
    const grid = getGrid();
    if (!grid) return;
    grid.querySelectorAll('.photo-cell[data-id]').forEach((cell) => {
      const id = cell.dataset.id;
      const cb = cell.querySelector('.sel-checkbox');
      const isSelected = selected.has(id);
      if (cb) cb.checked = isSelected;
      cell.classList.toggle('ring-2', isSelected);
    });
  }

  // ── Radering ─────────────────────────────────────────────────────────────────

  async function deleteSelected() {
    const grid = getGrid();
    if (!grid || !selected.size) return;

    const ids = [...selected];
    const count = ids.length;
    const removedCells = [];

    // Samla celler + hitta första "ankar"-sibling UTANFÖR urvalet
    ids.forEach((id) => {
      const cell = grid.querySelector(`[data-id="${id}"]`);
      if (cell) {
        // Hitta nästa sibling som INTE ingår i urvalet — den ändras inte av raderingen
        let anchor = cell.nextSibling;
        while (anchor && ids.includes(anchor.dataset?.id)) anchor = anchor.nextSibling;
        removedCells.push({ id, cell, anchor, parent: cell.parentNode });
        cell.remove();
      }
    });

    // Radera via API
    await Promise.all(ids.map((id) => api.trash(id).catch(() => {})));
    clearAll();

    // Undo-toast
    showUndoToast(
      `${count} bild${count > 1 ? 'er' : ''} raderad${count > 1 ? 'e' : ''}`,
      async () => {
        await Promise.all(ids.map((id) => api.restore(id).catch(() => {})));
        // Sätt in alla celler innan ankaret (eller sist om ankaret är null)
        removedCells.forEach(({ cell, anchor, parent }) => {
          parent.insertBefore(cell, anchor ?? null);
        });
        render();
      },
    );
  }

  // ── Cell-koppling ─────────────────────────────────────────────────────────────

  function attachToCell(cell, asset, idx) {
    // Checkbox-overlay
    const cb = document.createElement('input');
    cb.type      = 'checkbox';
    cb.className = 'sel-checkbox absolute top-1.5 left-1.5 z-10 w-4 h-4 rounded accent-blue-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity';
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle(asset.id, idx, e);
    });
    cell.appendChild(cb);

    // Ctrl+click på hela cellen → markera utan att öppna lightbox
    cell.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        e.stopImmediatePropagation();
        toggle(asset.id, idx, e);
      }
    }, true); // capture — körs innan lightbox-klick
  }

  return { mountToolbar, attachToCell, clearAll, selectAll, syncCellVisuals };
}
