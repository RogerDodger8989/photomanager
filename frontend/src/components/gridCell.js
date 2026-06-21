import { api } from '../api.js';
import { isVideo } from '../utils.js';
import { showUndoToast } from './lightbox.js';
import { openImageEditor } from './imageEditor.js';

const HEART_SVG = `<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
  <path stroke-linecap="round" stroke-linejoin="round"
    d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
</svg>`;

/**
 * Skapar en grid-cell div med thumbnail, video-badge och favorit-hjärta.
 * @param {object} asset
 * @param {function} onClick  - anropas vid klick på bilden
 * @param {function} [onFavChange]  - anropas med (assetId, newIsFav) efter ändring
 */
export function buildPhotoCell(asset, onClick, onFavChange) {
  const cell = document.createElement('div');
  cell.className = 'photo-cell relative group';
  cell.dataset.id = asset.id;

  const thumbSrc = asset.thumb_small_path
    ? `/thumbs/${asset.thumb_small_path}`
    : '/icons/placeholder.svg';

  cell.innerHTML = `
    <img src="${thumbSrc}"
         loading="lazy" alt="${asset.file_name ?? ''}"
         class="w-full h-full object-cover bg-slate-800">
    ${isVideo(asset.mime_type) ? `
      <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div class="bg-black/50 rounded-full p-2">
          <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </div>
      </div>` : ''}
    <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none"></div>
    <button class="fav-heart${asset.is_favorite ? ' is-fav' : ''}" title="${asset.is_favorite ? 'Ta bort favorit' : 'Lägg till favorit'}">
      ${HEART_SVG}
    </button>`;

  cell.addEventListener('click', (e) => {
    if (!(/** @type {Element} */ (e.target)).closest('.fav-heart')) onClick();
  });

  const heartBtn = cell.querySelector('.fav-heart');
  if (!heartBtn) return cell;
  heartBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFav(asset, heartBtn, onFavChange);
  });

  return cell;
}

/**
 * Lägger till favorit-hjärta på en cell som redan är byggd (t.ex. persons-vyn).
 */
export function attachFavHeart(cell, asset, onFavChange) {
  cell.dataset.id = asset.id;
  const btn = document.createElement('button');
  btn.className = `fav-heart${asset.is_favorite ? ' is-fav' : ''}`;
  btn.title = asset.is_favorite ? 'Ta bort favorit' : 'Lägg till favorit';
  btn.innerHTML = HEART_SVG;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFav(asset, btn, onFavChange);
  });
  cell.appendChild(btn);
}

/**
 * Visar en kontextmeny för ett foto vid högerklick.
 * @param {MouseEvent} e
 * @param {object} asset
 * @param {object} opts  — { onDelete, openLightboxFn, allAssets, index }
 */
export function showAssetContextMenu(e, asset, { onDelete, openLightboxFn, allAssets, index, onAddToAlbum } = {}) {
  e.preventDefault();
  document.querySelectorAll('.asset-ctx-menu').forEach((m) => m.remove());

  const isFav = asset.is_favorite;
  const menu = document.createElement('div');
  menu.className = 'asset-ctx-menu fixed z-[500] bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-1 min-w-[180px] text-sm';
  menu.style.left = `${Math.min(e.clientX, window.innerWidth - 200)}px`;
  menu.style.top  = `${Math.min(e.clientY, window.innerHeight - 200)}px`;

  const item = (icon, label, cls = '') => {
    const btn = document.createElement('button');
    btn.className = `w-full text-left px-4 py-2 flex items-center gap-2.5 hover:bg-slate-700 transition-colors ${cls || 'text-slate-200'}`;
    btn.innerHTML = `<span class="text-base leading-none">${icon}</span><span>${label}</span>`;
    return btn;
  };

  const openBtn = item('🔍', 'Öppna');
  openBtn.addEventListener('click', () => {
    menu.remove();
    if (openLightboxFn) openLightboxFn(allAssets ?? [asset], index ?? 0);
  });

  const favBtn = item(isFav ? '💔' : '❤️', isFav ? 'Ta bort favorit' : 'Lägg till favorit');
  favBtn.addEventListener('click', async () => {
    menu.remove();
    const heartBtn = document.querySelector(`.photo-cell[data-id="${asset.id}"] .fav-heart`);
    if (heartBtn) {
      heartBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } else {
      if (isFav) await api.removeFav(asset.id).catch(() => {});
      else await api.addFav(asset.id).catch(() => {});
      asset.is_favorite = !isFav;
    }
  });

  const albumBtn = item('📁', 'Lägg till i album');
  albumBtn.addEventListener('click', () => {
    menu.remove();
    onAddToAlbum?.([asset.id]);
  });

  const editBtn = item('✏️', 'Redigera');
  editBtn.addEventListener('click', () => {
    menu.remove();
    openImageEditor(asset, (updated) => {
      if (updated?.thumb_small_path) {
        const img = document.querySelector(`.photo-cell[data-id="${asset.id}"] img`);
        if (img) /** @type {HTMLImageElement} */ (img).src = `/thumbs/${updated.thumb_small_path}?t=${Date.now()}`;
        Object.assign(asset, updated);
      }
    });
  });

  const sep = document.createElement('div');
  sep.className = 'border-t border-slate-700 my-1';

  const deleteBtn = item('🗑️', 'Radera', 'text-red-400 hover:text-red-300');
  deleteBtn.addEventListener('click', async () => {
    menu.remove();
    const cell = document.querySelector(`.photo-cell[data-id="${asset.id}"]`);
    cell?.remove();
    await api.trash(asset.id).catch(() => {});
    onDelete?.(asset.id);
    showUndoToast('Bild raderad', async () => {
      await api.restore(asset.id).catch(() => {});
      onDelete?.(asset.id, true); // true = återställd
    });
  });

  menu.append(openBtn, favBtn, albumBtn, editBtn, sep, deleteBtn);
  document.body.appendChild(menu);

  const close = (ev) => {
    if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); }
  };
  setTimeout(() => document.addEventListener('mousedown', close), 0);
}

async function toggleFav(asset, btn, onFavChange) {
  const wasFav = btn.classList.contains('is-fav');

  // Optimistisk uppdatering
  btn.classList.toggle('is-fav', !wasFav);
  btn.title = wasFav ? 'Lägg till favorit' : 'Ta bort favorit';

  if (wasFav) {
    // Tar bort favorit → undo-toast
    await api.removeFav(asset.id).catch(() => {});
    onFavChange?.(asset.id, false);

    showUndoToast('Borttagen från favoriter', async () => {
      await api.addFav(asset.id).catch(() => {});
      btn.classList.add('is-fav');
      btn.title = 'Ta bort favorit';
      onFavChange?.(asset.id, true);
    });
  } else {
    await api.addFav(asset.id).catch(() => {});
    onFavChange?.(asset.id, true);
  }
}
