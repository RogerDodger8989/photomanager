import { api } from '../api.js';
import { buildPhotoCell, showAssetContextMenu } from '../components/gridCell.js';
import { createSelectionManager } from '../components/selectionManager.js';
import { openLightbox } from '../components/lightbox.js';
import { openAddToAlbumModal } from './albums.js';
import { toast, toastWithUndo } from '../utils.js';

let viewMode        = 'grid';
let allAssets       = [];
let sel             = null;
let nextCursor      = null;
let hasMore         = false;
let activeFolderKey = null;
let _treeData       = [];
let _container      = null;
let _recursive      = false;
let _sort           = 'taken_at';
let _order          = 'desc';
let _thumbSize      = parseInt(localStorage.getItem('fm-thumb-size') ?? '140', 10);

/** Focused item element in the content area (for keyboard navigation) */
let _focusedEl   = null;
/** Cut/Copy clipboard: { op:'cut'|'copy', assetIds:string[], folderPath:string|null } */
let _clipboard   = null;

// ── Globala händelse-lyssnare ────────────────────────────────────────────────

document.addEventListener('keydown', (ev) => {
  if (!_container?.isConnected) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (document.getElementById('lightbox')?.classList.contains('open')) return;

  // Om fokus är i vänstra trädpanelen — hantera navigering där
  const treeInner = document.getElementById('folder-tree-inner');
  if (treeInner?.contains(document.activeElement)) {
    const items = /** @type {HTMLElement[]} */ ([...treeInner.querySelectorAll('.folder-item')]);
    const cur   = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    switch (ev.key) {
      case 'ArrowDown':
        ev.preventDefault();
        items[Math.min(cur + 1, items.length - 1)]?.focus();
        break;
      case 'ArrowUp':
        ev.preventDefault();
        items[Math.max(cur - 1, 0)]?.focus();
        break;
      case 'ArrowRight':
        ev.preventDefault();
        // Välj mappen och flytta fokus till innehållsytan
        if (cur >= 0) items[cur].click();
        document.getElementById('folder-scroll-area')?.focus();
        break;
      case 'ArrowLeft':
        ev.preventDefault();
        _goUp();
        break;
      case 'F2':
        ev.preventDefault();
        // Byt namn på vald mapp via modal (inline fungerar inte i trädet)
        if (cur >= 0) {
          const btn = items[cur];
          const key  = btn.dataset.key ?? '';
          const path = btn.dataset.path ?? '';
          if (path) {
            const label = btn.querySelector('span')?.textContent?.trim() ?? '';
            const [wf]  = _splitKey(key);
            _showRenameDialog({ label, fullPath: path, watchedFolder: wf }, _treeData);
          }
        }
        break;
    }
    return; // Låt inte höger-panel-hanteraren köra
  }

  // Höger panel — innehållsyta
  switch (ev.key) {
    case 'Backspace':
      ev.preventDefault();
      _goUp();
      break;
    case 'F2':
      ev.preventDefault();
      if (_focusedEl) _renameItem(_focusedEl);
      break;
    case 'ArrowDown':
      ev.preventDefault();
      _moveFocus(1);
      break;
    case 'ArrowUp':
      ev.preventDefault();
      _moveFocus(-1);
      break;
    case 'ArrowRight':
      if (_focusedEl?.dataset.sfKey) { ev.preventDefault(); selectFolder(_focusedEl.dataset.sfKey, _treeData); }
      break;
    case 'ArrowLeft':
      ev.preventDefault();
      // Flytta fokus till trädet
      { const items = /** @type {HTMLElement[]} */ ([...(document.getElementById('folder-tree-inner')?.querySelectorAll('.folder-item') ?? [])]);
        const active = items.find((b) => b.dataset.key === activeFolderKey);
        (active ?? items[0])?.focus(); }
      break;
    case 'Enter':
      ev.preventDefault();
      if (_focusedEl?.dataset.sfKey) selectFolder(_focusedEl.dataset.sfKey, _treeData);
      else if (_focusedEl?.dataset.assetId) {
        const a = allAssets.find((x) => x.id === _focusedEl.dataset.assetId);
        if (a) openLightbox(allAssets, allAssets.indexOf(a));
      }
      break;
    case 'Delete':
      if (_focusedEl && !_focusedEl.dataset.sfKey && sel && activeFolderKey) sel.deleteSelected();
      break;
    case 'x':
      if (ev.ctrlKey || ev.metaKey) { ev.preventDefault(); _cutSelected(); }
      break;
    case 'c':
      if (ev.ctrlKey || ev.metaKey) { ev.preventDefault(); _copySelected(); }
      break;
    case 'v':
      if (ev.ctrlKey || ev.metaKey) { ev.preventDefault(); _paste(); }
      break;
    case 'a':
      if (ev.ctrlKey || ev.metaKey) { ev.preventDefault(); sel?.selectAll(); }
      break;
  }
});

window.addEventListener('pm:asset-trashed', (e) => {
  const id = /** @type {CustomEvent} */ (e).detail?.id;
  if (!id) return;
  allAssets = allAssets.filter((a) => a.id !== id);
  document.getElementById('folder-grid')?.querySelector(`[data-id="${id}"]`)?.remove();
  document.getElementById('folder-list')?.querySelector(`[data-id="${id}"]`)?.remove();
  _updateStatus();
});

window.addEventListener('pm:asset-restored', (e) => {
  const { asset, index } = /** @type {CustomEvent} */ (e).detail ?? {};
  if (!asset || !activeFolderKey) return;
  const insertAt = typeof index === 'number' ? index : allAssets.length;
  allAssets.splice(insertAt, 0, asset);
  const grid = document.getElementById('folder-grid');
  if (!grid) return;
  const cell = buildPhotoCell(asset, () => openLightbox(allAssets, allAssets.indexOf(asset)));
  sel?.attachToCell(cell, asset, insertAt);
  _makeDraggable(cell, asset);
  _attachAssetCtxMenu(cell, asset);
  grid.insertBefore(cell, grid.children[insertAt] ?? null);
  _updateStatus();
});

// ── Render ────────────────────────────────────────────────────────────────────

export async function renderFolders(container) {
  _container = container;
  container.innerHTML = `
    <div class="flex h-full overflow-hidden">
      <!-- Sidopanel: mappträd -->
      <div class="w-64 flex-shrink-0 overflow-y-auto bg-slate-900 border-r border-slate-700">
        <div class="px-3 pt-3 pb-1 text-slate-500 text-xs font-semibold tracking-wider">MAPPAR</div>
        <div id="folder-tree-inner" class="pb-4">
          <div class="px-3 py-2 text-slate-500 text-xs">Laddar...</div>
        </div>
      </div>
      <!-- Höger panel -->
      <div class="flex-1 flex flex-col overflow-hidden min-w-0">
        <!-- Verktygsfält -->
        <div class="flex items-center gap-2 px-4 py-2 border-b border-slate-700 flex-wrap">
          <div id="folder-sel-toolbar" class="flex items-center gap-2 flex-wrap flex-1 min-h-[2rem]"></div>
          <label class="flex items-center gap-1.5 cursor-pointer text-xs text-slate-400 hover:text-slate-200 select-none shrink-0" title="Visa foton från alla undermappar">
            <input type="checkbox" id="recursive-cb" class="w-3.5 h-3.5 accent-blue-500 cursor-pointer">
            <span>Inkl. undermappar</span>
          </label>
          <div class="w-px h-5 bg-slate-700 shrink-0"></div>
          <!-- Sortering -->
          <select id="sort-select" class="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer">
            <option value="taken_at">Datum taget</option>
            <option value="indexed_at">Datum importerat</option>
            <option value="file_name">Filnamn</option>
            <option value="file_size">Filstorlek</option>
            <option value="view_count">Visningar</option>
          </select>
          <button id="order-btn" title="Växla sorteringsordning" class="p-1.5 rounded hover:bg-slate-700 transition-colors text-slate-300" data-order="desc">
            <svg id="order-icon" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9M3 12h5m11 4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
          </button>
          <div class="w-px h-5 bg-slate-700 shrink-0"></div>
          <div class="flex gap-0.5 shrink-0" title="Thumbnailstorlek">
            <button id="sz-s" data-size="80"  class="size-btn px-2 py-1 text-xs rounded transition-colors">S</button>
            <button id="sz-m" data-size="140" class="size-btn px-2 py-1 text-xs rounded transition-colors">M</button>
            <button id="sz-l" data-size="220" class="size-btn px-2 py-1 text-xs rounded transition-colors">L</button>
          </div>
          <div class="w-px h-5 bg-slate-700 shrink-0"></div>
          <div class="flex gap-1 shrink-0">
            <button id="view-grid-btn" title="Rutnät (G)" class="p-1.5 rounded hover:bg-slate-700 transition-colors">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/></svg>
            </button>
            <button id="view-list-btn" title="Lista (L)" class="p-1.5 rounded hover:bg-slate-700 transition-colors">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 4h18v2H3zm0 7h18v2H3zm0 7h18v2H3z"/></svg>
            </button>
          </div>
        </div>
        <!-- Brödsmula + statusrad -->
        <div class="flex items-center justify-between px-4 py-1.5 border-b border-slate-700/50 min-h-[2rem]">
          <div id="folder-breadcrumb" class="text-xs text-slate-400 flex items-center gap-1 flex-wrap"></div>
          <div id="folder-status" class="text-xs text-slate-500 shrink-0 ml-4"></div>
        </div>
        <!-- Innehållsyta -->
        <div class="flex-1 overflow-y-auto p-3" id="folder-scroll-area" tabindex="0">
          <!-- Undermappar -->
          <div id="folder-subfolders-section" class="hidden mb-3">
            <div id="subfolder-grid" class="grid gap-2" style="grid-template-columns:repeat(auto-fill,minmax(110px,1fr))"></div>
            <div id="subfolder-list" class="hidden divide-y divide-slate-700/30"></div>
            <div class="h-px bg-slate-700/40 my-3"></div>
          </div>
          <!-- Filer -->
          <div id="folder-grid" class="grid gap-1"
            style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))"></div>
          <div id="folder-list" class="hidden divide-y divide-slate-700/50"></div>
          <div id="folder-empty" class="hidden text-slate-500 text-sm text-center py-20">
            Välj en mapp i trädet till vänster
          </div>
          <div id="folder-loading" class="hidden text-slate-500 text-sm text-center py-20">
            <div class="inline-block w-5 h-5 border-2 border-slate-600 border-t-blue-400 rounded-full animate-spin"></div>
          </div>
          <div id="folder-load-more" class="hidden text-center pt-4 pb-2">
            <button id="load-more-btn" class="text-blue-400 text-sm hover:underline">Ladda fler...</button>
          </div>
        </div>
      </div>
    </div>`;

  _updateViewButtons(container);
  container.querySelector('#view-grid-btn')?.addEventListener('click', () => {
    viewMode = 'grid'; _updateViewButtons(container); _rerenderCurrentAssets(); _applyThumbSize(_thumbSize);
  });
  container.querySelector('#view-list-btn')?.addEventListener('click', () => {
    viewMode = 'list'; _updateViewButtons(container); _rerenderCurrentAssets(); _applyThumbSize(_thumbSize);
  });
  container.querySelector('#recursive-cb')?.addEventListener('change', (e) => {
    _recursive = /** @type {HTMLInputElement} */ (e.target).checked;
    if (activeFolderKey) selectFolder(activeFolderKey, _treeData);
  });

  // Sortering
  const sortSel  = /** @type {HTMLSelectElement|null} */ (container.querySelector('#sort-select'));
  const orderBtn = container.querySelector('#order-btn');
  const orderIcon = container.querySelector('#order-icon');
  const _updateOrderIcon = () => {
    if (!orderIcon) return;
    if (_order === 'desc') {
      orderIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9M3 12h5m11 4l-4 4m0 0l-4-4m4 4V4"/>';
    } else {
      orderIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 20h13M3 16h9M3 12h5m11-8l-4-4m0 0l-4 4m4-4v16"/>';
    }
    orderBtn?.setAttribute('title', _order === 'desc' ? 'Nyast först (klicka för äldst först)' : 'Äldst först (klicka för nyast först)');
  };
  sortSel?.addEventListener('change', () => {
    _sort = sortSel.value;
    if (activeFolderKey) selectFolder(activeFolderKey, _treeData);
  });
  orderBtn?.addEventListener('click', () => {
    _order = _order === 'desc' ? 'asc' : 'desc';
    _updateOrderIcon();
    if (activeFolderKey) selectFolder(activeFolderKey, _treeData);
  });
  _updateOrderIcon();

  // S / M / L thumbnail-storlek
  container.querySelectorAll('.size-btn').forEach((btn) => {
    btn.addEventListener('click', () => _applyThumbSize(parseInt(/** @type {HTMLElement} */ (btn).dataset.size ?? '140', 10)));
  });
  _applyThumbSize(_thumbSize);

  // Tangent G / L för vyval
  document.addEventListener('keydown', (e) => {
    if (!_container?.isConnected) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'g' || e.key === 'G') { viewMode = 'grid'; _updateViewButtons(container); _rerenderCurrentAssets(); _applyThumbSize(_thumbSize); }
    if (e.key === 'l' || e.key === 'L') { viewMode = 'list'; _updateViewButtons(container); _rerenderCurrentAssets(); _applyThumbSize(_thumbSize); }
  });

  container.querySelector('#folder-empty')?.classList.remove('hidden');

  sel = createSelectionManager(
    () => document.getElementById('folder-grid'),
    () => allAssets,
    [{
      label: '📂 Flytta till...',
      className: 'flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 px-2 py-1 rounded hover:bg-slate-700 transition-colors',
      onClick: (ids) => _showMoveFilesModal(ids),
    }]
  );
  const selToolbar = document.getElementById('folder-sel-toolbar');
  if (selToolbar) selToolbar.innerHTML = '';

  container.querySelector('#load-more-btn')?.addEventListener('click', _loadMoreAssets);

  document.addEventListener('click', _closeCtxMenu, { capture: true });

  try {
    const { data: tree } = await api.folderTree();
    _treeData = tree;
    _renderTree(container, tree);
  } catch {
    const ti = document.getElementById('folder-tree-inner');
    if (ti) ti.innerHTML = '<div class="px-3 text-red-400 text-xs py-2">Kunde inte ladda mappar</div>';
  }
}

// ── Trädrendering ─────────────────────────────────────────────────────────────

function _renderTree(container, tree) {
  const inner = document.getElementById('folder-tree-inner');
  if (!inner) return;
  if (!tree?.length) {
    inner.innerHTML = '<div class="px-3 text-slate-500 text-xs py-2">Inga bevakade mappar</div>';
    return;
  }
  inner.innerHTML = '';

  tree.forEach((wf) => {
    const rootKey = wf.watchedFolder + '|';
    const rootBtn = document.createElement('button');
    rootBtn.dataset.key = rootKey;
    rootBtn.tabIndex = 0;
    rootBtn.className = 'folder-item folder-drop-target w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700/60 transition-colors rounded';
    rootBtn.innerHTML = `
      <svg class="w-4 h-4 text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
        <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/>
      </svg>
      <span class="truncate flex-1">${_esc(wf.label)}</span>
      <span class="text-slate-500 text-xs shrink-0">(${wf.totalAssetCount})</span>`;
    rootBtn.addEventListener('click', () => selectFolder(rootKey, tree));
    rootBtn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      _showFolderCtxMenu(/** @type {MouseEvent} */ (e), { label: wf.label, fullPath: wf.watchedFolder, watchedFolder: wf.watchedFolder }, tree);
    });
    _makeTreeDropTarget(rootBtn, wf.watchedFolder, wf.label);
    inner.appendChild(rootBtn);

    wf.subfolders.forEach((sf) => {
      const key      = wf.watchedFolder + '|' + sf.path;
      const depth    = sf.path.split('/').length;
      const fullPath = wf.watchedFolder + '/' + sf.path;

      const sfBtn = document.createElement('button');
      sfBtn.dataset.key  = key;
      sfBtn.dataset.path = fullPath;
      sfBtn.tabIndex = 0;
      sfBtn.className = 'folder-item w-full text-left flex items-center gap-2 py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700/40 transition-colors rounded';
      sfBtn.style.paddingLeft = (8 + depth * 14) + 'px';
      sfBtn.innerHTML = `
        <svg class="w-3.5 h-3.5 text-slate-500 shrink-0" fill="currentColor" viewBox="0 0 24 24">
          <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/>
        </svg>
        <span class="truncate flex-1">${_esc(sf.label)}</span>
        <span class="text-slate-600 text-xs shrink-0">(${sf.assetCount})</span>`;
      sfBtn.addEventListener('click', () => selectFolder(key, tree));
      sfBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        _showFolderCtxMenu(/** @type {MouseEvent} */ (e), { label: sf.label, fullPath, watchedFolder: wf.watchedFolder }, tree);
      });
      _makeTreeDropTarget(sfBtn, fullPath, sf.label);
      _makeTreeFolderDraggable(sfBtn, sf.label, fullPath);
      inner.appendChild(sfBtn);
    });
  });
}

function _updateActiveFolder(key) {
  activeFolderKey = key;
  document.querySelectorAll('.folder-item').forEach((btn) => {
    const active = /** @type {HTMLElement} */ (btn).dataset.key === key;
    btn.classList.toggle('bg-blue-600/30', active);
    btn.classList.toggle('text-white',     active);
  });
}

// ── Navigering ────────────────────────────────────────────────────────────────

export async function selectFolder(key, tree) {
  _focusedEl = null;
  _updateActiveFolder(key);
  const [watchedFolder, subpath] = _splitKey(key);

  const wf        = tree.find((w) => w.watchedFolder === watchedFolder);
  const rootLabel = wf ? wf.label : watchedFolder.split('/').pop();

  // Brödsmula
  const breadcrumb = document.getElementById('folder-breadcrumb');
  if (breadcrumb) {
    const parts = subpath ? subpath.split('/') : [];
    const segs  = [{ label: rootLabel, key: watchedFolder + '|' }, ...parts.map((_, i) => ({
      label: parts[i],
      key:   watchedFolder + '|' + parts.slice(0, i + 1).join('/'),
    }))];
    breadcrumb.innerHTML = segs.map((seg, i) => {
      if (i === segs.length - 1) return `<span class="text-slate-200 font-medium">${_esc(seg.label)}</span>`;
      return `<button class="hover:text-white transition-colors" data-bc-key="${_esc(seg.key)}">${_esc(seg.label)}</button>
              <span class="text-slate-600">›</span>`;
    }).join('');
    breadcrumb.querySelectorAll('[data-bc-key]').forEach((btn) => {
      btn.addEventListener('click', () => selectFolder(/** @type {HTMLElement} */ (btn).dataset.bcKey, tree));
    });
  }

  // Undermappar direkt under denna mapp
  const immediateSubs = _getImmediateSubfolders(watchedFolder, subpath, tree);

  allAssets  = [];
  nextCursor = null;
  hasMore    = false;

  if (sel) {
    sel.clearAll();
    const toolbarEl = document.getElementById('folder-sel-toolbar');
    if (toolbarEl) sel.mountToolbar(toolbarEl);
  }

  const grid    = document.getElementById('folder-grid');
  const list    = document.getElementById('folder-list');
  const empty   = document.getElementById('folder-empty');
  const loading = document.getElementById('folder-loading');
  const loadMore = document.getElementById('folder-load-more');

  if (grid)    grid.innerHTML = '';
  if (list)    list.innerHTML = '';
  if (empty)   empty.classList.add('hidden');
  if (loading) loading.classList.remove('hidden');
  if (loadMore) loadMore.classList.add('hidden');

  // Rendera undermappar direkt (ingen server-anrop)
  _renderSubfolderItems(immediateSubs, watchedFolder, subpath);

  try {
    const fullPath = subpath ? (watchedFolder.replace(/\/$/, '') + '/' + subpath) : watchedFolder;
    const { data: items, meta } = await api.assets({
      folderPath: fullPath, limit: 100, sort: _sort, order: _order, recursive: _recursive,
    });
    if (loading) loading.classList.add('hidden');

    allAssets  = items;
    nextCursor = meta.nextCursor;
    hasMore    = meta.hasMore;

    if (items.length === 0 && immediateSubs.length === 0) {
      if (empty) { empty.textContent = 'Mappen är tom'; empty.classList.remove('hidden'); }
    }

    _renderAssets(items);
    if (hasMore && loadMore) loadMore.classList.remove('hidden');
  } catch (err) {
    if (loading) loading.classList.add('hidden');
    toast('Kunde inte ladda bilder: ' + err.message, 'error');
  }

  _updateStatus();
}

function _goUp() {
  if (!activeFolderKey) return;
  const [watchedFolder, subpath] = _splitKey(activeFolderKey);
  if (!subpath) return; // already at root
  const parts = subpath.split('/');
  parts.pop();
  const parentKey = watchedFolder + '|' + parts.join('/');
  selectFolder(parentKey, _treeData);
}

function _getImmediateSubfolders(watchedFolder, subpath, treeData) {
  const wf = treeData.find((w) => w.watchedFolder === watchedFolder);
  if (!wf) return [];
  if (!subpath) {
    return wf.subfolders.filter((sf) => !sf.path.includes('/'));
  }
  const prefix = subpath + '/';
  return wf.subfolders.filter((sf) => {
    if (!sf.path.startsWith(prefix)) return false;
    const rest = sf.path.slice(prefix.length);
    return !rest.includes('/');
  });
}

// ── Undermapp-tiles i innehållsytan ──────────────────────────────────────────

function _renderSubfolderItems(subfolders, watchedFolder, currentSubpath) {
  const section    = document.getElementById('folder-subfolders-section');
  const sfGrid     = document.getElementById('subfolder-grid');
  const sfList     = document.getElementById('subfolder-list');
  if (!section || !sfGrid || !sfList) return;

  if (!subfolders.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  sfGrid.innerHTML = '';
  sfList.innerHTML = '';

  subfolders.forEach((sf) => {
    const sfKey      = watchedFolder + '|' + sf.path;
    const sfFullPath = watchedFolder + '/' + sf.path;

    // --- GRID TILE ---
    const tile = document.createElement('div');
    tile.className = 'folder-content-item group flex flex-col items-center gap-1 p-2 rounded-lg cursor-pointer hover:bg-slate-700/60 transition-colors select-none relative';
    tile.dataset.sfKey      = sfKey;
    tile.dataset.sfName     = sf.label;
    tile.dataset.sfFullPath = sfFullPath;
    tile.tabIndex = -1;
    tile.innerHTML = `
      <svg class="w-12 h-12 text-blue-400 group-hover:text-blue-300 transition-colors" fill="currentColor" viewBox="0 0 24 24">
        <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/>
      </svg>
      <span class="sf-label text-xs text-slate-200 text-center break-all line-clamp-2 w-full">${_esc(sf.label)}</span>
      <span class="text-[10px] text-slate-500">${sf.assetCount}</span>`;

    tile.addEventListener('click', () => _setFocusedEl(tile));
    tile.addEventListener('dblclick', () => selectFolder(sfKey, _treeData));
    tile.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      _setFocusedEl(tile);
      _showFolderCtxMenu(/** @type {MouseEvent} */ (e), { label: sf.label, fullPath: sfFullPath, watchedFolder }, _treeData);
    });
    _makeContentDropTarget(tile, sfFullPath, sf.label);
    _makeFolderDraggable(tile, sf, sfFullPath, watchedFolder);
    sfGrid.appendChild(tile);

    // --- LIST ROW ---
    const row = document.createElement('div');
    row.className = 'folder-content-item flex items-center gap-3 px-2 py-1.5 hover:bg-slate-700/40 rounded cursor-pointer select-none';
    row.dataset.sfKey      = sfKey;
    row.dataset.sfName     = sf.label;
    row.dataset.sfFullPath = sfFullPath;
    row.tabIndex = -1;
    row.innerHTML = `
      <svg class="w-5 h-5 text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
        <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/>
      </svg>
      <span class="sf-label flex-1 truncate text-slate-200 text-sm">${_esc(sf.label)}</span>
      <span class="text-slate-500 text-xs">${sf.assetCount} filer</span>
      <span class="text-slate-600 text-xs w-20 text-right">Mapp</span>`;

    row.addEventListener('click', () => _setFocusedEl(row));
    row.addEventListener('dblclick', () => selectFolder(sfKey, _treeData));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      _setFocusedEl(row);
      _showFolderCtxMenu(/** @type {MouseEvent} */ (e), { label: sf.label, fullPath: sfFullPath, watchedFolder }, _treeData);
    });
    _makeContentDropTarget(row, sfFullPath, sf.label);
    _makeFolderDraggable(row, sf, sfFullPath, watchedFolder);
    sfList.appendChild(row);
  });

  // Synka synlighet med viewMode
  _syncSubfolderView();
}

function _syncSubfolderView() {
  const sfGrid = document.getElementById('subfolder-grid');
  const sfList = document.getElementById('subfolder-list');
  if (sfGrid) sfGrid.classList.toggle('hidden', viewMode === 'list');
  if (sfList) sfList.classList.toggle('hidden', viewMode === 'grid');
}

// ── Fokus & tangentbordsnavigering ────────────────────────────────────────────

function _setFocusedEl(el) {
  _focusedEl?.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-900/20');
  _focusedEl = el;
  el?.classList.add('ring-2', 'ring-blue-500', 'bg-blue-900/20');
  el?.scrollIntoView({ block: 'nearest' });
}

function _moveFocus(delta) {
  const items = _getAllContentItems();
  if (!items.length) return;
  const cur = _focusedEl ? items.indexOf(_focusedEl) : -1;
  const next = Math.max(0, Math.min(items.length - 1, cur + delta));
  _setFocusedEl(items[next]);
}

function _getAllContentItems() {
  const area = document.getElementById('folder-scroll-area');
  if (!area) return [];
  return /** @type {HTMLElement[]} */ ([...area.querySelectorAll('.folder-content-item')]);
}

// ── Namnbyte ─────────────────────────────────────────────────────────────────

/** Öppnar rätt rename-dialog beroende på om det är mapp eller fil */
function _renameItem(el) {
  if (el.dataset.sfFullPath) {
    // Mapp → modal
    _showRenameDialog(
      { label: el.dataset.sfName ?? '', fullPath: el.dataset.sfFullPath, watchedFolder: '' },
      _treeData,
    );
  } else if (el.dataset.assetId) {
    // Fil → modal
    const asset = allAssets.find((a) => a.id === el.dataset.assetId);
    if (!asset) return;
    _showInputModal({
      title: `Byt namn på "${asset.file_name}"`,
      label: 'Nytt filnamn',
      defaultValue: asset.file_name,
      confirmText: 'Byt namn',
      onConfirm: async (newName) => {
        if (newName === asset.file_name) return;
        try {
          await api.renameAsset({ assetId: asset.id, newName });
          asset.file_name = newName;
          // Uppdatera visad text i grid/list
          const nameEl = el.querySelector('.fc-filename');
          if (nameEl) nameEl.textContent = newName;
          toast(`Bytte namn till "${newName}"`, 'success');
        } catch (err) {
          toast('Kunde inte byta namn: ' + err.message, 'error');
        }
      },
    });
  }
}

// ── Inline-namnbyte (används ej längre direkt, men behålls för referens) ─────

function _startInlineRename(el) {
  const nameSpan = el.querySelector('.sf-label, .fc-filename');
  if (!nameSpan) return;
  const oldName = nameSpan.textContent ?? '';

  const input = document.createElement('input');
  input.type  = 'text';
  input.value = oldName;
  input.className = 'text-xs text-white bg-blue-900/60 border border-blue-400 rounded px-1 w-full outline-none text-center max-w-[110px]';
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  let committed = false;

  const cancel = () => {
    if (committed) return;
    committed = true;
    input.replaceWith(nameSpan);
  };

  const commit = async () => {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    if (!newName || newName === oldName) { input.replaceWith(nameSpan); return; }

    if (el.dataset.sfFullPath) {
      // Mappbyte
      try {
        await api.renameFolder({ oldPath: el.dataset.sfFullPath, newName });
        nameSpan.textContent = newName;
        el.dataset.sfName     = newName;
        input.replaceWith(nameSpan);
        toast(`Bytte namn till "${newName}"`, 'success');
        _refreshTree();
      } catch (err) {
        toast('Kunde inte byta namn: ' + err.message, 'error');
        input.replaceWith(nameSpan);
      }
    } else if (el.dataset.assetId) {
      // Filbyte
      try {
        await api.renameAsset({ assetId: el.dataset.assetId, newName });
        nameSpan.textContent = newName;
        const asset = allAssets.find((a) => a.id === el.dataset.assetId);
        if (asset) asset.file_name = newName;
        input.replaceWith(nameSpan);
        toast(`Bytte namn till "${newName}"`, 'success');
      } catch (err) {
        toast('Kunde inte byta namn: ' + err.message, 'error');
        input.replaceWith(nameSpan);
      }
    }
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); input.removeEventListener('blur', commit); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); input.removeEventListener('blur', commit); cancel(); }
  });
}

// ── Klipp/Kopiera/Klistra in ─────────────────────────────────────────────────

function _cutSelected() {
  const ids = _getSelectedAssetIds();
  if (!ids.length) return;
  _clipboard = { op: 'cut', assetIds: ids };
  toast(`${ids.length} fil${ids.length > 1 ? 'er' : ''} klippt`, 'success');
  _highlightClipboard(ids, true);
}

function _copySelected() {
  const ids = _getSelectedAssetIds();
  if (!ids.length) return;
  _clipboard = { op: 'copy', assetIds: ids };
  toast(`${ids.length} fil${ids.length > 1 ? 'er' : ''} kopierad${ids.length > 1 ? 'e' : ''}`, 'success');
  _highlightClipboard(ids, false);
}

async function _paste() {
  if (!_clipboard || !activeFolderKey) return;
  const [watchedFolder, subpath] = _splitKey(activeFolderKey);
  const targetFolder = subpath ? (watchedFolder.replace(/\/$/, '') + '/' + subpath) : watchedFolder;
  const { op, assetIds } = _clipboard;

  try {
    if (op === 'cut') {
      await _moveFilesTo(assetIds, targetFolder, targetFolder.split(/[\\/]/).pop() ?? '');
      _clipboard = null;
    } else {
      const { data } = await api.copyFiles({ assetIds, targetFolder });
      toast(`${data.copied} fil${data.copied !== 1 ? 'er' : ''} kopierad${data.copied !== 1 ? 'e' : ''}`, 'success');
    }
    selectFolder(activeFolderKey, _treeData);
  } catch (err) {
    toast('Misslyckades: ' + err.message, 'error');
  }
}

function _getSelectedAssetIds() {
  const grid = document.getElementById('folder-grid');
  return grid
    ? [...grid.querySelectorAll('.sel-checkbox:checked')]
        .map((cb) => /** @type {HTMLElement|null} */ (cb.closest('[data-id]'))?.dataset.id)
        .filter(Boolean)
    : [];
}

function _highlightClipboard(ids, faded) {
  const grid = document.getElementById('folder-grid');
  if (!grid) return;
  ids.forEach((id) => {
    grid.querySelector(`[data-id="${id}"]`)?.classList.toggle('opacity-40', faded);
  });
}

// ── Ladda bilder ──────────────────────────────────────────────────────────────

async function _loadMoreAssets() {
  if (!nextCursor || !activeFolderKey) return;
  const [watchedFolder, subpath] = _splitKey(activeFolderKey);
  const fullPath = subpath ? (watchedFolder.replace(/\/$/, '') + '/' + subpath) : watchedFolder;
  try {
    const { data: items, meta } = await api.assets({
      folderPath: fullPath, limit: 100, sort: _sort, order: _order, cursor: nextCursor, recursive: _recursive,
    });
    allAssets  = allAssets.concat(items);
    nextCursor = meta.nextCursor;
    hasMore    = meta.hasMore;
    _renderAssets(items);
    if (!hasMore) document.getElementById('folder-load-more')?.classList.add('hidden');
    _updateStatus();
  } catch (err) {
    toast('Kunde inte ladda fler: ' + err.message, 'error');
  }
}

// ── Renderera filer ───────────────────────────────────────────────────────────

function _attachAssetCtxMenu(cell, asset) {
  cell.addEventListener('contextmenu', (e) => {
    showAssetContextMenu(e, asset, {
      selectionManager: sel,
      getAllAssets: () => allAssets,
      openLightboxFn: openLightbox,
      allAssets,
      index: allAssets.indexOf(asset),
      onAddToAlbum: openAddToAlbumModal,
      onDelete: (id, restored) => {
        if (!restored) allAssets = allAssets.filter((a) => a.id !== id);
        _updateStatus();
      },
      onRefresh: () => { if (activeFolderKey) selectFolder(activeFolderKey, _treeData); },
    });
  });
}

function _renderAssets(items) {
  if (viewMode === 'grid') {
    const grid = document.getElementById('folder-grid');
    if (!grid) return;
    items.forEach((asset, i) => {
      const idx  = allAssets.length - items.length + i;
      const cell = buildPhotoCell(asset, () => openLightbox(allAssets, allAssets.indexOf(asset)));
      cell.classList.add('folder-content-item');
      cell.dataset.assetId = asset.id;
      sel?.attachToCell(cell, asset, idx);
      _makeDraggable(cell, asset);
      _attachAssetCtxMenu(cell, asset);
      cell.addEventListener('click', () => _setFocusedEl(cell));
      grid.appendChild(cell);
    });
  } else {
    _renderListItems(items);
  }
}

function _renderListItems(items) {
  const list = document.getElementById('folder-list');
  if (!list) return;
  items.forEach((asset) => {
    const idx = allAssets.indexOf(asset);
    const row = document.createElement('div');
    row.className = 'folder-content-item flex items-center gap-3 px-2 py-1.5 hover:bg-slate-700/40 rounded cursor-pointer text-sm select-none';
    row.dataset.id          = asset.id;
    row.dataset.assetId     = asset.id;
    row.dataset.listRowId   = asset.id;
    const thumb = asset.thumb_small_path
      ? `<img src="/thumbs/${asset.thumb_small_path}" class="w-9 h-9 object-cover rounded shrink-0">`
      : '<div class="w-9 h-9 bg-slate-700 rounded shrink-0"></div>';
    const date = asset.taken_at ? new Date(asset.taken_at).toLocaleDateString('sv-SE') : '—';
    const size = asset.file_size ? _formatBytes(asset.file_size) : '—';
    row.innerHTML = `
      <input type="checkbox" class="sel-checkbox w-4 h-4 rounded accent-blue-500 cursor-pointer shrink-0">
      ${thumb}
      <span class="fc-filename flex-1 truncate text-slate-200">${_esc(asset.file_name)}</span>
      <span class="text-slate-500 shrink-0 w-24 text-right">${date}</span>
      <span class="text-slate-500 shrink-0 w-16 text-right">${size}</span>`;

    // Checkbox-klick — toggle markering
    const cb = /** @type {HTMLInputElement} */ (row.querySelector('.sel-checkbox'));
    if (cb && sel) {
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        sel.toggle(asset.id, idx, e);
      });
    }

    row.addEventListener('click', (e) => {
      if (sel && (e.ctrlKey || e.metaKey || e.shiftKey)) {
        e.stopImmediatePropagation();
        sel.toggle(asset.id, idx, e);
        return;
      }
      _setFocusedEl(row);
    });
    row.addEventListener('dblclick', () => openLightbox(allAssets, allAssets.indexOf(asset)));
    row.addEventListener('contextmenu', (e) => {
      _setFocusedEl(row);
      showAssetContextMenu(e, asset, {
        selectionManager: sel,
        getAllAssets: () => allAssets,
        openLightboxFn: openLightbox,
        allAssets,
        index: allAssets.indexOf(asset),
        onAddToAlbum: openAddToAlbumModal,
        onDelete: (id) => { allAssets = allAssets.filter((a) => a.id !== id); _updateStatus(); },
        onRefresh: () => { if (activeFolderKey) selectFolder(activeFolderKey, _treeData); },
      });
    });
    _makeDraggable(row, asset);
    list.appendChild(row);
  });
}

function _applyThumbSize(px) {
  _thumbSize = px;
  localStorage.setItem('fm-thumb-size', String(px));
  const grid = document.getElementById('folder-grid');
  if (grid) grid.style.gridTemplateColumns = `repeat(auto-fill,minmax(${px}px,1fr))`;
  const isList = viewMode === 'list';
  _container?.querySelectorAll('.size-btn').forEach((btn) => {
    const active = /** @type {HTMLElement} */ (btn).dataset.size === String(px);
    btn.classList.toggle('bg-slate-600',   active);
    btn.classList.toggle('text-white',     active);
    btn.classList.toggle('text-slate-400', !active && !isList);
    btn.classList.toggle('text-slate-600', isList && !active);
    /** @type {HTMLButtonElement} */ (btn).disabled = isList;
  });
}

function _rerenderCurrentAssets() {
  const grid = document.getElementById('folder-grid');
  const list = document.getElementById('folder-list');
  if (!grid || !list) return;

  _syncSubfolderView();

  if (viewMode === 'grid') {
    list.classList.add('hidden');
    grid.classList.remove('hidden');
    grid.innerHTML = '';
    allAssets.forEach((asset, i) => {
      const cell = buildPhotoCell(asset, () => openLightbox(allAssets, i));
      cell.classList.add('folder-content-item');
      cell.dataset.assetId = asset.id;
      sel?.attachToCell(cell, asset, i);
      _makeDraggable(cell, asset);
      _attachAssetCtxMenu(cell, asset);
      cell.addEventListener('click', () => _setFocusedEl(cell));
      grid.appendChild(cell);
    });
  } else {
    grid.classList.add('hidden');
    list.classList.remove('hidden');
    list.innerHTML = '';
    _renderListItems(allAssets);
  }
  _applyThumbSize(_thumbSize);
}

// ── Status-rad ────────────────────────────────────────────────────────────────

function _updateStatus() {
  const statusEl = document.getElementById('folder-status');
  if (!statusEl) return;
  const subCount  = document.querySelectorAll('#subfolder-grid .folder-content-item, #subfolder-list .folder-content-item').length / 2;
  const fileCount = allAssets.length;
  const parts     = [];
  const numSubs   = document.getElementById('subfolder-grid')?.children.length ?? 0;
  if (numSubs > 0) parts.push(`${numSubs} mapp${numSubs !== 1 ? 'ar' : ''}`);
  if (fileCount > 0) parts.push(`${fileCount} fil${fileCount !== 1 ? 'er' : ''}`);
  statusEl.textContent = parts.join(', ') || '';
}

// ── Drag-and-drop (filer) ─────────────────────────────────────────────────────

let _dragGhost = null;

function _makeDraggable(el, asset) {
  el.draggable = true;

  el.addEventListener('dragstart', (e) => {
    const grid = document.getElementById('folder-grid');
    const checkedIds = grid
      ? [...grid.querySelectorAll('.sel-checkbox:checked')]
          .map((cb) => /** @type {HTMLElement|null} */ (cb.closest('[data-id]'))?.dataset.id)
          .filter(Boolean)
      : [];
    const ids = checkedIds.includes(asset.id) ? checkedIds : [asset.id];
    e.dataTransfer.setData('application/pm-asset-ids', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';

    _dragGhost = document.createElement('div');
    _dragGhost.style.cssText = 'position:fixed;top:-200px;left:0;z-index:9999;background:#3b82f6;color:#fff;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap;pointer-events:none;';
    _dragGhost.textContent = ids.length === 1 ? '1 bild' : `${ids.length} bilder`;
    document.body.appendChild(_dragGhost);
    e.dataTransfer.setDragImage(_dragGhost, -10, -10);

    requestAnimationFrame(() => {
      if (checkedIds.length > 1) {
        document.getElementById('folder-grid')?.querySelectorAll('.sel-checkbox:checked').forEach((cb) => {
          cb.closest('[data-id]')?.classList.add('opacity-40');
        });
      } else {
        el.classList.add('opacity-40');
      }
    });
  });

  el.addEventListener('dragend', () => {
    _dragGhost?.remove(); _dragGhost = null;
    document.querySelectorAll('#folder-grid [data-id], #folder-list [data-id]').forEach((c) => c.classList.remove('opacity-40'));
  });
}

// ── Drag-and-drop (mappar) ────────────────────────────────────────────────────

function _makeFolderDraggable(el, sf, sfFullPath, watchedFolder) {
  el.draggable = true;

  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/pm-folder-path', sfFullPath);
    e.dataTransfer.setData('application/pm-folder-name', sf.label);
    e.dataTransfer.effectAllowed = 'move';

    _dragGhost = document.createElement('div');
    _dragGhost.style.cssText = 'position:fixed;top:-200px;left:0;z-index:9999;background:#f59e0b;color:#fff;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap;pointer-events:none;';
    _dragGhost.textContent = `📁 ${sf.label}`;
    document.body.appendChild(_dragGhost);
    e.dataTransfer.setDragImage(_dragGhost, -10, -10);
    requestAnimationFrame(() => el.classList.add('opacity-40'));
  });

  el.addEventListener('dragend', () => {
    _dragGhost?.remove(); _dragGhost = null;
    el.classList.remove('opacity-40');
  });
}

// Drop target för innehållsytans undermappar
function _makeContentDropTarget(el, targetPath, label) {
  const highlight  = () => el.classList.add('ring-2', 'ring-blue-400', 'bg-blue-900/20');
  const unhighlight = () => el.classList.remove('ring-2', 'ring-blue-400', 'bg-blue-900/20');

  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    highlight();
  });
  el.addEventListener('dragleave', (ev) => { if (!el.contains(ev.relatedTarget)) unhighlight(); });
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    unhighlight();

    const assetJson = e.dataTransfer.getData('application/pm-asset-ids');
    const folderPath = e.dataTransfer.getData('application/pm-folder-path');
    const folderName = e.dataTransfer.getData('application/pm-folder-name');

    if (assetJson) {
      let ids;
      try { ids = JSON.parse(assetJson); } catch { return; }
      if (ids?.length) await _moveFilesTo(ids, targetPath, label);
    } else if (folderPath && folderPath !== targetPath && !targetPath.startsWith(folderPath + '/')) {
      _confirmAndMoveFolder(folderPath, folderName, targetPath, label);
    }
  });
}

/** Gör ett träd-element draggable (bara undermappar, inte rot-mappar) */
function _makeTreeFolderDraggable(el, label, fullPath) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/pm-folder-path', fullPath);
    e.dataTransfer.setData('application/pm-folder-name', label);
    e.dataTransfer.effectAllowed = 'move';
    _dragGhost = document.createElement('div');
    _dragGhost.style.cssText = 'position:fixed;top:-200px;left:0;z-index:9999;background:#f59e0b;color:#fff;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap;pointer-events:none;';
    _dragGhost.textContent = `📁 ${label}`;
    document.body.appendChild(_dragGhost);
    e.dataTransfer.setDragImage(_dragGhost, -10, -10);
    requestAnimationFrame(() => el.classList.add('opacity-40'));
  });
  el.addEventListener('dragend', () => {
    _dragGhost?.remove(); _dragGhost = null;
    el.classList.remove('opacity-40');
  });
}

/** Visar bekräftelsedialog innan mappflytt, sedan undo-toast */
function _confirmAndMoveFolder(sourcePath, sourceName, targetPath, targetName) {
  const m = document.createElement('div');
  m.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4';
  m.innerHTML = `
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
    <div class="relative bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm">
      <div class="px-5 py-4 border-b border-slate-700">
        <h2 class="text-sm font-semibold text-white">Flytta mapp</h2>
      </div>
      <div class="px-5 py-4 space-y-1 text-sm text-slate-300">
        <p>Flytta <strong class="text-amber-400">${_esc(sourceName)}</strong></p>
        <p>till <strong class="text-white">${_esc(targetName)}</strong>?</p>
      </div>
      <div class="flex justify-end gap-2 px-5 py-4 border-t border-slate-700">
        <button id="cfm-cancel" class="px-4 py-2 text-sm text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-lg">Avbryt</button>
        <button id="cfm-ok" class="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-500 rounded-lg">Flytta</button>
      </div>
    </div>`;
  document.body.appendChild(m);

  const close = () => m.remove();
  m.querySelector('.absolute')?.addEventListener('click', close);
  document.getElementById('cfm-cancel')?.addEventListener('click', close);

  const onKey = (/** @type {KeyboardEvent} */ ev) => {
    if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);

  document.getElementById('cfm-ok')?.addEventListener('click', async () => {
    const okBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('cfm-ok'));
    if (okBtn) { okBtn.disabled = true; okBtn.textContent = 'Flyttar…'; }
    try {
      await api.moveFolderTo({ folderPath: sourcePath, targetRoot: targetPath });
      close();
      document.removeEventListener('keydown', onKey);
      _refreshTree();
      if (activeFolderKey) selectFolder(activeFolderKey, _treeData);

      // Undo-toast (8 sek)
      const origDir = sourcePath.replace(/[\\/][^\\/]+$/, '');
      const newLoc  = targetPath.replace(/\\/g, '/') + '/' + sourceName;
      toastWithUndo(
        `"${sourceName}" flyttad till "${targetName}"`,
        async () => {
          try {
            await api.moveFolderTo({ folderPath: newLoc, targetRoot: origDir });
            _refreshTree();
            if (activeFolderKey) selectFolder(activeFolderKey, _treeData);
            toast(`Ångrat — "${sourceName}" återställd`, 'success');
          } catch (err) {
            toast('Kunde inte ångra: ' + err.message, 'error');
          }
        },
        () => {},
        8000,
      );
    } catch (err) {
      close();
      document.removeEventListener('keydown', onKey);
      toast(`Kunde inte flytta: ${err.message}`, 'error');
    }
  });
}

// Drop target för vänsterträdets rader (befintlig funktion, nu med båda asset och folder drop)
function _makeTreeDropTarget(btn, targetPath, label) {
  const hl  = () => btn.classList.add('ring-2', 'ring-blue-400', 'bg-blue-900/30');
  const uhl = () => btn.classList.remove('ring-2', 'ring-blue-400', 'bg-blue-900/30');

  btn.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; hl(); });
  btn.addEventListener('dragleave', (ev) => { if (!btn.contains(ev.relatedTarget)) uhl(); });
  btn.addEventListener('drop', async (e) => {
    e.preventDefault(); uhl();

    const assetJson  = e.dataTransfer.getData('application/pm-asset-ids');
    const folderPath = e.dataTransfer.getData('application/pm-folder-path');
    const folderName = e.dataTransfer.getData('application/pm-folder-name');

    if (assetJson) {
      let ids;
      try { ids = JSON.parse(assetJson); } catch { return; }
      if (ids?.length) await _moveFilesTo(ids, targetPath, label);
    } else if (folderPath && folderPath !== targetPath && !targetPath.startsWith(folderPath + '/')) {
      _confirmAndMoveFolder(folderPath, folderName, targetPath, label);
    }
  });
}

function _moveFilesTo(ids, targetFolder, targetLabel) {
  const n = ids.length;
  const label = `${n} fil${n > 1 ? 'er' : ''}`;

  // Spara ursprungsinfo för undo (asset → source_folder)
  const originMap = {};
  ids.forEach((id) => {
    const a = allAssets.find((x) => x.id === id);
    if (a) originMap[id] = a.source_folder ?? null;
  });

  const m = document.createElement('div');
  m.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4';
  m.innerHTML = `
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
    <div class="relative bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-6 max-w-sm w-full space-y-4">
      <h3 class="text-base font-semibold text-white">Flytta filer</h3>
      <p class="text-sm text-slate-300">Flytta <strong>${label}</strong> till <strong>${_esc(targetLabel)}</strong>?</p>
      <div class="flex justify-end gap-2 pt-1">
        <button id="mf-cancel" class="px-4 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors">Avbryt</button>
        <button id="mf-ok"     class="px-4 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors">Flytta</button>
      </div>
    </div>`;
  document.body.appendChild(m);

  const close = () => m.remove();
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  m.querySelector('#mf-cancel')?.addEventListener('click', () => { close(); document.removeEventListener('keydown', onKey); });
  m.addEventListener('click', (e) => { if (e.target === m) { close(); document.removeEventListener('keydown', onKey); } });

  m.querySelector('#mf-ok')?.addEventListener('click', async () => {
    const okBtn = /** @type {HTMLButtonElement|null} */ (m.querySelector('#mf-ok'));
    if (okBtn) { okBtn.disabled = true; okBtn.textContent = 'Flyttar…'; }
    document.removeEventListener('keydown', onKey);
    try {
      const { data } = await api.moveFiles({ assetIds: ids, targetFolder });
      close();
      if (data.moved.length > 0) {
        const grid = document.getElementById('folder-grid');
        const list = document.getElementById('folder-list');
        data.moved.forEach((id) => {
          grid?.querySelector(`[data-id="${id}"]`)?.remove();
          list?.querySelector(`[data-id="${id}"]`)?.remove();
        });
        const movedAssets = allAssets.filter((a) => data.moved.includes(a.id));
        allAssets = allAssets.filter((a) => !data.moved.includes(a.id));
        sel?.clearAll();
        _updateStatus();
        toastWithUndo(
          `${data.moved.length} fil${data.moved.length > 1 ? 'er' : ''} flyttad${data.moved.length > 1 ? 'e' : ''} till "${targetLabel}"`,
          async () => {
            try {
              // Flytta tillbaka varje fil till sin ursprungsmapp
              const undoGroups = {};
              data.moved.forEach((id) => {
                const orig = originMap[id];
                if (!orig) return;
                if (!undoGroups[orig]) undoGroups[orig] = [];
                undoGroups[orig].push(id);
              });
              await Promise.all(
                Object.entries(undoGroups).map(([origFolder, fileIds]) =>
                  api.moveFiles({ assetIds: fileIds, targetFolder: origFolder }).catch(() => {})
                )
              );
              movedAssets.forEach((a) => allAssets.push(a));
              allAssets.sort((a, b) => (a.taken_at ?? '').localeCompare(b.taken_at ?? ''));
              _rerenderCurrentAssets();
              toast('Ångrat — filer återställda', 'success');
            } catch (err) {
              toast('Ångra misslyckades: ' + err.message, 'error');
            }
          }
        );
      }
      if (data.errors.length > 0) {
        toast(`${data.errors.length} fil${data.errors.length > 1 ? 'er' : ''} kunde inte flyttas`, 'error');
      }
    } catch (err) {
      close();
      toast('Flytten misslyckades: ' + err.message, 'error');
    }
  });
}

// ── Kontextmeny för mappar ────────────────────────────────────────────────────

let _ctxMenu = null;

function _closeCtxMenu() { _ctxMenu?.remove(); _ctxMenu = null; }

function _showFolderCtxMenu(event, folder, tree) {
  _closeCtxMenu();
  const menu = document.createElement('div');
  menu.id = 'folder-ctx-menu';
  menu.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;z-index:9000;
    background:#1e293b;border:1px solid rgba(255,255,255,.12);border-radius:8px;
    box-shadow:0 8px 32px rgba(0,0,0,.6);min-width:190px;overflow:hidden;`;

  const items = [
    { icon: '📁', label: 'Öppna', action: () => {
      const key = folder.watchedFolder + '|' + (folder.fullPath !== folder.watchedFolder
        ? folder.fullPath.slice(folder.watchedFolder.length + 1) : '');
      selectFolder(key, _treeData);
    }},
    { separator: true },
    { icon: '📁', label: 'Ny mapp här', action: () => _showCreateFolderDialog(folder, tree) },
    { icon: '✏️', label: 'Byt namn  (F2)', action: () => _showRenameDialog(folder, tree) },
    { icon: '📂', label: 'Flytta till...', action: () => _showMoveFolderModal(folder, tree) },
    { separator: true },
    { icon: '🗑️', label: 'Radera mapp', action: () => _showDeleteFolderDialog(folder, tree), danger: true },
  ];

  items.forEach(({ icon, label, action, danger, separator }) => {
    if (separator) {
      const div = document.createElement('div');
      div.className = 'h-px bg-slate-700 mx-2 my-1';
      menu.appendChild(div);
      return;
    }
    const btn = document.createElement('button');
    btn.className = `w-full text-left flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${danger ? 'text-red-400 hover:bg-red-900/30' : 'text-slate-200 hover:bg-slate-700/60'}`;
    btn.innerHTML = `<span>${icon}</span><span>${label}</span>`;
    btn.addEventListener('click', () => { _closeCtxMenu(); action?.(); });
    menu.appendChild(btn);
  });

  _ctxMenu = menu;
  document.body.appendChild(menu);
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right  > window.innerWidth)  menu.style.left = (event.clientX - rect.width)  + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top  = (event.clientY - rect.height) + 'px';
  });
}

// ── Modaler / dialoger ────────────────────────────────────────────────────────

function _showInputModal({ title, label, defaultValue = '', confirmText = 'OK', onConfirm }) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';
  const modal = document.createElement('div');
  modal.className = 'bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-96 flex flex-col';
  modal.innerHTML = `
    <div class="flex items-center justify-between px-4 py-3 border-b border-slate-700">
      <h3 class="text-white font-medium text-sm">${_esc(title)}</h3>
      <button class="modal-close text-slate-400 hover:text-white text-lg leading-none">✕</button>
    </div>
    <div class="px-4 py-4">
      <label class="block text-xs text-slate-400 mb-1">${_esc(label)}</label>
      <input class="modal-input w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
             type="text" value="${_esc(defaultValue)}" autocomplete="off" spellcheck="false">
    </div>
    <div class="px-4 py-3 border-t border-slate-700 flex justify-end gap-2">
      <button class="modal-cancel px-3 py-1.5 text-sm text-slate-300 hover:text-white rounded hover:bg-slate-700">Avbryt</button>
      <button class="modal-ok px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded">${_esc(confirmText)}</button>
    </div>`;
  const close = () => overlay.remove();
  const input = /** @type {HTMLInputElement|null} */ (modal.querySelector('.modal-input'));
  const submit = () => {
    const val = input?.value.trim();
    if (!val) { input?.focus(); return; }
    close();
    onConfirm(val);
  };
  modal.querySelector('.modal-close')?.addEventListener('click', close);
  modal.querySelector('.modal-cancel')?.addEventListener('click', close);
  modal.querySelector('.modal-ok')?.addEventListener('click', submit);
  input?.addEventListener('keydown', (e) => {
    if (/** @type {KeyboardEvent} */ (e).key === 'Enter')  submit();
    if (/** @type {KeyboardEvent} */ (e).key === 'Escape') close();
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => { input?.focus(); input?.select(); });
}

function _showCreateFolderDialog(folder, tree) {
  _showInputModal({
    title: `Ny mapp i "${folder.label}"`,
    label: 'Mappnamn',
    confirmText: 'Skapa',
    onConfirm: (name) => {
      api.createFolder({ parentPath: folder.fullPath, folderName: name })
        .then(() => { toast(`Mappen "${name}" skapades`, 'success'); return _refreshTree(); })
        .catch((err) => toast('Kunde inte skapa mapp: ' + err.message, 'error'));
    },
  });
}

function _showRenameDialog(folder, tree) {
  _showInputModal({
    title: `Byt namn på "${folder.label}"`,
    label: 'Nytt namn',
    defaultValue: folder.label,
    confirmText: 'Byt namn',
    onConfirm: (newName) => {
      if (newName === folder.label) return;
      api.renameFolder({ oldPath: folder.fullPath, newName })
        .then(() => { toast(`Mapp bytte namn till "${newName}"`, 'success'); return _refreshTree(); })
        .catch((err) => toast('Kunde inte byta namn: ' + err.message, 'error'));
    },
  });
}

function _showMoveFolderModal(folder, tree) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';
  const modal = document.createElement('div');
  modal.className = 'bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-80 flex flex-col max-h-[60vh]';
  modal.innerHTML = `
    <div class="flex items-center justify-between px-4 py-3 border-b border-slate-700">
      <h3 class="text-white font-medium text-sm">Flytta "${_esc(folder.label)}" till...</h3>
      <button id="mf-close" class="text-slate-400 hover:text-white">✕</button>
    </div>
    <div class="overflow-y-auto flex-1 py-2" id="mf-list"></div>
    <div class="px-4 py-3 border-t border-slate-700 flex justify-end gap-2">
      <button id="mf-cancel" class="px-3 py-1.5 text-sm text-slate-300 hover:text-white rounded hover:bg-slate-700">Avbryt</button>
      <button id="mf-confirm" class="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40" disabled>Flytta</button>
    </div>`;

  let selectedTarget = null;
  const listEl = modal.querySelector('#mf-list');

  // Visa alla bevakade mappar + deras undermappar som mål (hoppa över källa och dess barn)
  tree.forEach((wf) => {
    const addEntry = (path, label, depth) => {
      // Hoppa över källmappen och allt inuti den
      if (path === folder.fullPath || path.startsWith(folder.fullPath + '/')) return;
      const btn = document.createElement('button');
      btn.className = 'w-full text-left flex items-center gap-2 py-1.5 text-sm text-slate-300 hover:bg-slate-700/60 transition-colors';
      btn.style.paddingLeft = (16 + depth * 14) + 'px';
      btn.innerHTML = `<svg class="w-4 h-4 text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/></svg><span>${_esc(label)}</span>`;
      btn.addEventListener('click', () => {
        listEl?.querySelectorAll('button').forEach((b) => b.classList.remove('bg-blue-600/30', 'text-white'));
        btn.classList.add('bg-blue-600/30', 'text-white');
        selectedTarget = path;
        /** @type {HTMLButtonElement|null} */ (modal.querySelector('#mf-confirm'))?.removeAttribute('disabled');
      });
      listEl?.appendChild(btn);
    };
    addEntry(wf.watchedFolder, wf.label, 0);
    wf.subfolders.forEach((sf) => {
      addEntry(wf.watchedFolder + '/' + sf.path, sf.label, sf.path.split('/').length);
    });
  });

  const close = () => overlay.remove();
  modal.querySelector('#mf-close')?.addEventListener('click', close);
  modal.querySelector('#mf-cancel')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  modal.querySelector('#mf-confirm')?.addEventListener('click', async () => {
    if (!selectedTarget) return;
    const btn = /** @type {HTMLButtonElement|null} */ (modal.querySelector('#mf-confirm'));
    if (btn) { btn.disabled = true; btn.textContent = 'Flyttar...'; }
    const origParent = folder.fullPath.includes('/')
      ? folder.fullPath.substring(0, folder.fullPath.lastIndexOf('/'))
      : folder.watchedFolder;
    const newLoc = selectedTarget + '/' + folder.label;
    const targetLabel = selectedTarget.split('/').pop() ?? selectedTarget;
    try {
      await api.moveFolderTo({ folderPath: folder.fullPath, targetRoot: selectedTarget });
      close();
      _refreshTree();
      if (activeFolderKey) selectFolder(activeFolderKey, _treeData);
      toastWithUndo(
        `"${folder.label}" flyttad till "${targetLabel}"`,
        async () => {
          try {
            await api.moveFolderTo({ folderPath: newLoc, targetRoot: origParent });
            _refreshTree();
            if (activeFolderKey) selectFolder(activeFolderKey, _treeData);
            toast(`Ångrat — "${folder.label}" återställd`, 'success');
          } catch (err) {
            toast('Ångra misslyckades: ' + err.message, 'error');
          }
        }
      );
    } catch (err) {
      close();
      toast('Flytten misslyckades: ' + err.message, 'error');
    }
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function _showDeleteFolderDialog(folder, tree) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';
  const modal = document.createElement('div');
  modal.className = 'bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-96 flex flex-col';
  modal.innerHTML = `
    <div class="flex items-center justify-between px-4 py-3 border-b border-slate-700">
      <h3 class="text-white font-medium text-sm">Radera mapp</h3>
      <button class="modal-close text-slate-400 hover:text-white text-lg leading-none">✕</button>
    </div>
    <div class="px-4 py-4 text-sm text-slate-300 space-y-2">
      <p>Radera mappen <span class="text-white font-medium">"${_esc(folder.label)}"</span>?</p>
      <p class="text-slate-400 text-xs">Alla foton i mappen skickas till papperskorgen. Filerna på disk tas inte bort.</p>
    </div>
    <div class="px-4 py-3 border-t border-slate-700 flex justify-end gap-2">
      <button class="modal-cancel px-3 py-1.5 text-sm text-slate-300 hover:text-white rounded hover:bg-slate-700">Avbryt</button>
      <button class="modal-ok px-4 py-1.5 text-sm bg-red-600 hover:bg-red-500 text-white rounded">Radera</button>
    </div>`;
  const close = () => overlay.remove();
  modal.querySelector('.modal-close')?.addEventListener('click', close);
  modal.querySelector('.modal-cancel')?.addEventListener('click', close);
  overlay.addEventListener('keydown', (e) => { if (/** @type {KeyboardEvent} */ (e).key === 'Escape') close(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  modal.querySelector('.modal-ok')?.addEventListener('click', () => {
    close();
    api.trashFolder({ folderPath: folder.fullPath })
      .then(({ data }) => {
        toast(`${data.trashedCount} foto${data.trashedCount !== 1 ? 'n' : ''} skickade till papperskorgen`, 'success');
        _refreshTree();
        if (activeFolderKey) selectFolder(activeFolderKey, _treeData);
      })
      .catch((err) => toast('Kunde inte radera: ' + err.message, 'error'));
  });
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => /** @type {HTMLElement|null} */ (modal.querySelector('.modal-ok'))?.focus());
}

// ── Flytta-modal (filer) ──────────────────────────────────────────────────────

async function _showMoveFilesModal(assetIds) {
  let tree;
  try { ({ data: tree } = await api.folderTree()); }
  catch { toast('Kunde inte ladda mappar', 'error'); return; }

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';
  const modal = document.createElement('div');
  modal.className = 'bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-80 max-h-[70vh] flex flex-col';
  modal.innerHTML = `
    <div class="flex items-center justify-between px-4 py-3 border-b border-slate-700">
      <h3 class="text-white font-medium text-sm">Flytta ${assetIds.length} fil${assetIds.length > 1 ? 'er' : ''} till...</h3>
      <button id="mv-close" class="text-slate-400 hover:text-white">✕</button>
    </div>
    <div class="overflow-y-auto flex-1 py-2" id="mv-folder-list"></div>
    <div class="px-4 py-3 border-t border-slate-700 flex justify-end gap-2">
      <button id="mv-cancel" class="px-3 py-1.5 text-sm text-slate-300 hover:text-white rounded hover:bg-slate-700">Avbryt</button>
      <button id="mv-confirm" class="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40" disabled>Flytta</button>
    </div>`;

  let selectedTarget = null;
  let selectedLabel  = '';
  const folderList = modal.querySelector('#mv-folder-list');

  tree.forEach((wf) => {
    const addEntry = (path, label, depth) => {
      const btn = document.createElement('button');
      btn.className = 'w-full text-left flex items-center gap-2 py-1.5 text-sm text-slate-300 hover:bg-slate-700/60 transition-colors';
      btn.style.paddingLeft = (16 + depth * 14) + 'px';
      btn.dataset.path = path;
      btn.innerHTML = `<svg class="w-4 h-4 text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/></svg><span class="truncate">${_esc(label)}</span>`;
      btn.addEventListener('click', () => {
        folderList?.querySelectorAll('button').forEach((b) => b.classList.remove('bg-blue-600/30', 'text-white'));
        btn.classList.add('bg-blue-600/30', 'text-white');
        selectedTarget = path;
        selectedLabel  = label;
        /** @type {HTMLButtonElement|null} */ (modal.querySelector('#mv-confirm'))?.removeAttribute('disabled');
      });
      folderList?.appendChild(btn);
    };
    addEntry(wf.watchedFolder, wf.label, 0);
    wf.subfolders.forEach((sf) => {
      addEntry(wf.watchedFolder + '/' + sf.path, sf.label, sf.path.split('/').length);
    });
  });

  const close = () => overlay.remove();
  modal.querySelector('#mv-close')?.addEventListener('click', close);
  modal.querySelector('#mv-cancel')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  modal.querySelector('#mv-confirm')?.addEventListener('click', async () => {
    if (!selectedTarget) return;
    const confirmBtn = /** @type {HTMLButtonElement|null} */ (modal.querySelector('#mv-confirm'));
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Flyttar...'; }
    try {
      await _moveFilesTo(assetIds, selectedTarget, selectedLabel);
      close();
    } catch (err) {
      close();
      toast('Flytten misslyckades: ' + err.message, 'error');
    }
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// ── Ladda om trädet ───────────────────────────────────────────────────────────

async function _refreshTree() {
  try {
    const { data: tree } = await api.folderTree();
    _treeData = tree;
    if (_container) _renderTree(_container, tree);
    _updateActiveFolder(activeFolderKey);
    if (activeFolderKey) selectFolder(activeFolderKey, _treeData);
  } catch {}
}

// ── Vy-helpers ────────────────────────────────────────────────────────────────

function _updateViewButtons(container) {
  const gridBtn = container.querySelector('#view-grid-btn');
  const listBtn = container.querySelector('#view-list-btn');
  if (!gridBtn || !listBtn) return;
  gridBtn.classList.toggle('text-white',    viewMode === 'grid');
  gridBtn.classList.toggle('bg-slate-700',  viewMode === 'grid');
  gridBtn.classList.toggle('text-slate-400', viewMode !== 'grid');
  listBtn.classList.toggle('text-white',    viewMode === 'list');
  listBtn.classList.toggle('bg-slate-700',  viewMode === 'list');
  listBtn.classList.toggle('text-slate-400', viewMode !== 'list');
  const grid = document.getElementById('folder-grid');
  const list = document.getElementById('folder-list');
  if (grid) grid.classList.toggle('hidden', viewMode === 'list');
  if (list) list.classList.toggle('hidden', viewMode === 'grid');
  _syncSubfolderView();
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function _splitKey(key) {
  const idx = key.indexOf('|');
  return [key.slice(0, idx), key.slice(idx + 1) || ''];
}

function _esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)   return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
