import { api } from '../api.js';
import { openLightbox } from '../components/lightbox.js';
import { buildPhotoCell } from '../components/gridCell.js';
import { toast, confirm } from '../utils.js';

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
        <button id="new-album-btn" class="bg-blue-600 hover:bg-blue-500 text-white text-sm px-3 py-1.5 rounded-lg transition-colors">
          + Nytt album
        </button>
      </div>
      <div id="albums-grid" class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">
        <div class="col-span-full text-slate-400 text-sm">Laddar…</div>
      </div>
    </div>`;

  document.getElementById('new-album-btn').addEventListener('click', () => showNewAlbumModal(container));

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
        <div class="aspect-square overflow-hidden">
          ${al.cover_thumb
            ? `<img src="/thumbs/${al.cover_thumb}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">`
            : `<div class="w-full h-full bg-slate-700 flex items-center justify-center text-5xl">📁</div>`}
        </div>
        <div class="p-3">
          <div class="font-medium text-sm text-white truncate pr-6">${al.name}</div>
          <div class="text-xs text-slate-400">${al.asset_count} bilder</div>
        </div>
        <!-- 3-dots meny -->
        <button class="album-menu-btn absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-base leading-none"
                data-album-id="${al.id}" data-album-name="${escHtml(al.name)}" title="Alternativ">⋮</button>`;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.album-menu-btn')) return;
        location.hash = `#/albums/${al.id}`;
      });

      card.querySelector('.album-menu-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        showAlbumMenu(e.currentTarget, al, container);
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
    <div class="border-t border-slate-700 my-1"></div>
    <button class="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-slate-700 transition-colors" data-action="delete">🗑️ Ta bort album</button>`;

  const rect = anchor.getBoundingClientRect();
  menu.style.top  = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 180)}px`;
  document.body.appendChild(menu);

  const close = () => menu.remove();
  setTimeout(() => document.addEventListener('click', close, { once: true }), 0);

  menu.querySelector('[data-action="rename"]').addEventListener('click', async () => {
    close();
    const name = await promptModal('Byt namn', 'Albumnamn', al.name, false);
    if (!name?.trim() || name.trim() === al.name) return;
    try {
      await api.updateAlbum(al.id, { name: name.trim() });
      toast('Namn uppdaterat', 'success');
      loadAlbumList(container);
    } catch (e) { toast(e.message, 'error'); }
  });

  menu.querySelector('[data-action="desc"]').addEventListener('click', async () => {
    close();
    const desc = await promptModal('Redigera beskrivning', 'Beskrivning', al.description ?? '', true);
    if (desc === null) return;
    try {
      await api.updateAlbum(al.id, { description: desc });
      toast('Beskrivning uppdaterad', 'success');
      loadAlbumList(container);
    } catch (e) { toast(e.message, 'error'); }
  });

  menu.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    close();
    const ok = await confirm(`Ta bort albumet "${al.name}"? Bilderna påverkas inte.`);
    if (!ok) return;
    try {
      await api.deleteAlbum(al.id);
      toast('Album borttaget', 'success');
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
  overlay.querySelector('#new-album-name').focus();

  overlay.querySelector('#cancel-album').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const create = async () => {
    const name = overlay.querySelector('#new-album-name').value.trim();
    const desc = overlay.querySelector('#new-album-desc').value.trim();
    if (!name) return;
    try {
      const { data } = await api.createAlbum({ name, description: desc || undefined });
      overlay.remove();
      toast('Album skapat!', 'success');
      location.hash = `#/albums/${data.id}`;
    } catch (e) { toast(e.message, 'error'); }
  };

  overlay.querySelector('#create-album').addEventListener('click', create);
  overlay.querySelector('#new-album-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
}

// ── Album-detalj ───────────────────────────────────────────────────────────────

async function renderAlbumDetail(container, albumId) {
  container.innerHTML = `
    <div class="p-4 flex flex-col h-full">
      <button onclick="location.hash='#/albums'" class="text-slate-400 hover:text-white text-sm mb-4 flex items-center gap-1 w-fit">
        ← Alla album
      </button>
      <div id="album-header" class="mb-4">
        <div id="album-title-row" class="flex items-center gap-2 flex-wrap"></div>
        <div id="album-desc-row" class="mt-1"></div>
      </div>
      <div id="album-grid" class="grid gap-0.5 flex-1" style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))">
        <div class="col-span-full text-slate-400 text-sm p-2">Laddar…</div>
      </div>
    </div>`;

  await loadAlbumDetail(container, albumId);
}

async function loadAlbumDetail(container, albumId) {
  try {
    // Hämta alla bilder (paginerar internt)
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

    // Header: titel (inline-edit) + beskrivning
    const titleRow = document.getElementById('album-title-row');
    const descRow  = document.getElementById('album-desc-row');

    const renderTitle = () => {
      titleRow.innerHTML = `
        <h1 id="album-name-display" class="text-xl font-semibold text-white cursor-pointer hover:text-blue-300 transition-colors"
            title="Klicka för att byta namn">${escHtml(album.name)}</h1>`;
      titleRow.querySelector('#album-name-display').addEventListener('click', async () => {
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

    // Grid med bilder
    const grid = document.getElementById('album-grid');
    if (!allAssets.length) {
      grid.innerHTML = `<div class="col-span-full text-slate-400 text-sm p-2">Albumet är tomt. Lägg till bilder via Bilder-fliken (markera bilder → 📁 Lägg till i album).</div>`;
      return;
    }

    grid.innerHTML = '';
    allAssets.forEach((asset, i) => {
      const cell = buildPhotoCell(
        asset,
        () => openLightbox(allAssets, i),
        null,
      );

      // Hover-overlay: ta bort + sätt som omslag
      const overlay = document.createElement('div');
      overlay.className = 'album-cell-overlay absolute inset-0 flex items-end justify-between p-1.5 opacity-0 hover:opacity-100 transition-opacity pointer-events-none';
      overlay.style.background = 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 60%)';
      overlay.innerHTML = `
        <button class="set-cover-btn pointer-events-auto text-xs bg-black/50 hover:bg-blue-600 text-white px-2 py-0.5 rounded transition-colors"
                title="Sätt som omslag">🖼</button>
        <button class="remove-from-album-btn pointer-events-auto text-xs bg-black/50 hover:bg-red-600 text-white px-2 py-0.5 rounded transition-colors"
                title="Ta bort från album">✕</button>`;

      cell.style.position = 'relative';
      cell.appendChild(overlay);

      overlay.querySelector('.set-cover-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await api.updateAlbum(albumId, { coverAssetId: asset.id });
          toast('Omslag uppdaterat', 'success');
        } catch (err) { toast(err.message, 'error'); }
      });

      overlay.querySelector('.remove-from-album-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await api.removeFromAlbum(albumId, asset.id);
          cell.remove();
          allAssets.splice(i, 1);
          if (!grid.querySelector('[data-id]')) {
            grid.innerHTML = '<div class="col-span-full text-slate-400 text-sm p-2">Albumet är tomt.</div>';
          }
        } catch (err) { toast(err.message, 'error'); }
      });

      grid.appendChild(cell);
    });
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── Lägg till bilder i album — modal ──────────────────────────────────────────

export async function openAddToAlbumModal(assetIds) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-black/70';

  let albums = [];
  try { ({ data: albums } = await api.albums()); } catch {}

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
        <div>
          <div class="text-sm text-white font-medium">${escHtml(al.name)}</div>
          <div class="text-xs text-slate-400">${al.asset_count} bilder</div>
        </div>
      </button>`).join('');

    list.querySelectorAll('.album-pick-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api.addToAlbum(btn.dataset.albumId, assetIds);
          overlay.remove();
          toast(`Lade till i "${btn.dataset.albumName}"`, 'success');
        } catch (e) { toast(e.message, 'error'); }
      });
    });
  };

  renderList();

  overlay.querySelector('#album-search').addEventListener('input', (e) => renderList(e.target.value));
  overlay.querySelector('#ata-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#create-new-album-btn').addEventListener('click', async () => {
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

    const input = overlay.querySelector('#pm-input');
    // Sätt markören i slutet av texten
    requestAnimationFrame(() => {
      input.focus();
      if (!multiline) { input.selectionStart = input.selectionEnd = input.value.length; }
    });

    const done = (value) => { overlay.remove(); resolve(value); };

    overlay.querySelector('#pm-x').addEventListener('click', () => done(null));
    overlay.querySelector('#pm-cancel').addEventListener('click', () => done(null));
    overlay.querySelector('#pm-save').addEventListener('click', () => done(input.value));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      if (e.key === 'Enter' && !multiline) { e.preventDefault(); done(input.value); }
    });
  });
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
