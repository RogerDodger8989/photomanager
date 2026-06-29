import { api } from '../api.js';
import { openLightbox } from '../components/lightbox.js';
import { buildPhotoCell, showAssetContextMenu } from '../components/gridCell.js';
import { createSelectionManager } from '../components/selectionManager.js';
import { getThumbSettings } from '../components/thumbSettings.js';
import { toast, confirm } from '../utils.js';
import { openShareModal } from '../components/shareModal.js';
import { downloadBlob } from '../components/selectionManager.js';

export async function renderAlbums(container, albumId = null) {
  if (albumId) {
    await renderAlbumDetail(container, albumId);
  } else {
    await renderAlbumList(container);
  }
}

// ── Album-lista ────────────────────────────────────────────────────────────────

async function renderAlbumList(container) {
  container.innerHTML = `
    <div class="p-4">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-xl font-semibold text-white">📁 Album</h1>
        <div class="flex gap-2">
          <button id="new-smart-album-btn" class="bg-violet-600 hover:bg-violet-500 text-white text-sm px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5">
            ✨ Smart album
          </button>
          <button id="new-album-btn" class="bg-blue-600 hover:bg-blue-500 text-white text-sm px-3 py-1.5 rounded-lg transition-colors">
            + Nytt album
          </button>
        </div>
      </div>
      <div id="albums-grid" class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">
        <div class="col-span-full text-slate-400 text-sm">Laddar…</div>
      </div>
    </div>`;

  document.getElementById('new-album-btn')?.addEventListener('click', () => showNewAlbumModal(container));
  document.getElementById('new-smart-album-btn')?.addEventListener('click', () => showNewSmartAlbumModal(container));

  await loadAlbumList(container);
}

async function loadAlbumList(container) {
  try {
    const { data } = await api.albums();
    const grid = document.getElementById('albums-grid');
    if (!grid) return;

    if (!data?.length) {
      grid.innerHTML = '<div class="col-span-full text-slate-400 text-sm">Inga album ännu. Skapa ett för att börja samla bilder!</div>';
      return;
    }

    grid.innerHTML = '';
    data.forEach((al) => {
      const card = document.createElement('div');
      card.className = 'group relative rounded-xl overflow-hidden bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer';
      card.dataset.albumId = al.id;
      card.innerHTML = `
        <div class="aspect-square overflow-hidden relative">
          ${al.cover_thumb
            ? `<img src="/thumbs/${al.cover_thumb}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">`
            : `<div class="w-full h-full bg-slate-700 flex items-center justify-center text-5xl">${al.is_smart ? '✨' : '📁'}</div>`}
          ${al.is_smart ? `<span class="absolute top-2 left-2 bg-violet-600/90 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full">SMART</span>` : ''}
        </div>
        <div class="p-3">
          <div class="font-medium text-sm text-white truncate pr-6">${al.name}</div>
          <div class="text-xs text-slate-400">${al.asset_count} bilder</div>
        </div>
        <!-- 3-dots meny -->
        <button class="album-menu-btn absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-base leading-none"
                data-album-id="${al.id}" data-album-name="${escHtml(al.name)}" data-is-smart="${al.is_smart ? '1' : ''}" title="Alternativ">⋮</button>`;

      card.addEventListener('click', (e) => {
        if (/** @type {HTMLElement} */ (e.target)?.closest('.album-menu-btn')) return;
        location.hash = `#/albums/${al.id}`;
      });

      card.querySelector('.album-menu-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        showAlbumMenu(/** @type {HTMLElement} */ (e.currentTarget), al, container);
      });

      grid.appendChild(card);
    });
  } catch (e) { toast(e.message, 'error'); }
}

function showAlbumMenu(anchor, al, container) {
  document.getElementById('album-ctx-menu')?.remove();

  const menu = document.createElement('div');
  menu.id = 'album-ctx-menu';
  menu.className = 'fixed z-50 bg-slate-800 border border-slate-700 rounded-xl shadow-xl py-1 min-w-[160px]';
  menu.innerHTML = `
    <button class="w-full text-left px-4 py-2 text-sm text-white hover:bg-slate-700 transition-colors" data-action="rename">✏️ Byt namn</button>
    <button class="w-full text-left px-4 py-2 text-sm text-white hover:bg-slate-700 transition-colors" data-action="desc">📝 Redigera beskrivning</button>
    <button class="w-full text-left px-4 py-2 text-sm text-green-400 hover:bg-slate-700 transition-colors" data-action="export">📦 Exportera som ZIP</button>
    ${al.is_smart ? `<button class="w-full text-left px-4 py-2 text-sm text-violet-300 hover:bg-slate-700 transition-colors" data-action="rules">✨ Redigera regler</button>
    <button class="w-full text-left px-4 py-2 text-sm text-violet-300 hover:bg-slate-700 transition-colors" data-action="rebuild">🔄 Uppdatera nu</button>` : ''}
    <div class="border-t border-slate-700 my-1"></div>
    <button class="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-slate-700 transition-colors" data-action="delete">🗑️ Ta bort album</button>`;

  const rect = anchor.getBoundingClientRect();
  menu.style.top  = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 180)}px`;
  document.body.appendChild(menu);

  const close = () => menu.remove();
  setTimeout(() => document.addEventListener('click', close, { once: true }), 0);

  menu.querySelector('[data-action="rename"]')?.addEventListener('click', async () => {
    close();
    const name = await promptModal('Byt namn', 'Albumnamn', al.name, false);
    if (!name?.trim() || name.trim() === al.name) return;
    try {
      await api.updateAlbum(al.id, { name: name.trim() });
      toast('Namn uppdaterat', 'success');
      loadAlbumList(container);
    } catch (e) { toast(e.message, 'error'); }
  });

  menu.querySelector('[data-action="desc"]')?.addEventListener('click', async () => {
    close();
    const desc = await promptModal('Redigera beskrivning', 'Beskrivning', al.description ?? '', true);
    if (desc === null) return;
    try {
      await api.updateAlbum(al.id, { description: desc });
      toast('Beskrivning uppdaterad', 'success');
      loadAlbumList(container);
    } catch (e) { toast(e.message, 'error'); }
  });

  menu.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    close();
    const ok = await confirm(`Ta bort albumet "${al.name}"? Bilderna påverkas inte.`);
    if (!ok) return;
    try {
      await api.deleteAlbum(al.id);
      toast('Album borttaget', 'success');
      loadAlbumList(container);
    } catch (e) { toast(e.message, 'error'); }
  });

  menu.querySelector('[data-action="export"]')?.addEventListener('click', async () => {
    close();
    const btn = menu.querySelector('[data-action="export"]');
    try {
      toast('Förbereder ZIP…', 'info');
      const blob = await api.exportAlbumZip(al.id);
      downloadBlob(blob, `${al.name}.zip`);
      toast('Export klar!', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });

  menu.querySelector('[data-action="rules"]')?.addEventListener('click', async () => {
    close();
    showRuleBuilderModal(al, async (rules, ruleLogic) => {
      try {
        const { data } = await api.saveAlbumRules(al.id, { rules, ruleLogic });
        toast(`Smart album uppdaterat — ${data.assetCount} bilder`, 'success');
        loadAlbumList(container);
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  menu.querySelector('[data-action="rebuild"]')?.addEventListener('click', async () => {
    close();
    try {
      const { data } = await api.rebuildAlbum(al.id);
      toast(`Uppdaterat — ${data.assetCount} bilder`, 'success');
      loadAlbumList(container);
    } catch (e) { toast(e.message, 'error'); }
  });
}

function showNewAlbumModal(container) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/70';
  overlay.innerHTML = `
    <div class="bg-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-slate-700">
      <h2 class="text-lg font-semibold text-white mb-4">Nytt album</h2>
      <input id="new-album-name" type="text" placeholder="Albumnamn" autofocus
        class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 mb-3">
      <input id="new-album-desc" type="text" placeholder="Beskrivning (valfritt)"
        class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 mb-4">
      <div class="flex gap-2 justify-end">
        <button id="cancel-album" class="px-4 py-2 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-colors">Avbryt</button>
        <button id="create-album" class="px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-500 text-white transition-colors">Skapa album</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  const nameInput = /** @type {HTMLInputElement} */ (overlay.querySelector('#new-album-name'));
  const descInput = /** @type {HTMLInputElement} */ (overlay.querySelector('#new-album-desc'));
  nameInput.focus();

  overlay.querySelector('#cancel-album')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const create = async () => {
    const name = nameInput.value.trim();
    const desc = descInput.value.trim();
    if (!name) return;
    try {
      const { data } = await api.createAlbum({ name, description: desc || undefined });
      overlay.remove();
      toast('Album skapat!', 'success');
      location.hash = `#/albums/${data.id}`;
    } catch (e) { toast(e.message, 'error'); }
  };

  overlay.querySelector('#create-album')?.addEventListener('click', create);
  nameInput.addEventListener('keydown', (e) => { if (/** @type {KeyboardEvent} */ (e).key === 'Enter') create(); });
}

// ── Album-detalj ───────────────────────────────────────────────────────────────

async function renderAlbumDetail(container, albumId) {
  container.innerHTML = `
    <div class="p-4 flex flex-col h-full">
      <button onclick="location.hash='#/albums'" class="text-slate-400 hover:text-white text-sm mb-4 flex items-center gap-1 w-fit">
        ← Alla album
      </button>
      <div id="album-header" class="mb-3">
        <div id="album-title-row" class="flex items-center gap-2 flex-wrap"></div>
        <div id="album-desc-row" class="mt-1"></div>
      </div>
      <div id="album-controls" class="flex items-center gap-2 flex-wrap mb-2 min-h-[2rem]">
        <div id="album-sel-toolbar" class="flex items-center gap-2 flex-wrap flex-1"></div>
        <div class="flex items-center gap-1.5 flex-shrink-0">
          <label class="text-xs text-slate-500">Sortera:</label>
          <select id="album-sort" class="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500">
            <option value="date_desc">Datum (nyast)</option>
            <option value="date_asc">Datum (äldst)</option>
            <option value="name_asc">Filnamn A→Z</option>
            <option value="name_desc">Filnamn Z→A</option>
            <option value="rating_desc">Betyg (högt)</option>
            <option value="custom">Albumordning</option>
          </select>
        </div>
      </div>
      <div id="album-grid" class="grid gap-0.5 flex-1" style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))">
        <div class="col-span-full text-slate-400 text-sm p-2">Laddar…</div>
      </div>
    </div>`;

  await loadAlbumDetail(container, albumId);
}

async function loadAlbumDetail(container, albumId) {
  try {
    const first = await api.album(albumId, { limit: 200, offset: 0 });
    const album = first.data.album;
    let allAssets = [...first.data.assets];
    let offset = 200;
    while (allAssets.length < first.meta.total) {
      const page = await api.album(albumId, { limit: 200, offset });
      allAssets = allAssets.concat(page.data.assets);
      offset += 200;
      if (page.data.assets.length < 200) break;
    }

    const titleRow = document.getElementById('album-title-row');
    const descRow  = document.getElementById('album-desc-row');

    const renderTitle = () => {
      if (!titleRow) return;
      titleRow.innerHTML = `
        <h1 id="album-name-display" class="text-xl font-semibold text-white cursor-pointer hover:text-blue-300 transition-colors"
            title="Klicka för att byta namn">${escHtml(album.name)}</h1>
        ${album.is_smart ? `<span class="bg-violet-600/90 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full">SMART</span>
          <button id="edit-rules-btn" class="text-xs text-violet-300 hover:text-violet-200 px-2 py-1 rounded hover:bg-slate-700 transition-colors">✨ Redigera regler</button>
          <button id="rebuild-now-btn" class="text-xs text-violet-300 hover:text-violet-200 px-2 py-1 rounded hover:bg-slate-700 transition-colors">🔄 Uppdatera</button>` : ''}
        <button id="share-album-btn" class="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded hover:bg-slate-700 transition-colors ml-auto">🔗 Dela album</button>`;

      titleRow.querySelector('#edit-rules-btn')?.addEventListener('click', () => {
        showRuleBuilderModal(album, async (rules, ruleLogic) => {
          try {
            const { data } = await api.saveAlbumRules(albumId, { rules, ruleLogic });
            toast(`Regler sparade — ${data.assetCount} bilder`, 'success');
            loadAlbumDetail(container, albumId);
          } catch (e) { toast(e.message, 'error'); }
        });
      });
      titleRow.querySelector('#share-album-btn')?.addEventListener('click', () => {
        openShareModal({ albumId: albumId, name: album.name });
      });
      titleRow.querySelector('#rebuild-now-btn')?.addEventListener('click', async () => {
        try {
          const { data } = await api.rebuildAlbum(albumId);
          toast(`Uppdaterat — ${data.assetCount} bilder`, 'success');
          loadAlbumDetail(container, albumId);
        } catch (e) { toast(e.message, 'error'); }
      });
      titleRow.querySelector('#album-name-display')?.addEventListener('click', async () => {
        const name = await promptModal('Byt albumnamn', 'Albumnamn', album.name, false);
        if (!name?.trim() || name.trim() === album.name) return;
        try {
          await api.updateAlbum(albumId, { name: name.trim() });
          album.name = name.trim();
          toast('Namn uppdaterat', 'success');
          renderTitle();
        } catch (e) { toast(e.message, 'error'); }
      });
    };

    const renderDesc = () => {
      if (!descRow) return;
      descRow.innerHTML = album.description
        ? `<p class="text-slate-400 text-sm cursor-pointer hover:text-slate-300 transition-colors" id="album-desc-display"
              title="Klicka för att redigera">${escHtml(album.description)}</p>`
        : `<button id="album-add-desc" class="text-xs text-slate-500 hover:text-slate-300 transition-colors">+ Lägg till beskrivning</button>`;
      const editDesc = async () => {
        const desc = await promptModal('Redigera beskrivning', 'Beskrivning', album.description ?? '', true);
        if (desc === null) return;
        await api.updateAlbum(albumId, { description: desc });
        album.description = desc;
        renderDesc();
      };
      descRow.querySelector('#album-desc-display')?.addEventListener('click', editDesc);
      descRow.querySelector('#album-add-desc')?.addEventListener('click', editDesc);
    };

    renderTitle();
    renderDesc();

    const grid = document.getElementById('album-grid');
    if (!grid) return;

    const _ts = await getThumbSettings().catch(() => null);
    let currentSort = 'date_desc';

    const sel = createSelectionManager(
      () => document.getElementById('album-grid'),
      () => allAssets,
      [{
        label: '✕ Ta bort markerade från album',
        className: 'flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 px-2 py-1 rounded hover:bg-slate-700 transition-colors',
        onClick: async (ids) => {
          const count = ids.length;
          await Promise.all(ids.map((id) => api.removeFromAlbum(albumId, id).catch(() => {})));
          allAssets = allAssets.filter((a) => !ids.includes(a.id));
          sel.clearAll();
          renderGrid();
          toast(`${count} bild${count > 1 ? 'er' : ''} borttagen${count > 1 ? 'a' : ''} från albumet`, 'success');
        },
      }],
    );

    const toolbarEl = document.getElementById('album-sel-toolbar');
    if (toolbarEl) sel.mountToolbar(toolbarEl);

    const sortSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('album-sort'));
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        currentSort = sortSelect.value;
        renderGrid();
      });
    }

    const getSorted = () => {
      const sorted = [...allAssets];
      switch (currentSort) {
        case 'date_asc':    sorted.sort((a, b) => new Date(a.taken_at ?? 0).getTime() - new Date(b.taken_at ?? 0).getTime()); break;
        case 'date_desc':   sorted.sort((a, b) => new Date(b.taken_at ?? 0).getTime() - new Date(a.taken_at ?? 0).getTime()); break;
        case 'name_asc':    sorted.sort((a, b) => (a.file_name ?? '').localeCompare(b.file_name ?? '')); break;
        case 'name_desc':   sorted.sort((a, b) => (b.file_name ?? '').localeCompare(a.file_name ?? '')); break;
        case 'rating_desc': sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)); break;
        case 'custom':      sorted.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)); break;
      }
      return sorted;
    };

    const renderGrid = () => {
      if (!allAssets.length) {
        grid.innerHTML = `<div class="col-span-full text-slate-400 text-sm p-2">Albumet är tomt. Lägg till bilder via Bilder-fliken (markera bilder → 📁 Lägg till i album).</div>`;
        return;
      }
      grid.innerHTML = '';
      const display = getSorted();
      display.forEach((asset, i) => {
        const cell = buildPhotoCell(
          asset,
          () => openLightbox(display, i),
          undefined,
          _ts,
        );

        sel.attachToCell(cell, asset, allAssets.indexOf(asset));

        const hoverOverlay = document.createElement('div');
        hoverOverlay.className = 'album-cell-overlay absolute inset-0 flex items-end justify-between p-1.5 opacity-0 hover:opacity-100 transition-opacity pointer-events-none';
        hoverOverlay.style.background = 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 60%)';
        hoverOverlay.innerHTML = `
          <button class="set-cover-btn pointer-events-auto text-xs bg-black/50 hover:bg-blue-600 text-white px-2 py-0.5 rounded transition-colors"
                  title="Sätt som omslag">🖼</button>
          <button class="remove-from-album-btn pointer-events-auto text-xs bg-black/50 hover:bg-red-600 text-white px-2 py-0.5 rounded transition-colors"
                  title="Ta bort från album">✕</button>`;

        cell.style.position = 'relative';
        cell.appendChild(hoverOverlay);

        hoverOverlay.querySelector('.set-cover-btn')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await api.updateAlbum(albumId, { coverAssetId: asset.id });
            toast('Omslag uppdaterat', 'success');
          } catch (err) { toast(err.message, 'error'); }
        });

        hoverOverlay.querySelector('.remove-from-album-btn')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await api.removeFromAlbum(albumId, asset.id);
            allAssets = allAssets.filter((a) => a.id !== asset.id);
            renderGrid();
          } catch (err) { toast(err.message, 'error'); }
        });

        cell.addEventListener('contextmenu', (e) => {
          showAssetContextMenu(e, asset, {
            selectionManager: sel,
            getAllAssets: () => allAssets,
            openLightboxFn: openLightbox,
            allAssets: display,
            index: i,
            onAddToAlbum: null,
            onDelete: (id) => { allAssets = allAssets.filter((a) => a.id !== id); renderGrid(); },
            onRefresh: () => { loadAlbumDetail(container, albumId); },
          });
        });

        grid.appendChild(cell);
      });
    };

    renderGrid();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── Smart album — ny modal ────────────────────────────────────────────────────

async function showNewSmartAlbumModal(container) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/70';
  overlay.innerHTML = `
    <div class="bg-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-slate-700">
      <h2 class="text-lg font-semibold text-white mb-1">✨ Nytt smart album</h2>
      <p class="text-sm text-slate-400 mb-4">Bilder läggs till automatiskt baserat på regler du sätter.</p>
      <input id="sa-name" type="text" placeholder="Albumnamn" autofocus
        class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 mb-4">
      <div class="flex gap-2 justify-end">
        <button id="sa-cancel" class="px-4 py-2 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-colors">Avbryt</button>
        <button id="sa-next" class="px-4 py-2 rounded-lg text-sm bg-violet-600 hover:bg-violet-500 text-white transition-colors">Nästa →</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const nameInput = /** @type {HTMLInputElement} */ (overlay.querySelector('#sa-name'));
  nameInput?.focus();

  overlay.querySelector('#sa-cancel')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const next = async () => {
    const name = nameInput?.value.trim();
    if (!name) return;
    overlay.remove();
    try {
      const { data: newAlbum } = await api.createAlbum({ name, is_smart: true });
      showRuleBuilderModal(newAlbum, async (rules, ruleLogic) => {
        try {
          const { data } = await api.saveAlbumRules(newAlbum.id, { rules, ruleLogic });
          toast(`Smart album skapat — ${data.assetCount} bilder`, 'success');
          loadAlbumList(container);
        } catch (e) { toast(e.message, 'error'); }
      }, () => {
        api.deleteAlbum(newAlbum.id).catch(() => {});
      });
    } catch (e) { toast(e.message, 'error'); }
  };

  overlay.querySelector('#sa-next')?.addEventListener('click', next);
  nameInput?.addEventListener('keydown', (e) => { if (/** @type {KeyboardEvent} */ (e).key === 'Enter') next(); });
}

// ── Smart album — regelbyggare ────────────────────────────────────────────────

const RULE_TYPES = [
  { value: 'date_range', label: '📅 Datumintervall' },
  { value: 'person',     label: '👤 Person' },
  { value: 'location',   label: '📍 Plats' },
  { value: 'mime_type',  label: '🎬 Filtyp' },
  { value: 'has_gps',    label: '🗺 Har GPS' },
  { value: 'is_favorite',label: '❤️ Favorit' },
  { value: 'rating',     label: '⭐ Betyg' },
];

/**
 * @param {{ id: string, name: string, is_smart?: boolean, rule_logic?: string }} album
 * @param {(rules: any[], logic: string) => void} onSave
 * @param {(() => void) | null} [onCancel]
 */
async function showRuleBuilderModal(album, onSave, onCancel = null) {
  let existingRules = [];
  let existingLogic = 'ALL';
  let allPersons = [];

  try {
    if (album.is_smart) {
      const { data } = await api.albumRules(album.id);
      existingRules = data.rules ?? [];
      existingLogic = data.album?.rule_logic ?? 'ALL';
    }
    const { data: pdata } = await api.persons();
    allPersons = pdata ?? [];
  } catch {}

  /** @type {{ rule_type: string, value: Record<string, any> }[]} */
  let rules = existingRules.length ? existingRules.map((r) => ({ rule_type: r.rule_type, value: r.value ?? {} })) : [];
  let ruleLogic = existingLogic;

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4';
  document.body.appendChild(overlay);

  const render = () => {
    overlay.innerHTML = `
      <div class="bg-slate-800 rounded-2xl w-full max-w-lg shadow-2xl border border-slate-700 flex flex-col max-h-[90vh]">
        <div class="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <div>
            <h2 class="text-lg font-semibold text-white">✨ Regler — ${escHtml(album.name)}</h2>
            <p class="text-xs text-slate-400 mt-0.5">Bilder som uppfyller reglerna läggs till automatiskt</p>
          </div>
          <button id="rb-close" class="text-slate-400 hover:text-white transition-colors text-xl leading-none">✕</button>
        </div>

        <!-- Logik-toggle -->
        <div class="px-6 pt-4 flex items-center gap-3">
          <span class="text-xs text-slate-400">Visa bilder som uppfyller</span>
          <div class="flex rounded-lg overflow-hidden border border-slate-600">
            <button class="logic-btn px-3 py-1 text-xs font-medium transition-colors ${ruleLogic === 'ALL' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:bg-slate-700'}" data-logic="ALL">ALLA regler</button>
            <button class="logic-btn px-3 py-1 text-xs font-medium transition-colors ${ruleLogic === 'ANY' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:bg-slate-700'}" data-logic="ANY">NÅGON regel</button>
          </div>
        </div>

        <!-- Regellist -->
        <div id="rb-rules" class="px-6 py-4 flex-1 overflow-y-auto space-y-3">
          ${rules.length === 0 ? '<p class="text-slate-500 text-sm text-center py-4">Inga regler ännu. Lägg till en nedan.</p>' :
            rules.map((r, i) => renderRuleRow(r, i, allPersons)).join('')}
        </div>

        <!-- Lägg till regel -->
        <div class="px-6 pb-2 border-t border-slate-700 pt-3">
          <div class="flex gap-2 items-center">
            <select id="rb-add-type" class="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500">
              ${RULE_TYPES.map((t) => `<option value="${t.value}">${t.label}</option>`).join('')}
            </select>
            <button id="rb-add-btn" class="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors flex-shrink-0">+ Lägg till</button>
          </div>
        </div>

        <!-- Knappar -->
        <div class="px-6 py-4 border-t border-slate-700 flex items-center gap-2">
          <button id="rb-preview" class="px-3 py-2 rounded-lg text-sm text-violet-300 hover:text-violet-200 hover:bg-slate-700 transition-colors flex items-center gap-1.5">
            🔍 Förhandsgranska
          </button>
          <span id="rb-preview-count" class="text-xs text-slate-400"></span>
          <div class="flex-1"></div>
          <button id="rb-cancel" class="px-4 py-2 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-colors">Avbryt</button>
          <button id="rb-save" class="px-4 py-2 rounded-lg text-sm bg-violet-600 hover:bg-violet-500 text-white transition-colors">💾 Spara och kör</button>
        </div>
      </div>`;

    // Logic toggle
    overlay.querySelectorAll('.logic-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        ruleLogic = /** @type {HTMLElement} */ (btn).dataset.logic ?? 'ALL';
        render();
      });
    });

    // Remove rule buttons
    overlay.querySelectorAll('.rb-remove-rule').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(/** @type {HTMLElement} */ (btn).dataset.idx);
        rules.splice(idx, 1);
        render();
      });
    });

    // Inline value change handlers for select/date inputs (not person/location AC)
    overlay.querySelectorAll('[data-rule-idx]').forEach((el) => {
      const tag = /** @type {HTMLElement} */ (el).tagName;
      if (tag !== 'SELECT' && tag !== 'INPUT') return;
      const inputEl = /** @type {HTMLInputElement | HTMLSelectElement} */ (el);
      if (inputEl.classList.contains('person-ac-input')) return;
      if (inputEl.dataset.field === 'label') return; // handled by location AC

      const handler = () => {
        const idx = Number(inputEl.dataset.ruleIdx ?? '-1');
        const field = inputEl.dataset.field ?? '';
        if (!rules[idx] || !field) return;
        rules[idx].value = { ...rules[idx].value, [field]: inputEl.value };
      };
      el.addEventListener('change', handler);
      el.addEventListener('input', handler);
    });

    // Add rule
    overlay.querySelector('#rb-add-btn')?.addEventListener('click', () => {
      const type = /** @type {HTMLSelectElement} */ (overlay.querySelector('#rb-add-type'))?.value ?? 'date_range';
      rules.push({ rule_type: type, value: {} });
      render();
    });

    overlay.querySelector('#rb-close')?.addEventListener('click', () => { overlay.remove(); onCancel?.(); });
    overlay.querySelector('#rb-cancel')?.addEventListener('click', () => { overlay.remove(); onCancel?.(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); onCancel?.(); } });

    overlay.querySelector('#rb-preview')?.addEventListener('click', async () => {
      const btn = /** @type {HTMLButtonElement} */ (overlay.querySelector('#rb-preview'));
      const countEl = overlay.querySelector('#rb-preview-count');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Söker…'; }
      if (countEl) countEl.textContent = '';
      try {
        const activeRules = rules.filter((r) => {
          if (r.rule_type === 'person') return !!r.value.personId;
          if (r.rule_type === 'location') return !!r.value.label;
          return true;
        });
        const { data } = await api.previewAlbumRules({ rules: activeRules, ruleLogic });
        if (countEl) countEl.textContent = `${data.count} bild${data.count !== 1 ? 'er' : ''} matchar`;
      } catch (e) {
        console.error('[preview-rules]', e);
        if (countEl) countEl.textContent = `Fel: ${e.message}`;
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔍 Förhandsgranska'; }
      }
    });

    overlay.querySelector('#rb-save')?.addEventListener('click', () => {
      overlay.remove();
      onSave(rules, ruleLogic);
    });

    // Sätt upp autocomplete-widgets efter render
    _setupRuleWidgets(overlay, rules, allPersons);
  };

  render();
}

/**
 * @param {{ rule_type: string, value: Record<string, any> }} rule
 * @param {number} idx
 * @param {any[]} allPersons
 */
function renderRuleRow(rule, idx, allPersons) {
  const inp = (field, type, value, placeholder = '') =>
    `<input type="${type}" data-rule-idx="${idx}" data-field="${field}" value="${escHtml(String(value ?? ''))}"
       placeholder="${placeholder}"
       class="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-violet-500 w-full">`;

  let valueHtml = '';
  switch (rule.rule_type) {
    case 'date_range':
      valueHtml = `
        <div class="flex gap-1 items-center">
          ${inp('from', 'date', rule.value.from ?? '')}
          <span class="text-slate-500 text-xs flex-shrink-0">→</span>
          ${inp('to', 'date', rule.value.to ?? '')}
        </div>`;
      break;
    case 'person': {
      const selPerson = allPersons.find((p) => p.id === rule.value.personId);
      const dispName = selPerson ? selPerson.name + (selPerson.custom_id != null ? ` (${selPerson.custom_id})` : '') : '';
      valueHtml = `
        <div class="relative person-ac-wrap">
          <input type="text"
            class="person-ac-input bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-violet-500 w-full"
            placeholder="Sök person…"
            autocomplete="off"
            value="${escHtml(dispName)}"
            data-rule-idx="${idx}"
            data-selected-id="${escHtml(rule.value.personId ?? '')}">
          <div class="person-ac-drop hidden absolute left-0 top-full mt-0.5 w-full min-w-[220px] bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-[200] max-h-44 overflow-y-auto"></div>
        </div>`;
      break;
    }
    case 'location':
      valueHtml = `
        <div class="relative location-ac-wrap">
          ${inp('label', 'text', rule.value.label ?? '', 'T.ex. Stockholm')}
          <div class="location-ac-drop hidden absolute left-0 top-full mt-0.5 w-full bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-[200] max-h-40 overflow-y-auto" data-rule-idx="${idx}"></div>
        </div>`;
      break;
    case 'mime_type':
      valueHtml = `<select data-rule-idx="${idx}" data-field="type"
        class="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-violet-500 w-full">
        <option value="image" ${(rule.value.type ?? 'image') === 'image' ? 'selected' : ''}>Bilder</option>
        <option value="video" ${rule.value.type === 'video' ? 'selected' : ''}>Video</option>
      </select>`;
      break;
    case 'rating':
      valueHtml = `<select data-rule-idx="${idx}" data-field="min"
        class="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-violet-500 w-full">
        ${[1,2,3,4,5].map((n) => `<option value="${n}" ${Number(rule.value.min ?? 1) === n ? 'selected' : ''}>${n}★ eller mer</option>`).join('')}
      </select>`;
      break;
    default:
      valueHtml = `<span class="text-xs text-slate-500 italic">Inga inställningar</span>`;
  }

  const label = RULE_TYPES.find((t) => t.value === rule.rule_type)?.label ?? rule.rule_type;

  return `
    <div class="flex items-start gap-3 bg-slate-700/50 rounded-xl p-3" data-rule-idx="${idx}">
      <div class="flex-1 min-w-0">
        <div class="text-xs font-medium text-slate-300 mb-1.5">${label}</div>
        ${valueHtml}
      </div>
      <button class="rb-remove-rule flex-shrink-0 text-slate-500 hover:text-red-400 transition-colors mt-0.5" data-idx="${idx}" title="Ta bort">✕</button>
    </div>`;
}

/**
 * Initierar autocomplete-widgets (person & plats) inuti regelbyggarens overlay.
 * Anropas efter varje render().
 */
function _setupRuleWidgets(overlay, rules, allPersons) {
  // ── Person-autocomplete ───────────────────────────────────────────────────
  overlay.querySelectorAll('.person-ac-input').forEach((inputEl) => {
    const el = /** @type {HTMLInputElement} */ (inputEl);
    const drop = el.closest('.person-ac-wrap')?.querySelector('.person-ac-drop');
    if (!drop) return;
    const idx = Number(el.dataset.ruleIdx ?? '-1');

    const showDrop = (matches) => {
      drop.innerHTML = '';
      if (!matches.length) {
        drop.innerHTML = '<div class="px-3 py-2 text-xs text-slate-500">Inga träffar</div>';
        drop.classList.remove('hidden');
        return;
      }
      matches.slice(0, 12).forEach((p) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-slate-700 transition-colors';
        const dispName = p.name + (p.custom_id != null ? ` (${p.custom_id})` : '');
        const life = p.birth_year ? ` · f. ${p.birth_year}` : '';
        btn.innerHTML = `
          <span class="flex-1 min-w-0">
            <span class="block text-xs text-white truncate">${escHtml(dispName)}</span>
            ${life ? `<span class="text-[10px] text-slate-500">${escHtml(life)}</span>` : ''}
          </span>`;
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          el.value = dispName;
          el.dataset.selectedId = p.id;
          if (rules[idx]) rules[idx].value = { ...rules[idx].value, personId: p.id };
          drop.classList.add('hidden');
        });
        drop.appendChild(btn);
      });
      drop.classList.remove('hidden');
    };

    el.addEventListener('input', () => {
      const q = el.value.toLowerCase();
      if (!q) { drop.classList.add('hidden'); return; }
      const matches = allPersons.filter((p) =>
        p.name.toLowerCase().includes(q) || String(p.custom_id ?? '').toLowerCase().includes(q)
      );
      showDrop(matches);
    });

    el.addEventListener('focus', () => {
      const q = el.value.toLowerCase();
      if (q) {
        const matches = allPersons.filter((p) =>
          p.name.toLowerCase().includes(q) || String(p.custom_id ?? '').toLowerCase().includes(q)
        );
        showDrop(matches);
      }
    });

    el.addEventListener('blur', () => {
      setTimeout(() => drop.classList.add('hidden'), 150);
      // Om fältet tömdes, rensa personId
      if (!el.value.trim() && rules[idx]) {
        rules[idx].value = { ...rules[idx].value, personId: undefined };
        el.dataset.selectedId = '';
      }
    });
  });

  // ── Plats-autocomplete ────────────────────────────────────────────────────
  overlay.querySelectorAll('.location-ac-wrap').forEach((wrap) => {
    const inputEl = /** @type {HTMLInputElement|null} */ (wrap.querySelector('input[data-field="label"]'));
    const drop = wrap.querySelector('.location-ac-drop');
    if (!inputEl || !drop) return;
    const idx = Number(inputEl.dataset.ruleIdx ?? '-1');
    let debounce = null;

    const showLocDrop = (items) => {
      drop.innerHTML = '';
      if (!items.length) { drop.classList.add('hidden'); return; }
      items.forEach((item) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w-full text-left px-3 py-2 flex items-center justify-between hover:bg-slate-700 transition-colors';
        btn.innerHTML = `
          <span class="text-xs text-white truncate">${escHtml(item.label)}</span>
          <span class="text-[10px] text-slate-500 ml-2 flex-shrink-0">${item.count} bilder</span>`;
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          inputEl.value = item.label;
          if (rules[idx]) rules[idx].value = { ...rules[idx].value, label: item.label };
          drop.classList.add('hidden');
        });
        drop.appendChild(btn);
      });
      drop.classList.remove('hidden');
    };

    inputEl.addEventListener('input', () => {
      if (rules[idx]) rules[idx].value = { ...rules[idx].value, label: inputEl.value };
      clearTimeout(debounce);
      const q = inputEl.value.trim();
      if (!q) { drop.classList.add('hidden'); return; }
      debounce = setTimeout(async () => {
        try {
          const { data } = await api.suggestions('location', q);
          showLocDrop(data ?? []);
        } catch {}
      }, 250);
    });

    inputEl.addEventListener('focus', async () => {
      const q = inputEl.value.trim();
      if (!q) return;
      try {
        const { data } = await api.suggestions('location', q);
        showLocDrop(data ?? []);
      } catch {}
    });

    inputEl.addEventListener('blur', () => {
      setTimeout(() => drop.classList.add('hidden'), 150);
    });
  });
}

// ── Lägg till bilder i album — modal ──────────────────────────────────────────

export async function openAddToAlbumModal(assetIds) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[9500] flex items-center justify-center bg-black/70';

  let albums = [];
  try {
    const params = assetIds.length === 1 ? { assetId: assetIds[0] } : {};
    ({ data: albums } = await api.albums(params));
  } catch {}

  overlay.innerHTML = `
    <div class="bg-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl border border-slate-700">
      <h2 class="text-lg font-semibold text-white mb-1">Lägg till i album</h2>
      <p class="text-sm text-slate-400 mb-4">${assetIds.length} bild${assetIds.length > 1 ? 'er' : ''} valda</p>
      <input id="album-search" type="text" placeholder="Sök album…"
        class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 mb-3">
      <div id="album-pick-list" class="max-h-60 overflow-y-auto space-y-1 mb-4"></div>
      <div class="border-t border-slate-700 pt-3">
        <button id="create-new-album-btn" class="w-full text-left px-3 py-2 text-sm text-blue-400 hover:text-blue-300 hover:bg-slate-700 rounded-lg transition-colors">
          + Skapa nytt album
        </button>
      </div>
      <div class="flex gap-2 justify-end mt-3">
        <button id="ata-cancel" class="px-4 py-2 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-colors">Avbryt</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const renderList = (filter = '') => {
    const list = overlay.querySelector('#album-pick-list');
    if (!list) return;
    const filtered = albums.filter((al) => al.name.toLowerCase().includes(filter.toLowerCase()));
    if (!filtered.length) {
      list.innerHTML = '<div class="text-slate-400 text-sm px-3 py-2">Inga album hittades</div>';
      return;
    }
    list.innerHTML = filtered.map((al) => `
      <button class="album-pick-item w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-700 transition-colors text-left"
              data-album-id="${al.id}" data-album-name="${escHtml(al.name)}">
        <div class="w-10 h-10 rounded overflow-hidden flex-shrink-0 bg-slate-700">
          ${al.cover_thumb
            ? `<img src="/thumbs/${al.cover_thumb}" class="w-full h-full object-cover">`
            : `<div class="w-full h-full flex items-center justify-center">📁</div>`}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm text-white font-medium">${escHtml(al.name)}</div>
          <div class="text-xs text-slate-400">${al.asset_count} bilder</div>
        </div>
        ${al.contains_asset ? `<span class="text-xs text-green-400 flex-shrink-0 flex items-center gap-1">✓ tillagd</span>` : ''}
      </button>`).join('');

    list.querySelectorAll('.album-pick-item').forEach((btn) => {
      const b = /** @type {HTMLElement} */ (btn);
      b.addEventListener('click', async () => {
        try {
          await api.addToAlbum(b.dataset.albumId, assetIds);
          overlay.remove();
          toast(`Lade till i "${b.dataset.albumName}"`, 'success');
        } catch (e) { toast(e.message, 'error'); }
      });
    });
  };

  renderList();

  overlay.querySelector('#album-search')?.addEventListener('input', (e) => renderList(/** @type {HTMLInputElement} */ (e.target).value));
  overlay.querySelector('#ata-cancel')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#create-new-album-btn')?.addEventListener('click', async () => {
    const name = await promptModal('Nytt album', 'Albumnamn', '', false);
    if (!name?.trim()) return;
    try {
      const { data: newAlbum } = await api.createAlbum({ name: name.trim() });
      await api.addToAlbum(newAlbum.id, assetIds);
      overlay.remove();
      toast(`Skapade albumet "${name.trim()}" och lade till bilderna`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function promptModal(title, label, currentValue, multiline) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-black/70';

    const inputHtml = multiline
      ? `<textarea id="pm-input" rows="4"
            class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm
                   focus:outline-none focus:border-blue-500 resize-none">${escHtml(currentValue)}</textarea>`
      : `<input id="pm-input" type="text" value="${escHtml(currentValue)}"
            class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm
                   focus:outline-none focus:border-blue-500">`;

    overlay.innerHTML = `
      <div class="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm mx-4 shadow-2xl">
        <div class="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 class="font-semibold text-white">${title}</h2>
          <button id="pm-x" class="text-slate-400 hover:text-white transition-colors">✕</button>
        </div>
        <div class="p-5">
          <label class="block text-xs text-slate-400 mb-1.5">${label}</label>
          ${inputHtml}
        </div>
        <div class="px-5 py-4 border-t border-slate-700 flex justify-end gap-2">
          <button id="pm-cancel" class="px-4 py-2 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-colors">Avbryt</button>
          <button id="pm-save"   class="px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-500 text-white transition-colors">Spara</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const input = /** @type {HTMLInputElement} */ (overlay.querySelector('#pm-input'));
    // Sätt markören i slutet av texten
    requestAnimationFrame(() => {
      if (!input) return;
      input.focus();
      if (!multiline) { input.selectionStart = input.selectionEnd = input.value.length; }
    });

    const done = (value) => { overlay.remove(); resolve(value); };

    overlay.querySelector('#pm-x')?.addEventListener('click', () => done(null));
    overlay.querySelector('#pm-cancel')?.addEventListener('click', () => done(null));
    overlay.querySelector('#pm-save')?.addEventListener('click', () => done(input ? input.value : null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });

    overlay.addEventListener('keydown', (e) => {
      const ke = /** @type {KeyboardEvent} */ (e);
      if (ke.key === 'Escape') { ke.stopPropagation(); done(null); }
      if (ke.key === 'Enter' && !multiline) { ke.preventDefault(); done(input ? input.value : null); }
    });
  });
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
