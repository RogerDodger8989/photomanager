import { api } from '../api.js';
import { openLightbox } from '../components/lightbox.js';
import { toast, modal, confirm } from '../utils.js';

export async function renderAlbums(container, albumId = null) {
  if (albumId) {
    await renderAlbumDetail(container, albumId);
  } else {
    await renderAlbumList(container);
  }
}

async function renderAlbumList(container) {
  container.innerHTML = `<div class="p-4">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-semibold text-white">Album</h1>
      <button id="new-album-btn" class="bg-blue-600 hover:bg-blue-500 text-white text-sm px-3 py-1.5 rounded-lg transition-colors">
        + Nytt album
      </button>
    </div>
    <div id="albums-grid" class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">
      <div class="col-span-full text-slate-400 text-sm">Laddar…</div>
    </div>
  </div>`;

  document.getElementById('new-album-btn').addEventListener('click', () => {
    const m = modal('Nytt album', `
      <input id="new-album-name" type="text" placeholder="Albumnamn" class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">`,
      `<button id="create-album-btn" class="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm">Skapa</button>`
    );
    m.querySelector('#create-album-btn').addEventListener('click', async () => {
      const name = m.querySelector('#new-album-name').value.trim();
      if (!name) return;
      try {
        await api.createAlbum({ name });
        m.remove();
        toast('Album skapat!', 'success');
        renderAlbumList(container);
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  try {
    const { data } = await api.albums();
    const grid = document.getElementById('albums-grid');
    if (!data?.length) { grid.innerHTML = '<div class="col-span-full text-slate-400 text-sm">Inga album ännu.</div>'; return; }

    grid.innerHTML = data.map((al) => `
      <div class="group cursor-pointer rounded-xl overflow-hidden bg-slate-800 hover:bg-slate-700 transition-colors"
           data-album-id="${al.id}">
        <div class="aspect-square overflow-hidden">
          ${al.cover_thumb
            ? `<img src="/thumbs/${al.cover_thumb}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">`
            : `<div class="w-full h-full bg-slate-700 flex items-center justify-center text-4xl">🗂️</div>`}
        </div>
        <div class="p-3">
          <div class="font-medium text-sm text-white truncate">${al.name}</div>
          <div class="text-xs text-slate-400">${al.asset_count} bilder</div>
        </div>
      </div>`).join('');

    grid.querySelectorAll('[data-album-id]').forEach((el) => {
      el.addEventListener('click', () => {
        location.hash = `#/albums/${el.dataset.albumId}`;
      });
    });
  } catch (e) { toast(e.message, 'error'); }
}

async function renderAlbumDetail(container, albumId) {
  container.innerHTML = `
    <div class="p-4">
      <button onclick="location.hash='#/albums'" class="text-slate-400 hover:text-white text-sm mb-4 flex items-center gap-1">
        ← Tillbaka
      </button>
      <div id="album-header" class="mb-4"></div>
      <div id="album-grid" class="grid gap-0.5" style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))">
        <div class="col-span-full text-slate-400 text-sm p-2">Laddar…</div>
      </div>
    </div>`;

  try {
    const { data } = await api.album(albumId);
    document.getElementById('album-header').innerHTML = `
      <h1 class="text-xl font-semibold text-white">${data.album.name}</h1>
      ${data.album.description ? `<p class="text-slate-400 text-sm mt-1">${data.album.description}</p>` : ''}`;

    const grid = document.getElementById('album-grid');
    if (!data.assets.length) { grid.innerHTML = '<div class="col-span-full text-slate-400 text-sm p-2">Albumet är tomt.</div>'; return; }

    grid.innerHTML = '';
    data.assets.forEach((asset, i) => {
      const cell = document.createElement('div');
      cell.className = 'photo-cell';
      cell.innerHTML = `<img src="/thumbs/${asset.thumb_small_path}" loading="lazy" alt="${asset.file_name}">`;
      cell.addEventListener('click', () => openLightbox(data.assets, i));
      grid.appendChild(cell);
    });
  } catch (e) { toast(e.message, 'error'); }
}
