import { api } from '../api.js';
import { buildPhotoCell } from '../components/gridCell.js';
import { createSelectionManager } from '../components/selectionManager.js';
import { openLightbox } from '../components/lightbox.js';
import { toast } from '../utils.js';

let viewMode   = 'grid';
let allAssets  = [];
let sel        = null;
let nextCursor = null;
let hasMore    = false;
let activeFolderKey = null;
let _treeData  = [];
let _container = null;
let _recursive = true; // inkludera undermappar

// DEL-tangent: radera markerade bilder i mappvyn
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Delete') return;
  if (document.getElementById('lightbox')?.classList.contains('open')) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (sel && activeFolderKey) sel.deleteSelected();
});

// Synka grid när lightbox raderar/återställer en bild
window.addEventListener('pm:asset-trashed', (e) => {
  const id = e.detail?.id;
  if (!id) return;
  allAssets = allAssets.filter((a) => a.id !== id);
  document.getElementById('folder-grid')?.querySelector(`[data-id="${id}"]`)?.remove();
  document.getElementById('folder-list')?.querySelector(`[data-id="${id}"]`)?.remove();
});

window.addEventListener('pm:asset-restored', (e) => {
  const { asset, index } = e.detail ?? {};
  if (!asset || !activeFolderKey) return;
  const insertAt = typeof index === 'number' ? index : allAssets.length;
  allAssets.splice(insertAt, 0, asset);
  const grid = document.getElementById('folder-grid');
  if (!grid) return;
  const cell = buildPhotoCell(asset, () => openLightbox(allAssets, allAssets.indexOf(asset)));
  sel?.attachToCell(cell, asset, insertAt);
  makeDraggable(cell, asset);
  grid.insertBefore(cell, grid.children[insertAt] ?? null);
});

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
          <label id="recursive-toggle" class="flex items-center gap-1.5 cursor-pointer text-xs text-slate-400 hover:text-slate-200 select-none shrink-0" title="Visa foton från alla undermappar">
            <input type="checkbox" id="recursive-cb" class="w-3.5 h-3.5 accent-blue-500 cursor-pointer" checked>
            <span>Inkl. undermappar</span>
          </label>
          <div class="w-px h-5 bg-slate-700 shrink-0"></div>
          <div class="flex gap-1 shrink-0">
            <button id="view-grid-btn" title="Rutnät"
              class="p-1.5 rounded hover:bg-slate-700 transition-colors">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/>
              </svg>
            </button>
            <button id="view-list-btn" title="Lista"
              class="p-1.5 rounded hover:bg-slate-700 transition-colors">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 4h18v2H3zm0 7h18v2H3zm0 7h18v2H3z"/>
              </svg>
            </button>
          </div>
        </div>
        <!-- Brödsmula -->
        <div id="folder-breadcrumb" class="px-4 py-1.5 text-xs text-slate-400 border-b border-slate-700/50 min-h-[2rem] flex items-center"></div>
        <!-- Innehållsyta -->
        <div class="flex-1 overflow-y-auto p-3" id="folder-scroll-area">
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

  updateViewButtons(container);
  container.querySelector('#view-grid-btn').addEventListener('click', () => {
    viewMode = 'grid'; updateViewButtons(container); rerenderCurrentAssets();
  });
  container.querySelector('#view-list-btn').addEventListener('click', () => {
    viewMode = 'list'; updateViewButtons(container); rerenderCurrentAssets();
  });
  container.querySelector('#recursive-cb').addEventListener('change', (e) => {
    _recursive = e.target.checked;
    if (activeFolderKey) selectFolder(activeFolderKey, _treeData);
  });

  container.querySelector('#folder-empty').classList.remove('hidden');

  sel = createSelectionManager(
    () => document.getElementById('folder-grid'),
    () => allAssets,
    [{
      label: '📂 Flytta till...',
      className: 'flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 px-2 py-1 rounded hover:bg-slate-700 transition-colors',
      onClick: (ids) => showMoveModal(ids),
    }]
  );
  document.getElementById('folder-sel-toolbar').innerHTML = '';

  container.querySelector('#load-more-btn')?.addEventListener('click', loadMoreAssets);

  // Stäng kontextmeny vid klick utanför
  document.addEventListener('click', closeContextMenu, { capture: true });

  try {
    const { data: tree } = await api.folderTree();
    _treeData = tree;
    renderTree(container, tree);
  } catch {
    document.getElementById('folder-tree-inner').innerHTML =
      '<div class="px-3 text-red-400 text-xs py-2">Kunde inte ladda mappar</div>';
  }
}

// ── Trädrendering ────────────────────────────────────────────────────────────

function renderTree(container, tree) {
  const inner = document.getElementById('folder-tree-inner');
  if (!tree || tree.length === 0) {
    inner.innerHTML = '<div class="px-3 text-slate-500 text-xs py-2">Inga bevakade mappar</div>';
    return;
  }

  inner.innerHTML = '';

  tree.forEach((wf) => {
    const rootKey = wf.watchedFolder + '|';

    // Root-mapp (bevakad mapp) — bara navigering, ingen kontextmeny
    const rootBtn = document.createElement('button');
    rootBtn.dataset.key = rootKey;
    rootBtn.className = 'folder-item folder-drop-target w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700/60 transition-colors rounded';
    rootBtn.innerHTML = `
      <svg class="w-4 h-4 text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
        <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/>
      </svg>
      <span class="truncate flex-1">${esc(wf.label)}</span>
      <span class="text-slate-500 text-xs shrink-0">(${wf.totalAssetCount})</span>`;
    rootBtn.addEventListener('click', () => selectFolder(rootKey, tree));
    rootBtn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showFolderContextMenu(e, { label: wf.label, fullPath: wf.watchedFolder, watchedFolder: wf.watchedFolder }, tree);
    });
    makeDropTarget(rootBtn, wf.watchedFolder, wf.label);
    inner.appendChild(rootBtn);

    wf.subfolders.forEach((sf) => {
      const key   = wf.watchedFolder + '|' + sf.path;
      const depth = sf.path.split('/').length;
      const fullPath = wf.watchedFolder + '/' + sf.path;

      const sfBtn = document.createElement('button');
      sfBtn.dataset.key  = key;
      sfBtn.dataset.path = fullPath;
      sfBtn.className = 'folder-item w-full text-left flex items-center gap-2 py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700/40 transition-colors rounded';
      sfBtn.style.paddingLeft = (8 + depth * 14) + 'px';
      sfBtn.innerHTML = `
        <svg class="w-3.5 h-3.5 text-slate-500 shrink-0" fill="currentColor" viewBox="0 0 24 24">
          <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/>
        </svg>
        <span class="truncate flex-1">${esc(sf.label)}</span>
        <span class="text-slate-600 text-xs shrink-0">(${sf.assetCount})</span>`;
      sfBtn.addEventListener('click', () => selectFolder(key, tree));
      sfBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showFolderContextMenu(e, { label: sf.label, fullPath, watchedFolder: wf.watchedFolder }, tree);
      });
      inner.appendChild(sfBtn);
    });
  });
}

function updateActiveFolder(key) {
  activeFolderKey = key;
  document.querySelectorAll('.folder-item').forEach((btn) => {
    const active = btn.dataset.key === key;
    btn.classList.toggle('bg-blue-600/30', active);
    btn.classList.toggle('text-white',     active);
  });
}

// ── Ladda bilder ─────────────────────────────────────────────────────────────

async function selectFolder(key, tree) {
  updateActiveFolder(key);
  const [watchedFolder, subpath] = splitKey(key);

  const wf    = tree.find((w) => w.watchedFolder === watchedFolder);
  const rootLabel = wf ? wf.label : watchedFolder.split('/').pop();
  const breadcrumb = document.getElementById('folder-breadcrumb');
  if (breadcrumb) {
    if (subpath) {
      // Visa varje nivå som ett klickbart segment
      const parts = subpath.split('/');
      const segs = [rootLabel, ...parts];
      breadcrumb.innerHTML = segs.map((s, i) => {
        if (i === segs.length - 1) return `<span class="text-slate-200">${esc(s)}</span>`;
        const key = watchedFolder + '|' + parts.slice(0, i).join('/');
        return `<button class="hover:text-white transition-colors" data-bc-key="${esc(key)}">${esc(s)}</button>`;
      }).join('<span class="mx-1 text-slate-600">›</span>');
      breadcrumb.querySelectorAll('[data-bc-key]').forEach((btn) => {
        btn.addEventListener('click', () => selectFolder(btn.dataset.bcKey, tree));
      });
    } else {
      breadcrumb.textContent = rootLabel;
    }
  }

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

  if (grid)    grid.innerHTML    = '';
  if (list)    list.innerHTML    = '';
  if (empty)   empty.classList.add('hidden');
  if (loading) loading.classList.remove('hidden');
  if (loadMore) loadMore.classList.add('hidden');

  try {
    const fullPath = subpath ? (watchedFolder.replace(/\/$/, '') + '/' + subpath) : watchedFolder;
    const params = { folderPath: fullPath, limit: 100, sort: 'taken_at', order: 'desc', recursive: _recursive };

    const { data: items, meta } = await api.assets(params);
    if (loading) loading.classList.add('hidden');

    allAssets  = items;
    nextCursor = meta.nextCursor;
    hasMore    = meta.hasMore;

    if (items.length === 0) { if (empty) empty.classList.remove('hidden'); return; }

    renderAssets(items);
    if (hasMore && loadMore) loadMore.classList.remove('hidden');
  } catch (err) {
    if (loading) loading.classList.add('hidden');
    toast('Kunde inte ladda bilder: ' + err.message, 'error');
  }
}

async function loadMoreAssets() {
  if (!nextCursor || !activeFolderKey) return;
  const [watchedFolder, subpath] = splitKey(activeFolderKey);
  const fullPath = subpath ? (watchedFolder.replace(/\/$/, '') + '/' + subpath) : watchedFolder;
  const params = { folderPath: fullPath, limit: 100, sort: 'taken_at', order: 'desc', cursor: nextCursor, recursive: _recursive };

  try {
    const { data: items, meta } = await api.assets(params);
    allAssets  = allAssets.concat(items);
    nextCursor = meta.nextCursor;
    hasMore    = meta.hasMore;
    renderAssets(items);
    if (!hasMore) document.getElementById('folder-load-more')?.classList.add('hidden');
  } catch (err) {
    toast('Kunde inte ladda fler: ' + err.message, 'error');
  }
}

function renderAssets(items) {
  if (viewMode === 'grid') {
    const grid = document.getElementById('folder-grid');
    if (!grid) return;
    items.forEach((asset, i) => {
      const idx  = allAssets.length - items.length + i;
      const cell = buildPhotoCell(asset, () => openLightbox(allAssets, allAssets.indexOf(asset)));
      sel?.attachToCell(cell, asset, idx);
      makeDraggable(cell, asset);
      grid.appendChild(cell);
    });
  } else {
    renderListItems(items);
  }
}

function renderListItems(items) {
  const list = document.getElementById('folder-list');
  if (!list) return;
  items.forEach((asset) => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-3 px-2 py-2 hover:bg-slate-700/40 rounded cursor-pointer text-sm';
    row.dataset.id = asset.id;
    const thumb = asset.thumb_small_path
      ? `<img src="/thumbs/${asset.thumb_small_path}" class="w-10 h-10 object-cover rounded shrink-0">`
      : '<div class="w-10 h-10 bg-slate-700 rounded shrink-0"></div>';
    const date = asset.taken_at ? new Date(asset.taken_at).toLocaleDateString('sv-SE') : '—';
    const size = asset.file_size ? formatBytes(asset.file_size) : '—';
    row.innerHTML = `${thumb}
      <span class="flex-1 truncate text-slate-200">${esc(asset.file_name)}</span>
      <span class="text-slate-500 shrink-0 w-24 text-right">${date}</span>
      <span class="text-slate-500 shrink-0 w-16 text-right">${size}</span>`;
    row.addEventListener('click', () => openLightbox(allAssets, allAssets.indexOf(asset)));
    makeDraggable(row, asset);
    list.appendChild(row);
  });
}

function rerenderCurrentAssets() {
  const grid = document.getElementById('folder-grid');
  const list = document.getElementById('folder-list');
  if (!grid || !list) return;

  if (viewMode === 'grid') {
    list.classList.add('hidden');
    grid.classList.remove('hidden');
    grid.innerHTML = '';
    allAssets.forEach((asset, i) => {
      const cell = buildPhotoCell(asset, () => openLightbox(allAssets, i));
      sel?.attachToCell(cell, asset, i);
      makeDraggable(cell, asset);
      grid.appendChild(cell);
    });
  } else {
    grid.classList.add('hidden');
    list.classList.remove('hidden');
    list.innerHTML = '';
    renderListItems(allAssets);
  }
}

// ── Drag-and-drop för foton ──────────────────────────────────────────────────

let _dragGhost = null;

function makeDraggable(el, asset) {
  el.draggable = true;

  el.addEventListener('dragstart', (e) => {
    // Samla IDs: om asset ingår i urval → dra alla markerade, annars bara den enstaka
    const grid = document.getElementById('folder-grid');
    const checkedIds = grid
      ? [...grid.querySelectorAll('.sel-checkbox:checked')].map((cb) => cb.closest('[data-id]')?.dataset.id).filter(Boolean)
      : [];

    const ids = checkedIds.includes(asset.id) ? checkedIds : [asset.id];
    e.dataTransfer.setData('text/plain', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';

    // Ghost-badge
    _dragGhost = document.createElement('div');
    _dragGhost.style.cssText = 'position:fixed;top:-200px;left:0;z-index:9999;background:#3b82f6;color:#fff;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap;pointer-events:none;';
    _dragGhost.textContent = ids.length === 1 ? '1 bild' : `${ids.length} bilder`;
    document.body.appendChild(_dragGhost);
    e.dataTransfer.setDragImage(_dragGhost, -10, -10);

    // Visuell feedback på dragna element
    requestAnimationFrame(() => {
      if (checkedIds.length > 1) {
        const gridEl = document.getElementById('folder-grid');
        gridEl?.querySelectorAll('.sel-checkbox:checked').forEach((cb) => {
          cb.closest('[data-id]')?.classList.add('opacity-40');
        });
      } else {
        el.classList.add('opacity-40');
      }
    });
  });

  el.addEventListener('dragend', () => {
    _dragGhost?.remove();
    _dragGhost = null;
    document.querySelectorAll('#folder-grid [data-id], #folder-list [data-id]').forEach((c) => {
      c.classList.remove('opacity-40');
    });
  });
}

function makeDropTarget(btn, watchedFolder, label) {
  btn.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    btn.classList.add('ring-2', 'ring-blue-400', 'bg-blue-900/30');
  });

  btn.addEventListener('dragleave', (e) => {
    if (!btn.contains(e.relatedTarget)) {
      btn.classList.remove('ring-2', 'ring-blue-400', 'bg-blue-900/30');
    }
  });

  btn.addEventListener('drop', async (e) => {
    e.preventDefault();
    btn.classList.remove('ring-2', 'ring-blue-400', 'bg-blue-900/30');

    let ids;
    try { ids = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    if (!ids?.length) return;

    await moveFilesTo(ids, watchedFolder, label);
  });
}

async function moveFilesTo(ids, targetFolder, targetLabel) {
  try {
    const { data } = await api.moveFiles({ assetIds: ids, targetFolder });

    if (data.moved.length > 0) {
      const grid = document.getElementById('folder-grid');
      const list = document.getElementById('folder-list');
      data.moved.forEach((id) => {
        grid?.querySelector(`[data-id="${id}"]`)?.remove();
        list?.querySelector(`[data-id="${id}"]`)?.remove();
      });
      allAssets = allAssets.filter((a) => !data.moved.includes(a.id));
      sel?.clearAll();
      const n = data.moved.length;
      toast(`${n} fil${n > 1 ? 'er' : ''} flyttad${n > 1 ? 'e' : ''} till ${targetLabel}`, 'success');
    }

    if (data.errors.length > 0) {
      toast(`${data.errors.length} fil${data.errors.length > 1 ? 'er' : ''} kunde inte flyttas`, 'error');
    }
  } catch (err) {
    toast('Flytten misslyckades: ' + err.message, 'error');
  }
}

// ── Kontextmeny för mappar ───────────────────────────────────────────────────

let _ctxMenu = null;

function closeContextMenu() {
  _ctxMenu?.remove();
  _ctxMenu = null;
}

function showFolderContextMenu(event, folder, tree) {
  closeContextMenu();

  const menu = document.createElement('div');
  menu.id = 'folder-ctx-menu';
  menu.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;z-index:9000;
    background:#1e293b;border:1px solid rgba(255,255,255,.12);border-radius:8px;
    box-shadow:0 8px 32px rgba(0,0,0,.6);min-width:180px;overflow:hidden;`;

  const items = [
    { icon: '📁', label: 'Ny mapp här', action: () => showCreateFolderDialog(folder, tree) },
    { icon: '✏️', label: 'Byt namn', action: () => showRenameDialog(folder, tree) },
    { icon: '📂', label: 'Flytta mapp till...', action: () => showMoveFolderModal(folder, tree) },
    { icon: '🗑️', label: 'Radera mapp', action: () => showDeleteFolderDialog(folder, tree), danger: true },
  ];

  items.forEach(({ icon, label, action, danger }) => {
    const btn = document.createElement('button');
    btn.className = `w-full text-left flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${danger ? 'text-red-400 hover:bg-red-900/30' : 'text-slate-200 hover:bg-slate-700/60'}`;
    btn.innerHTML = `<span>${icon}</span><span>${label}</span>`;
    btn.addEventListener('click', () => { closeContextMenu(); action(); });
    menu.appendChild(btn);
  });

  _ctxMenu = menu;
  document.body.appendChild(menu);

  // Klipp till skärmen
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right  > window.innerWidth)  menu.style.left = (event.clientX - rect.width)  + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top  = (event.clientY - rect.height) + 'px';
  });
}

function showInputModal({ title, label, defaultValue = '', confirmText = 'OK', onConfirm }) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';

  const modal = document.createElement('div');
  modal.className = 'bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-96 flex flex-col';
  modal.innerHTML = `
    <div class="flex items-center justify-between px-4 py-3 border-b border-slate-700">
      <h3 class="text-white font-medium text-sm">${esc(title)}</h3>
      <button class="modal-close text-slate-400 hover:text-white text-lg leading-none">✕</button>
    </div>
    <div class="px-4 py-4">
      <label class="block text-xs text-slate-400 mb-1">${esc(label)}</label>
      <input class="modal-input w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
             type="text" value="${esc(defaultValue)}" autocomplete="off" spellcheck="false">
    </div>
    <div class="px-4 py-3 border-t border-slate-700 flex justify-end gap-2">
      <button class="modal-cancel px-3 py-1.5 text-sm text-slate-300 hover:text-white rounded hover:bg-slate-700">Avbryt</button>
      <button class="modal-ok px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded">${esc(confirmText)}</button>
    </div>`;

  const close = () => overlay.remove();
  const input = modal.querySelector('.modal-input');
  const ok    = modal.querySelector('.modal-ok');

  const submit = () => {
    const val = input.value.trim();
    if (!val) { input.focus(); return; }
    close();
    onConfirm(val);
  };

  modal.querySelector('.modal-close').addEventListener('click', close);
  modal.querySelector('.modal-cancel').addEventListener('click', close);
  ok.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') close();
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => { input.focus(); input.select(); });
}

function showCreateFolderDialog(folder, tree) {
  showInputModal({
    title: `Ny mapp i "${folder.label}"`,
    label: 'Mappnamn',
    confirmText: 'Skapa',
    onConfirm: (name) => {
      api.createFolder({ parentPath: folder.fullPath, folderName: name })
        .then(() => { toast(`Mappen "${name}" skapades`, 'success'); return refreshTree(); })
        .catch((err) => toast('Kunde inte skapa mapp: ' + err.message, 'error'));
    },
  });
}

function showRenameDialog(folder, tree) {
  showInputModal({
    title: `Byt namn på "${folder.label}"`,
    label: 'Nytt namn',
    defaultValue: folder.label,
    confirmText: 'Byt namn',
    onConfirm: (newName) => {
      if (newName === folder.label) return;
      api.renameFolder({ oldPath: folder.fullPath, newName })
        .then(() => { toast(`Mapp bytte namn till "${newName}"`, 'success'); return refreshTree(); })
        .catch((err) => toast('Kunde inte byta namn: ' + err.message, 'error'));
    },
  });
}

function showMoveFolderModal(folder, tree) {
  const roots = tree.filter((wf) => wf.watchedFolder !== folder.watchedFolder);
  if (roots.length === 0) {
    toast('Det finns ingen annan bevakad mapp att flytta till', 'error');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';

  const modal = document.createElement('div');
  modal.className = 'bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-80 flex flex-col max-h-[60vh]';
  modal.innerHTML = `
    <div class="flex items-center justify-between px-4 py-3 border-b border-slate-700">
      <h3 class="text-white font-medium text-sm">Flytta "${esc(folder.label)}" till...</h3>
      <button id="mf-close" class="text-slate-400 hover:text-white">✕</button>
    </div>
    <div class="overflow-y-auto flex-1 py-2" id="mf-list"></div>
    <div class="px-4 py-3 border-t border-slate-700 flex justify-end gap-2">
      <button id="mf-cancel" class="px-3 py-1.5 text-sm text-slate-300 hover:text-white rounded hover:bg-slate-700">Avbryt</button>
      <button id="mf-confirm" class="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40" disabled>Flytta</button>
    </div>`;

  let selectedRoot = null;
  const listEl = modal.querySelector('#mf-list');
  roots.forEach((wf) => {
    const btn = document.createElement('button');
    btn.className = 'w-full text-left flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/60 transition-colors';
    btn.innerHTML = `<svg class="w-4 h-4 text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/></svg><span>${esc(wf.label)}</span>`;
    btn.addEventListener('click', () => {
      listEl.querySelectorAll('button').forEach((b) => b.classList.remove('bg-blue-600/30', 'text-white'));
      btn.classList.add('bg-blue-600/30', 'text-white');
      selectedRoot = wf.watchedFolder;
      modal.querySelector('#mf-confirm').disabled = false;
    });
    listEl.appendChild(btn);
  });

  const close = () => overlay.remove();
  modal.querySelector('#mf-close').addEventListener('click', close);
  modal.querySelector('#mf-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  modal.querySelector('#mf-confirm').addEventListener('click', async () => {
    if (!selectedRoot) return;
    modal.querySelector('#mf-confirm').disabled = true;
    modal.querySelector('#mf-confirm').textContent = 'Flyttar...';
    try {
      await api.moveFolderTo({ folderPath: folder.fullPath, targetRoot: selectedRoot });
      close();
      toast(`"${folder.label}" är flyttad`, 'success');
      refreshTree();
    } catch (err) {
      close();
      toast('Flytten misslyckades: ' + err.message, 'error');
    }
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function showDeleteFolderDialog(folder, tree) {
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
      <p>Radera mappen <span class="text-white font-medium">"${esc(folder.label)}"</span>?</p>
      <p class="text-slate-400 text-xs">Alla foton i mappen skickas till papperskorgen. Filerna på disk tas inte bort.</p>
    </div>
    <div class="px-4 py-3 border-t border-slate-700 flex justify-end gap-2">
      <button class="modal-cancel px-3 py-1.5 text-sm text-slate-300 hover:text-white rounded hover:bg-slate-700">Avbryt</button>
      <button class="modal-ok px-4 py-1.5 text-sm bg-red-600 hover:bg-red-500 text-white rounded">Radera</button>
    </div>`;

  const close = () => overlay.remove();
  modal.querySelector('.modal-close').addEventListener('click', close);
  modal.querySelector('.modal-cancel').addEventListener('click', close);
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  modal.querySelector('.modal-ok').addEventListener('click', () => {
    close();
    api.trashFolder({ folderPath: folder.fullPath })
      .then(({ data }) => {
        toast(`${data.trashedCount} foto${data.trashedCount !== 1 ? 'n' : ''} skickade till papperskorgen`, 'success');
        if (activeFolderKey?.includes(folder.fullPath.replace(folder.watchedFolder, ''))) {
          document.getElementById('folder-grid').innerHTML = '';
          document.getElementById('folder-list').innerHTML = '';
          allAssets = [];
        }
        refreshTree();
      })
      .catch((err) => toast('Kunde inte radera: ' + err.message, 'error'));
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => modal.querySelector('.modal-ok').focus());
}

// Laddar om trädet utan att störa vald mapp
async function refreshTree() {
  try {
    const { data: tree } = await api.folderTree();
    _treeData = tree;
    if (_container) renderTree(_container, tree);
    updateActiveFolder(activeFolderKey);
  } catch {}
}

// ── Flytta-modal (foton) ─────────────────────────────────────────────────────

async function showMoveModal(assetIds) {
  let tree;
  try {
    const { data } = await api.folderTree();
    tree = data;
  } catch {
    toast('Kunde inte ladda mappar', 'error');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';

  const modal = document.createElement('div');
  modal.className = 'bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-80 max-h-[70vh] flex flex-col';
  modal.innerHTML = `
    <div class="flex items-center justify-between px-4 py-3 border-b border-slate-700">
      <h3 class="text-white font-medium text-sm">Flytta ${assetIds.length} fil${assetIds.length > 1 ? 'er' : ''} till...</h3>
      <button id="move-close" class="text-slate-400 hover:text-white">✕</button>
    </div>
    <div class="overflow-y-auto flex-1 py-2" id="move-folder-list"></div>
    <div class="px-4 py-3 border-t border-slate-700 flex justify-end gap-2">
      <button id="move-cancel" class="px-3 py-1.5 text-sm text-slate-300 hover:text-white rounded hover:bg-slate-700">Avbryt</button>
      <button id="move-confirm" class="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40" disabled>Flytta</button>
    </div>`;

  let selectedTarget = null;
  const folderList = modal.querySelector('#move-folder-list');

  tree.forEach((wf) => {
    const btn = document.createElement('button');
    btn.dataset.path = wf.watchedFolder;
    btn.className = 'w-full text-left flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/60 transition-colors';
    btn.innerHTML = `<svg class="w-4 h-4 text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/></svg><span class="truncate">${esc(wf.label)}</span>`;
    btn.addEventListener('click', () => {
      folderList.querySelectorAll('button').forEach((b) => b.classList.remove('bg-blue-600/30', 'text-white'));
      btn.classList.add('bg-blue-600/30', 'text-white');
      selectedTarget = wf.watchedFolder;
      modal.querySelector('#move-confirm').disabled = false;
    });
    folderList.appendChild(btn);
  });

  const close = () => overlay.remove();
  modal.querySelector('#move-close').addEventListener('click', close);
  modal.querySelector('#move-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  modal.querySelector('#move-confirm').addEventListener('click', async () => {
    if (!selectedTarget) return;
    const confirmBtn = modal.querySelector('#move-confirm');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Flyttar...';
    try {
      const targetLabel = tree.find((wf) => wf.watchedFolder === selectedTarget)?.label ?? selectedTarget;
      await moveFilesTo(assetIds, selectedTarget, targetLabel);
      close();
    } catch (err) {
      close();
      toast('Flytten misslyckades: ' + err.message, 'error');
    }
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function updateViewButtons(container) {
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
}

function splitKey(key) {
  const idx = key.indexOf('|');
  return [key.slice(0, idx), key.slice(idx + 1) || ''];
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024)            return `${bytes} B`;
  if (bytes < 1024 * 1024)     return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)       return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
