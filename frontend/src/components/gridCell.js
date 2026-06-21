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
 * Om asset.stack_id sätts och asset.stack_size > 1 visas en "hög"-visuell.
 */
export function buildPhotoCell(asset, onClick, onFavChange) {
  const cell = document.createElement('div');
  const isStack = asset.stack_id && asset.stack_size > 1;
  cell.className = `photo-cell relative group${isStack ? ' is-stack' : ''}`;
  cell.dataset.id = asset.id;
  if (asset.stack_id) cell.dataset.stackId = asset.stack_id;

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
    ${asset.is_motion_photo && !isVideo(asset.mime_type) ? `
      <div class="absolute bottom-1 left-1 pointer-events-none" title="Motion Photo">
        <div class="bg-black/60 rounded-full p-1">
          <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
          </svg>
        </div>
      </div>` : ''}
    ${isStack ? `
      <div class="absolute bottom-1 right-1 pointer-events-none">
        <span class="bg-black/70 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">${asset.stack_size}</span>
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
 * Visar en kontextmeny vid högerklick.
 * Stöder enstaka och batch-läge via selectionManager.
 *
 * @param {MouseEvent} e
 * @param {object} asset  — det klickade assetet
 * @param {object} opts
 *   selectionManager — den aktiva SelectionManager-instansen (eller null)
 *   getAllAssets      — funktion som returnerar alla assets i vyn
 *   onDelete
 *   openLightboxFn
 *   allAssets / index (äldre alternativ om getAllAssets saknas)
 *   onAddToAlbum
 *   onRefresh        — callback för att ladda om vyn
 */
export function showAssetContextMenu(e, asset, {
  selectionManager = null,
  getAllAssets = null,
  onDelete,
  openLightboxFn,
  allAssets,
  index,
  onAddToAlbum,
  onRefresh,
} = {}) {
  e.preventDefault();
  document.querySelectorAll('.asset-ctx-menu').forEach((m) => m.remove());

  // Bestäm om vi är i batch-läge
  const sel = selectionManager;
  const selected = sel?.getSelected();
  const isBatch = selected && selected.size > 1 && selected.has(asset.id);
  const resolvedAll = getAllAssets ? getAllAssets() : (allAssets ?? [asset]);

  const targetAssets = isBatch
    ? resolvedAll.filter((a) => selected.has(a.id))
    : [asset];

  const menu = document.createElement('div');
  menu.className = 'asset-ctx-menu fixed z-[9500] bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-1 min-w-[200px] text-sm';

  // Positionera menyn — håll inom viewport
  const menuW = 220;
  const menuH = 380;
  const x = Math.min(e.clientX, window.innerWidth  - menuW - 8);
  const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
  menu.style.left = `${Math.max(4, x)}px`;
  menu.style.top  = `${Math.max(4, y)}px`;

  const close = () => menu.remove();

  // Helper för menyknapp
  const item = (icon, label, cls = '') => {
    const btn = document.createElement('button');
    btn.className = `w-full text-left px-4 py-2 flex items-center gap-2.5 hover:bg-slate-700 transition-colors ${cls || 'text-slate-200'}`;
    btn.innerHTML = `<span class="text-base leading-none">${icon}</span><span>${label}</span>`;
    return btn;
  };

  const sep = () => {
    const d = document.createElement('div');
    d.className = 'border-t border-slate-700 my-1';
    return d;
  };

  // ── Enstaka-åtgärder ──────────────────────────────────────────────────────
  if (!isBatch) {
    const openBtn = item('🔍', 'Öppna');
    openBtn.addEventListener('click', () => {
      close();
      if (openLightboxFn) openLightboxFn(resolvedAll, index ?? resolvedAll.indexOf(asset));
    });

    const isFav = asset.is_favorite;
    const favBtn = item(isFav ? '💔' : '❤️', isFav ? 'Ta bort favorit' : 'Lägg till favorit');
    favBtn.addEventListener('click', async () => {
      close();
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
    albumBtn.addEventListener('click', () => { close(); onAddToAlbum?.([asset.id]); });

    // Stjärnbetyg
    const ratingBtn = item('⭐', 'Sätt betyg');
    ratingBtn.addEventListener('click', () => {
      close();
      openRatingMenu(asset, e);
    });

    // Dela foto
    const shareBtn = item('🔗', 'Dela foto');
    shareBtn.addEventListener('click', async () => {
      close();
      try {
        const { data } = await api.createShare({ assetIds: [asset.id], type: 'link' });
        const url = `${location.origin}/share/${data.token}`;
        await navigator.clipboard.writeText(url).catch(() => {});
        const { toast } = await import('../utils.js');
        toast('Delningslänk kopierad!', 'success');
      } catch (err) {
        const { toast } = await import('../utils.js');
        toast('Kunde inte skapa länk: ' + err.message, 'error');
      }
    });

    const editBtn = item('✏️', 'Redigera bild');
    editBtn.addEventListener('click', () => {
      close();
      openImageEditor(asset, (updated) => {
        if (updated?.thumb_small_path) {
          const img = document.querySelector(`.photo-cell[data-id="${asset.id}"] img`);
          if (img) /** @type {HTMLImageElement} */ (img).src = `/thumbs/${updated.thumb_small_path}?t=${Date.now()}`;
          Object.assign(asset, updated);
        }
      });
    });

    menu.append(openBtn, favBtn, albumBtn, ratingBtn, shareBtn, editBtn, sep());
  } else {
    // Batch-rubrik
    const header = document.createElement('div');
    header.className = 'px-4 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider';
    header.textContent = `${targetAssets.length} bilder markerade`;
    menu.appendChild(header);

    const albumBtn = item('📁', 'Lägg till i album');
    albumBtn.addEventListener('click', () => { close(); onAddToAlbum?.(targetAssets.map((a) => a.id)); });
    menu.append(albumBtn, sep());
  }

  // ── Metadata (enstaka & batch) ─────────────────────────────────────────────
  const metaLabel = isBatch ? 'Batch edit…' : 'Redigera metadata…';
  const metaBtn = item('🏷️', metaLabel);
  metaBtn.addEventListener('click', async () => {
    close();
    if (isBatch) {
      const { openBatchMetaModal } = await import('./modals/batchMetaModal.js');
      openBatchMetaModal(targetAssets);
    } else {
      const { openEditMetaModal } = await import('./editMetaModal.js');
      openEditMetaModal(asset.id, asset.taken_at, asset.location_label, asset);
    }
  });

  // ── Rotera ────────────────────────────────────────────────────────────────
  const rotCWBtn = item('↻', 'Rotera medsols');
  rotCWBtn.addEventListener('click', async () => {
    close();
    const { rotateAssets } = await import('./contextActions/rotateAction.js');
    rotateAssets(targetAssets, 90, onRefresh);
  });

  const rotCCWBtn = item('↺', 'Rotera motsols');
  rotCCWBtn.addEventListener('click', async () => {
    close();
    const { rotateAssets } = await import('./contextActions/rotateAction.js');
    rotateAssets(targetAssets, -90, onRefresh);
  });

  // ── Ändra namn ────────────────────────────────────────────────────────────
  const renameBtn = item('✏️', 'Ändra namn…');
  renameBtn.addEventListener('click', async () => {
    close();
    const { openRenameModal } = await import('./modals/renameModal.js');
    openRenameModal(targetAssets, onRefresh);
  });

  // ── Kopiera / Flytta ──────────────────────────────────────────────────────
  const copyBtn = item('📋', 'Kopiera till…');
  copyBtn.addEventListener('click', async () => {
    close();
    const { openFolderPickerModal } = await import('./modals/folderPickerModal.js');
    openFolderPickerModal({ mode: 'copy', assets: targetAssets, onDone: onRefresh });
  });

  const moveBtn = item('📂', 'Flytta till…');
  moveBtn.addEventListener('click', async () => {
    close();
    const { openFolderPickerModal } = await import('./modals/folderPickerModal.js');
    openFolderPickerModal({ mode: 'move', assets: targetAssets, onDone: onRefresh });
  });

  menu.append(metaBtn, rotCWBtn, rotCCWBtn, sep(), renameBtn, copyBtn, moveBtn);

  // ── Stack-åtgärder ────────────────────────────────────────────────────────
  if (isBatch) {
    const stackBtn = item('🗂️', 'Skapa stack');
    stackBtn.addEventListener('click', async () => {
      close();
      const { createStack } = await import('./contextActions/stackAction.js');
      createStack(targetAssets, onRefresh);
    });
    menu.append(sep(), stackBtn);
  } else if (asset.stack_id) {
    const unStackBtn = item('🗂️', 'Ta bort från stack');
    unStackBtn.addEventListener('click', async () => {
      close();
      const { removeFromStack } = await import('./contextActions/stackAction.js');
      removeFromStack(asset, onRefresh);
    });
    menu.append(sep(), unStackBtn);
  }

  // ── Radera ────────────────────────────────────────────────────────────────
  menu.appendChild(sep());
  const deleteLabel = isBatch ? `Radera ${targetAssets.length} bilder` : 'Radera';
  const deleteBtn = item('🗑️', deleteLabel, 'text-red-400 hover:text-red-300');
  deleteBtn.addEventListener('click', async () => {
    close();
    const ids = targetAssets.map((a) => a.id);
    ids.forEach((id) => {
      document.querySelector(`.photo-cell[data-id="${id}"]`)?.remove();
    });
    await Promise.all(ids.map((id) => api.trash(id).catch(() => {})));
    ids.forEach((id) => onDelete?.(id));
    showUndoToast(
      `${ids.length} bild${ids.length > 1 ? 'er' : ''} raderad${ids.length > 1 ? 'e' : ''}`,
      async () => {
        await Promise.all(ids.map((id) => api.restore(id).catch(() => {})));
        ids.forEach((id) => onDelete?.(id, true));
      },
    );
  });
  menu.appendChild(deleteBtn);

  document.body.appendChild(menu);

  // ESC-tangent stänger menyn
  const onKey = (ev) => { if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);

  const onOutsideClick = (ev) => {
    if (!menu.contains(ev.target)) {
      close();
      document.removeEventListener('mousedown', onOutsideClick);
      document.removeEventListener('keydown', onKey);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', onOutsideClick), 0);
}

// ── Stjärnbetyg-submeny ───────────────────────────────────────────────────────
function openRatingMenu(asset, originalEvent) {
  document.querySelectorAll('.asset-ctx-menu').forEach((m) => m.remove());

  const menu = document.createElement('div');
  menu.className = 'asset-ctx-menu fixed z-[9500] bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-2 px-3';
  menu.style.left = `${Math.min(originalEvent.clientX, window.innerWidth - 180)}px`;
  menu.style.top  = `${Math.min(originalEvent.clientY + 30, window.innerHeight - 80)}px`;

  const label = document.createElement('div');
  label.className = 'text-xs text-slate-400 mb-1.5';
  label.textContent = 'Välj betyg';
  menu.appendChild(label);

  const stars = document.createElement('div');
  stars.className = 'flex gap-1';
  for (let i = 1; i <= 5; i++) {
    const btn = document.createElement('button');
    btn.className = 'text-xl hover:scale-125 transition-transform';
    btn.textContent = i <= (asset.rating ?? 0) ? '★' : '☆';
    btn.title = `${i} stjärna${i > 1 ? 'r' : ''}`;
    const rating = i;
    btn.addEventListener('click', async () => {
      menu.remove();
      try {
        await api.patchMeta(asset.id, { rating });
        asset.rating = rating;
        const { toast } = await import('../utils.js');
        toast(`Betyg satt: ${rating} ⭐`, 'success');
      } catch (err) {
        const { toast } = await import('../utils.js');
        toast('Kunde inte spara betyg', 'error');
      }
    });
    stars.appendChild(btn);
  }

  // Nollställ betyg
  if (asset.rating) {
    const clearBtn = document.createElement('button');
    clearBtn.className = 'mt-1.5 text-xs text-slate-500 hover:text-white w-full text-left';
    clearBtn.textContent = 'Ta bort betyg';
    clearBtn.addEventListener('click', async () => {
      menu.remove();
      await api.patchMeta(asset.id, { rating: null }).catch(() => {});
      asset.rating = null;
    });
    menu.append(stars, clearBtn);
  } else {
    menu.appendChild(stars);
  }

  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('mousedown', (ev) => {
    if (!menu.contains(ev.target)) menu.remove();
  }, { once: true }), 0);
}

// ── Favorit-toggle ────────────────────────────────────────────────────────────
async function toggleFav(asset, btn, onFavChange) {
  const wasFav = btn.classList.contains('is-fav');

  btn.classList.toggle('is-fav', !wasFav);
  btn.title = wasFav ? 'Lägg till favorit' : 'Ta bort favorit';

  if (wasFav) {
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
