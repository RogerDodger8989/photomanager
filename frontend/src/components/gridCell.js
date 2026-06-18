import { api } from '../api.js';
import { isVideo } from '../utils.js';
import { showUndoToast } from './lightbox.js';

const HEART_SVG = `<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
  <path stroke-linecap="round" stroke-linejoin="round"
    d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
</svg>`;

/**
 * Skapar en grid-cell div med thumbnail, video-badge och favorit-hjärta.
 * @param {object} asset
 * @param {function} onClick  — anropas vid klick på bilden
 * @param {function} [onFavChange]  — anropas med (assetId, newIsFav) efter ändring
 */
export function buildPhotoCell(asset, onClick, onFavChange) {
  const cell = document.createElement('div');
  cell.className = 'photo-cell relative group';
  cell.dataset.id = asset.id;

  cell.innerHTML = `
    <img src="/thumbs/${asset.thumb_small_path}"
         loading="lazy" alt="${asset.file_name ?? ''}"
         class="w-full h-full object-cover">
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
    if (!e.target.closest('.fav-heart')) onClick();
  });

  const heartBtn = cell.querySelector('.fav-heart');
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
