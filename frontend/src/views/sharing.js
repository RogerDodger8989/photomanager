import { api } from '../api.js';
import { toast, formatDate, formatDateTime, confirm } from '../utils.js';
import { openShareModal } from '../components/shareModal.js';

export async function renderSharing(container) {
  container.innerHTML = `
    <div class="p-4">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-xl font-semibold text-white">Delning</h1>
        <button id="new-share-btn" class="bg-blue-600 hover:bg-blue-500 text-white text-sm px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5">
          🔗 Ny delning
        </button>
      </div>
      <div class="flex gap-2 mb-4 border-b border-slate-700">
        <button id="tab-out" class="tab-btn pb-2 px-1 text-sm font-medium text-white border-b-2 border-blue-500">Mina delningar</button>
        <button id="tab-in"  class="tab-btn pb-2 px-1 text-sm font-medium text-slate-400 border-b-2 border-transparent hover:text-white">Mottagna</button>
      </div>
      <div id="sharing-content"></div>
    </div>`;

  const content = document.getElementById('sharing-content');

  const showOutgoing = () => loadOutgoing(content);
  const showIncoming = () => loadIncoming(content);

  document.getElementById('tab-out')?.addEventListener('click', () => {
    setActiveTab('tab-out');
    showOutgoing();
  });
  document.getElementById('tab-in')?.addEventListener('click', () => {
    setActiveTab('tab-in');
    showIncoming();
  });

  document.getElementById('new-share-btn')?.addEventListener('click', () => {
    showNewSharePickerModal(content);
  });

  showOutgoing();
}

function setActiveTab(activeId) {
  ['tab-out','tab-in'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const isActive = id === activeId;
    btn.className = `tab-btn pb-2 px-1 text-sm font-medium border-b-2 ${
      isActive ? 'text-white border-blue-500' : 'text-slate-400 border-transparent hover:text-white'
    }`;
  });
}

async function loadOutgoing(content) {
  if (!content) return;
  content.innerHTML = '<div class="text-slate-400 text-sm">Laddar…</div>';
  try {
    const { data } = await api.shares();
    if (!data.length) {
      content.innerHTML = `
        <div class="text-center py-12">
          <div class="text-4xl mb-3">🔗</div>
          <p class="text-slate-400 text-sm">Inga aktiva delningar.</p>
          <p class="text-slate-500 text-xs mt-1">Öppna en bild eller ett album och klicka Dela.</p>
        </div>`;
      return;
    }

    content.innerHTML = `<div class="space-y-2">${data.map((s) => renderShareCard(s)).join('')}</div>`;

    content.querySelectorAll('.delete-share').forEach((btn) => {
      const b = /** @type {HTMLElement} */ (btn);
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!await confirm('Ta bort delningen?')) return;
        try {
          await api.deleteShare(b.dataset.id);
          toast('Delning borttagen', 'success');
          loadOutgoing(content);
        } catch (err) { toast(err.message, 'error'); }
      });
    });

    content.querySelectorAll('.copy-share-link').forEach((btn) => {
      const b = /** @type {HTMLElement} */ (btn);
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const url = b.dataset.url ?? '';
        try {
          await navigator.clipboard.writeText(url);
          b.textContent = '✓';
          setTimeout(() => { b.textContent = '📋'; }, 2000);
        } catch {
          toast(url, 'info');
        }
      });
    });
  } catch (e) { toast(e.message, 'error'); }
}

function renderShareCard(s) {
  const url = s.token ? `${location.origin}/share/${s.token}` : null;
  const typeLabel = s.share_type === 'public_link' ? '🔗 Publik länk' : `👤 ${s.shared_with_username ?? '–'}`;
  const expiryLabel = s.expires_at ? `· Utgår ${formatDate(s.expires_at)}` : '';
  const maxViewsLabel = s.max_views ? `· Max ${s.max_views} visningar` : '';
  const lastViewedLabel = s.last_viewed_at ? `· Senast visad ${formatDateTime(s.last_viewed_at)}` : '';
  const isExpired = s.expires_at && new Date(s.expires_at) < new Date();

  return `
    <div class="bg-slate-800 rounded-xl p-3 border ${isExpired ? 'border-red-800/40' : 'border-slate-700'}">
      <div class="flex items-center gap-3">
        ${s.thumb_small_path
          ? `<img src="/thumbs/${s.thumb_small_path}" class="w-12 h-12 rounded-lg object-cover flex-shrink-0">`
          : `<div class="w-12 h-12 rounded-lg bg-slate-700 flex items-center justify-center text-xl flex-shrink-0">${s.album_id ? '📁' : '🖼️'}</div>`}
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-white truncate">
            ${s.asset_name ?? s.album_name ?? 'Okänt'}
            ${isExpired ? '<span class="ml-1 text-xs text-red-400">Utgången</span>' : ''}
          </div>
          <div class="text-xs text-slate-400 mt-0.5">
            ${typeLabel} ${expiryLabel} ${maxViewsLabel} · 👁 ${s.view_count} visningar ${lastViewedLabel}
          </div>
          ${url ? `
            <div class="flex items-center gap-1.5 mt-1.5">
              <input readonly value="${url}"
                class="flex-1 bg-slate-700 text-xs text-slate-300 px-2 py-1 rounded cursor-pointer min-w-0"
                onclick="this.select()">
              <button class="copy-share-link flex-shrink-0 w-7 h-7 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded flex items-center justify-center text-sm transition-colors"
                      data-url="${url}" title="Kopiera länk">📋</button>
            </div>` : ''}
        </div>
        <button class="delete-share flex-shrink-0 w-7 h-7 text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded flex items-center justify-center transition-colors"
                data-id="${s.id}" title="Ta bort delning">✕</button>
      </div>
    </div>`;
}

async function loadIncoming(content) {
  if (!content) return;
  content.innerHTML = '<div class="text-slate-400 text-sm">Laddar…</div>';
  try {
    const { data } = await api.received();
    if (!data.length) {
      content.innerHTML = `
        <div class="text-center py-12">
          <div class="text-4xl mb-3">📬</div>
          <p class="text-slate-400 text-sm">Inga mottagna delningar.</p>
        </div>`;
      return;
    }

    content.innerHTML = `
      <div class="space-y-2">
        ${data.map((s) => `
          <div class="flex items-center gap-3 bg-slate-800 rounded-xl p-3 border border-slate-700">
            ${s.thumb_small_path
              ? `<img src="/thumbs/${s.thumb_small_path}" class="w-12 h-12 rounded-lg object-cover flex-shrink-0">`
              : `<div class="w-12 h-12 rounded-lg bg-slate-700 flex items-center justify-center text-xl flex-shrink-0">📷</div>`}
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-white truncate">${s.file_name ?? s.album_name ?? 'Delat innehåll'}</div>
              <div class="text-xs text-slate-400 mt-0.5">Från ${s.shared_by_username} · ${formatDate(s.created_at)}</div>
            </div>
          </div>`).join('')}
      </div>`;
  } catch (e) { toast(e.message, 'error'); }
}

// ── Välj vad som ska delas ──────────────────────────────────────────────────

async function showNewSharePickerModal(refreshTarget) {
  let albums = [];
  let recentAssets = [];
  try {
    const [albumsRes, assetsRes] = await Promise.all([api.albums(), api.assets({ limit: 20 })]);
    albums = albumsRes.data ?? [];
    recentAssets = assetsRes.data ?? [];
  } catch {}

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[8000] flex items-center justify-center bg-black/70 p-4';
  overlay.innerHTML = `
    <div class="bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl border border-slate-700 flex flex-col max-h-[80vh]">
      <div class="flex items-center justify-between px-6 py-4 border-b border-slate-700 flex-shrink-0">
        <h2 class="text-lg font-semibold text-white">Vad vill du dela?</h2>
        <button id="picker-close" class="text-slate-400 hover:text-white transition-colors text-xl leading-none">✕</button>
      </div>
      <div class="flex gap-2 px-6 pt-4 flex-shrink-0">
        <button id="pick-tab-albums" class="pick-tab flex-1 py-1.5 text-sm rounded-lg bg-blue-600 text-white transition-colors">Album</button>
        <button id="pick-tab-photos" class="pick-tab flex-1 py-1.5 text-sm rounded-lg text-slate-400 hover:bg-slate-700 transition-colors">Senaste bilder</button>
      </div>
      <div id="picker-list" class="flex-1 overflow-y-auto px-6 py-3 space-y-1.5"></div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#picker-close')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const listEl = overlay.querySelector('#picker-list');

  const showAlbums = () => {
    overlay.querySelectorAll('.pick-tab').forEach((b) => {
      b.classList.remove('bg-blue-600', 'text-white');
      b.classList.add('text-slate-400');
    });
    overlay.querySelector('#pick-tab-albums')?.classList.add('bg-blue-600', 'text-white');
    overlay.querySelector('#pick-tab-albums')?.classList.remove('text-slate-400');

    if (!listEl) return;
    if (!albums.length) { listEl.innerHTML = '<p class="text-slate-500 text-sm py-4 text-center">Inga album ännu.</p>'; return; }
    listEl.innerHTML = albums.map((al) => `
      <button class="pick-item w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-700 transition-colors text-left"
              data-album-id="${al.id}" data-name="${escHtml(al.name)}">
        <div class="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-slate-700">
          ${al.cover_thumb
            ? `<img src="/thumbs/${al.cover_thumb}" class="w-full h-full object-cover">`
            : `<div class="w-full h-full flex items-center justify-center">📁</div>`}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm text-white font-medium truncate">${escHtml(al.name)}</div>
          <div class="text-xs text-slate-400">${al.asset_count} bilder</div>
        </div>
      </button>`).join('');
    listEl.querySelectorAll('.pick-item').forEach((btn) => {
      const b = /** @type {HTMLElement} */ (btn);
      b.addEventListener('click', () => {
        overlay.remove();
        openShareModal({ albumId: b.dataset.albumId, name: b.dataset.name });
      });
    });
  };

  const showPhotos = () => {
    overlay.querySelectorAll('.pick-tab').forEach((b) => {
      b.classList.remove('bg-blue-600', 'text-white');
      b.classList.add('text-slate-400');
    });
    overlay.querySelector('#pick-tab-photos')?.classList.add('bg-blue-600', 'text-white');
    overlay.querySelector('#pick-tab-photos')?.classList.remove('text-slate-400');

    if (!listEl) return;
    if (!recentAssets.length) { listEl.innerHTML = '<p class="text-slate-500 text-sm py-4 text-center">Inga bilder hittades.</p>'; return; }
    listEl.innerHTML = recentAssets.map((a) => `
      <button class="pick-item w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-700 transition-colors text-left"
              data-asset-id="${a.id}" data-name="${escHtml(a.file_name)}">
        <div class="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-slate-700">
          ${a.thumb_small_path
            ? `<img src="/thumbs/${a.thumb_small_path}" class="w-full h-full object-cover">`
            : `<div class="w-full h-full flex items-center justify-center text-lg">🖼️</div>`}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm text-white truncate">${escHtml(a.file_name)}</div>
        </div>
      </button>`).join('');
    listEl.querySelectorAll('.pick-item').forEach((btn) => {
      const b = /** @type {HTMLElement} */ (btn);
      b.addEventListener('click', () => {
        overlay.remove();
        openShareModal({ assetId: b.dataset.assetId, name: b.dataset.name });
      });
    });
  };

  overlay.querySelector('#pick-tab-albums')?.addEventListener('click', showAlbums);
  overlay.querySelector('#pick-tab-photos')?.addEventListener('click', showPhotos);

  showAlbums();
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
