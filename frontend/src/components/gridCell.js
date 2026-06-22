import { api } from '../api.js';
import { isVideo } from '../utils.js';
import { showUndoToast } from './lightbox.js';
import { openImageEditor } from './imageEditor.js';
import { COLOR_VALUES } from './thumbSettings.js';

const _esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const HEART_SVG = `<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
  <path stroke-linecap="round" stroke-linejoin="round"
    d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
</svg>`;

// SVG-flaggikon (fylld)
const FLAG_SVG = `<svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="width:12px;height:12px;display:block"><path d="M3 1.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 .354.854L9.207 5.5l3.647 3.646A.5.5 0 0 1 12.5 10H4v4.5a.5.5 0 0 1-1 0V1.5z"/></svg>`;

/**
 * Skapar en grid-cell div med thumbnail, video-badge, favorit-hjärta, flagg- och rating-badges.
 * @param {object} asset
 * @param {Function} onClick
 * @param {Function} [onFavChange]
 * @param {{items:string[], position:string, colorLabels:object}|null} [ts] thumbSettings
 */
export function buildPhotoCell(asset, onClick, onFavChange, ts = null) {
  const cell = document.createElement('div');
  const isStack = asset.stack_id && asset.stack_size > 1;
  cell.className = 'photo-cell group';
  cell.dataset.id = asset.id;
  if (asset.stack_id) cell.dataset.stackId = asset.stack_id;

  const thumbSrc = asset.thumb_small_path
    ? `/thumbs/${asset.thumb_small_path}`
    : '/icons/placeholder.svg';

  const overlayItems = ts?.items ?? [];

  // ── Färgborder ──
  const colorVal = overlayItems.includes('color_border') && asset.color_label
    ? COLOR_VALUES[asset.color_label] ?? null
    : null;
  const colorBorderHtml = colorVal
    ? `<div class="color-border-ring absolute inset-0 z-10 pointer-events-none" style="box-shadow:inset 0 0 0 4px ${colorVal}"></div>`
    : '';

  // ── Flagg-badge (bottom-left på bilden) — pill med ikon ──
  const flagColor = overlayItems.includes('flag') && asset.flag
    ? COLOR_VALUES[asset.flag] ?? null
    : null;
  const flagLabel = flagColor ? (ts?.colorLabels?.[String(asset.flag)] ?? `Flagga ${asset.flag}`) : '';
  const flagBadgeHtml = flagColor
    ? `<div class="flag-badge absolute bottom-1.5 left-1.5 z-20 pointer-events-none flex items-center rounded-full p-1" title="${_esc(flagLabel)}" style="background:rgba(0,0,0,0.65);color:${flagColor}">${FLAG_SVG}</div>`
    : '';

  // ── Rating-badge (bottom-right på bilden) — gula stjärnor med mörk bakgrund ──
  const ratingHtml = overlayItems.includes('rating') && asset.rating
    ? `<div class="rating-badge absolute bottom-1.5 right-1.5 z-20 pointer-events-none flex items-center rounded-full px-1.5 py-0.5" style="background:rgba(0,0,0,0.65);font-size:11px;line-height:1;color:#facc15;letter-spacing:-1px">${'★'.repeat(asset.rating)}</div>`
    : '';

  // ── Info-strip under bilden ──
  const hasFilename  = overlayItems.includes('filename');
  const hasSize      = overlayItems.includes('file_size') && asset.file_size;
  const hasDate      = overlayItems.includes('modified_at') && asset.indexed_at;
  const hasDims      = overlayItems.includes('dimensions') && asset.width && asset.height;
  const hasInfoStrip = hasFilename || hasSize || hasDate || hasDims;

  const infoStripHtml = hasInfoStrip
    ? `<div class="photo-info-strip bg-slate-900 px-1.5 py-0.5 text-[10px] leading-snug space-y-0.5">
        ${hasFilename ? `<div class="truncate text-slate-200" title="${_esc(asset.file_name ?? '')}">${_esc(asset.file_name ?? '')}</div>` : ''}
        ${hasSize    ? `<div class="text-slate-400">${Math.round(asset.file_size / 1024)} KiB</div>` : ''}
        ${hasDate    ? `<div class="text-slate-400">${new Date(asset.indexed_at).toLocaleDateString('sv-SE')}</div>` : ''}
        ${hasDims    ? `<div class="text-slate-400">${asset.width}×${asset.height}</div>` : ''}
       </div>`
    : '';

  // ── Bild-wrapper (square) ──
  const imgWrapClass = `photo-img-wrap relative overflow-hidden flex-shrink-0${isStack ? ' is-stack-wrap' : ''}`;

  cell.innerHTML = `
    <div class="${imgWrapClass}" style="aspect-ratio:1">
      <img src="${thumbSrc}" loading="lazy" alt="${_esc(asset.file_name ?? '')}"
           class="w-full h-full object-cover bg-slate-800">
      ${isVideo(asset.mime_type) ? `
        <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div class="bg-black/50 rounded-full p-2">
            <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>` : ''}
      ${asset.is_motion_photo && !isVideo(asset.mime_type) ? `
        <div class="absolute top-1 right-8 pointer-events-none" title="Motion Photo">
          <div class="bg-black/60 rounded-full p-1">
            <svg class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
            </svg>
          </div>
        </div>` : ''}
      ${isStack ? `
        <div class="absolute top-1 left-1 pointer-events-none">
          <span class="bg-black/70 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">${asset.stack_size}</span>
        </div>` : ''}
      <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none"></div>
      <button class="fav-heart${asset.is_favorite ? ' is-fav' : ''}" title="${asset.is_favorite ? 'Ta bort favorit' : 'Lägg till favorit'}">
        ${HEART_SVG}
      </button>
      ${colorBorderHtml}
      ${flagBadgeHtml}
      ${ratingHtml}
    </div>
    ${infoStripHtml}`;

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

  const close = () => { _activeSubmenu?.remove(); menu.remove(); };

  // Helper för menyknapp
  const item = (icon, label, cls = '', hasSubmenu = false) => {
    const btn = document.createElement('button');
    btn.className = `w-full text-left px-4 py-2 flex items-center gap-2.5 hover:bg-slate-700 transition-colors ${cls || 'text-slate-200'}`;
    btn.innerHTML = `<span class="text-base leading-none">${icon}</span><span class="flex-1">${label}</span>${hasSubmenu ? '<span class="text-slate-500 text-xs">▶</span>' : ''}`;
    return btn;
  };

  // Helper för flyout-submeny: öppnar en submeny till höger om triggerknappen
  let _activeSubmenu = null;
  const openSubmenu = (triggerBtn, buildFn) => {
    _activeSubmenu?.remove();
    const sub = document.createElement('div');
    sub.className = 'asset-ctx-menu fixed z-[9600] bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-1 min-w-[160px] text-sm';
    buildFn(sub);
    document.body.appendChild(sub);
    _activeSubmenu = sub;

    const trigRect = triggerBtn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const subW = 200;
    // Placera submeny till höger om huvudmenyn, eller till vänster om plats saknas
    const leftCandidate = menuRect.right + 4;
    const left = leftCandidate + subW > window.innerWidth ? menuRect.left - subW - 4 : leftCandidate;
    const top = Math.min(trigRect.top, window.innerHeight - sub.offsetHeight - 8);
    sub.style.left = `${Math.max(4, left)}px`;
    sub.style.top  = `${Math.max(4, top)}px`;

    // Justera topp efter att DOM renderat
    requestAnimationFrame(() => {
      const h = sub.offsetHeight;
      const t = Math.min(trigRect.top, window.innerHeight - h - 8);
      sub.style.top = `${Math.max(4, t)}px`;
    });
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

    // ── Stjärnbetyg — flyout ──
    const ratingBtn = item('⭐', 'Sätt betyg', '', true);
    ratingBtn.addEventListener('click', () => {
      openSubmenu(ratingBtn, (sub) => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-1 px-3 py-2';
        for (let i = 1; i <= 5; i++) {
          const s = document.createElement('button');
          s.className = 'text-xl hover:scale-125 transition-transform';
          s.textContent = i <= (asset.rating ?? 0) ? '★' : '☆';
          s.style.color = '#facc15';
          s.title = `${i} stjärna${i > 1 ? 'r' : ''}`;
          s.addEventListener('click', async () => {
            sub.remove(); _activeSubmenu = null;
            await api.patchMeta(asset.id, { rating: i }).catch(() => {});
            asset.rating = i;
            _refreshCellOverlay(asset);
          });
          row.appendChild(s);
        }
        sub.appendChild(row);
        if (asset.rating) {
          const clr = document.createElement('button');
          clr.className = 'w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-slate-700 transition-colors';
          clr.textContent = 'Ta bort betyg';
          clr.addEventListener('click', async () => {
            sub.remove(); _activeSubmenu = null;
            await api.patchMeta(asset.id, { rating: null }).catch(() => {});
            asset.rating = null;
            _refreshCellOverlay(asset);
          });
          sub.appendChild(clr);
        }
      });
    });

    // ── Flagga — flyout ──
    const flagIconHtml = asset.flag
      ? `<span style="color:${COLOR_VALUES[asset.flag] ?? '#aaa'};display:inline-flex;align-items:center;">${FLAG_SVG}</span>`
      : '🏳';
    const flagBtn = item(flagIconHtml, asset.flag ? 'Ändra flagga' : 'Flagga', '', true);
    flagBtn.addEventListener('click', async () => {
      const { getThumbSettings } = await import('./thumbSettings.js');
      const ts = await getThumbSettings().catch(() => null);
      openSubmenu(flagBtn, (sub) => {
        // Ingen flagga
        const noneBtn = document.createElement('button');
        noneBtn.className = `w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-slate-700 text-sm text-slate-400 transition-colors${asset.flag === 0 ? ' bg-slate-700' : ''}`;
        noneBtn.innerHTML = '<span class="w-4 text-center">—</span><span>Ingen flagga</span>';
        noneBtn.addEventListener('click', async () => {
          sub.remove(); _activeSubmenu = null;
          await api.patchMeta(asset.id, { flag: 0 }).catch(() => {});
          asset.flag = 0; _refreshCellOverlay(asset);
        });
        sub.appendChild(noneBtn);
        Object.entries(COLOR_VALUES).forEach(([idx, color]) => {
          const flagNum = Number(idx);
          const name = ts?.colorLabels?.[idx] ?? `Flagga ${idx}`;
          const fb = document.createElement('button');
          fb.className = `w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-slate-700 text-sm text-slate-200 transition-colors${asset.flag === flagNum ? ' bg-slate-700' : ''}`;
          fb.innerHTML = `<span style="color:${color};display:flex;align-items:center;width:16px;">${FLAG_SVG}</span><span>${_esc(name)}</span>`;
          fb.addEventListener('click', async () => {
            sub.remove(); _activeSubmenu = null;
            await api.patchMeta(asset.id, { flag: flagNum }).catch(() => {});
            asset.flag = flagNum; _refreshCellOverlay(asset);
          });
          sub.appendChild(fb);
        });
      });
    });

    // ── Färgetikett — flyout ──
    const colorDot = asset.color_label
      ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${COLOR_VALUES[asset.color_label] ?? '#888'}"></span>`
      : '🎨';
    const colorBtn = item(colorDot, 'Sätt färg', '', true);
    colorBtn.addEventListener('click', () => {
      openSubmenu(colorBtn, (sub) => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-2 px-3 py-2';
        // Ingen färg
        const noBtn = document.createElement('button');
        noBtn.className = `w-6 h-6 rounded-full border-2 ${asset.color_label === 0 ? 'border-white' : 'border-slate-600'} bg-slate-700 hover:border-white transition-colors`;
        noBtn.title = 'Ingen färg';
        noBtn.addEventListener('click', async () => {
          sub.remove(); _activeSubmenu = null;
          await api.patchMeta(asset.id, { colorLabel: 0 }).catch(() => {});
          asset.color_label = 0; _refreshCellOverlay(asset);
        });
        row.appendChild(noBtn);
        Object.entries(COLOR_VALUES).forEach(([idx, color]) => {
          const cl = Number(idx);
          const cb2 = document.createElement('button');
          cb2.className = `w-6 h-6 rounded-full border-2 ${asset.color_label === cl ? 'border-white' : 'border-transparent'} hover:border-white transition-colors`;
          cb2.style.background = color;
          cb2.title = `Färg ${idx}`;
          cb2.addEventListener('click', async () => {
            sub.remove(); _activeSubmenu = null;
            await api.patchMeta(asset.id, { colorLabel: cl }).catch(() => {});
            asset.color_label = cl; _refreshCellOverlay(asset);
          });
          row.appendChild(cb2);
        });
        sub.appendChild(row);
      });
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

    menu.append(openBtn, favBtn, albumBtn, ratingBtn, flagBtn, colorBtn, shareBtn, editBtn, sep());
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
    const inMenu = menu.contains(ev.target);
    const inSub  = _activeSubmenu?.contains(ev.target);
    if (!inMenu && !inSub) {
      close();
      document.removeEventListener('mousedown', onOutsideClick);
      document.removeEventListener('keydown', onKey);
    } else if (!inSub && _activeSubmenu) {
      _activeSubmenu.remove(); _activeSubmenu = null;
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
        _refreshCellOverlay(asset);
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
      _refreshCellOverlay(asset);
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

// ── Flagg-submeny (6 val: ingen + 5 färger från colorLabels) ─────────────────
async function openFlagMenu(asset, originalEvent) {
  document.querySelectorAll('.asset-ctx-menu').forEach((m) => m.remove());

  const { getThumbSettings } = await import('./thumbSettings.js');
  const ts = await getThumbSettings().catch(() => null);

  const menu = document.createElement('div');
  menu.className = 'asset-ctx-menu fixed z-[9500] bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-2 px-3 space-y-1';
  menu.style.left = `${Math.min(originalEvent.clientX, window.innerWidth - 210)}px`;
  menu.style.top  = `${Math.min(originalEvent.clientY + 30, window.innerHeight - 180)}px`;

  const titleEl = document.createElement('div');
  titleEl.className = 'text-xs text-slate-400 mb-1.5';
  titleEl.textContent = 'Välj flagga';
  menu.appendChild(titleEl);

  // Ingen flagga
  const noneBtn = document.createElement('button');
  noneBtn.className = `w-full text-left px-2 py-1.5 flex items-center gap-2 hover:bg-slate-700 rounded text-sm text-slate-400${asset.flag === 0 ? ' bg-slate-700' : ''}`;
  noneBtn.innerHTML = `<span class="w-4 h-4 flex items-center justify-center">—</span><span>Ingen flagga</span>`;
  noneBtn.addEventListener('click', async () => {
    menu.remove();
    await api.patchMeta(asset.id, { flag: 0 }).catch(() => {});
    asset.flag = 0;
    _refreshCellOverlay(asset);
  });
  menu.appendChild(noneBtn);

  // Färgade flaggor 1-5
  Object.entries(COLOR_VALUES).forEach(([idx, color]) => {
    const flagNum = Number(idx);
    const colorName = ts?.colorLabels?.[idx] ?? `Flagga ${idx}`;
    const btn = document.createElement('button');
    btn.className = `w-full text-left px-2 py-1.5 flex items-center gap-2 hover:bg-slate-700 rounded text-sm text-slate-200${asset.flag === flagNum ? ' bg-slate-700' : ''}`;
    btn.innerHTML = `<span style="color:${color};width:16px;height:16px;display:flex;align-items:center;">${FLAG_SVG}</span><span>${colorName}</span>`;
    btn.addEventListener('click', async () => {
      menu.remove();
      await api.patchMeta(asset.id, { flag: flagNum }).catch(() => {});
      asset.flag = flagNum;
      _refreshCellOverlay(asset);
    });
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('mousedown', (ev) => {
    if (!menu.contains(ev.target)) menu.remove();
  }, { once: true }), 0);
}

// ── Färg-submeny ──────────────────────────────────────────────────────────────
function openColorMenu(asset, originalEvent) {
  document.querySelectorAll('.asset-ctx-menu').forEach((m) => m.remove());

  const menu = document.createElement('div');
  menu.className = 'asset-ctx-menu fixed z-[9500] bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-2 px-3';
  menu.style.left = `${Math.min(originalEvent.clientX, window.innerWidth - 200)}px`;
  menu.style.top  = `${Math.min(originalEvent.clientY + 30, window.innerHeight - 100)}px`;

  const label = document.createElement('div');
  label.className = 'text-xs text-slate-400 mb-2';
  label.textContent = 'Välj färgetikett';
  menu.appendChild(label);

  const row = document.createElement('div');
  row.className = 'flex gap-2 items-center';

  // Ingen färg
  const noBtn = document.createElement('button');
  noBtn.className = `w-6 h-6 rounded-full border-2 ${asset.color_label === 0 ? 'border-white' : 'border-slate-600'} bg-slate-700 hover:border-white transition-colors`;
  noBtn.title = 'Ingen färg';
  noBtn.addEventListener('click', async () => {
    menu.remove();
    await api.patchMeta(asset.id, { colorLabel: 0 }).catch(() => {});
    asset.color_label = 0;
    _refreshCellOverlay(asset);
  });
  row.appendChild(noBtn);

  Object.entries(COLOR_VALUES).forEach(([idx, color]) => {
    const btn = document.createElement('button');
    btn.className = `w-6 h-6 rounded-full border-2 ${asset.color_label === Number(idx) ? 'border-white' : 'border-transparent'} hover:border-white transition-colors`;
    btn.style.background = color;
    btn.title = `Färg ${idx}`;
    btn.addEventListener('click', async () => {
      menu.remove();
      const cl = Number(idx);
      await api.patchMeta(asset.id, { colorLabel: cl }).catch(() => {});
      asset.color_label = cl;
      _refreshCellOverlay(asset);
    });
    row.appendChild(btn);
  });

  menu.appendChild(row);
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('mousedown', (ev) => {
    if (!menu.contains(ev.target)) menu.remove();
  }, { once: true }), 0);
}

// Uppdatera color-border-ring, flag-badge och rating-badge på en cell efter ändring
export function refreshCellOverlay(asset) { return _refreshCellOverlay(asset); }
function _refreshCellOverlay(asset) {
  const cell = /** @type {HTMLElement|null} */ (document.querySelector(`.photo-cell[data-id="${asset.id}"]`));
  if (!cell) return;
  const wrap = cell.querySelector('.photo-img-wrap') ?? cell;

  // Färgborder
  const ring = /** @type {HTMLElement|null} */ (wrap.querySelector('.color-border-ring'));
  const colorVal = asset.color_label ? COLOR_VALUES[asset.color_label] ?? null : null;
  if (ring) {
    ring.style.boxShadow = colorVal ? `inset 0 0 0 4px ${colorVal}` : 'none';
  } else if (colorVal) {
    const d = document.createElement('div');
    d.className = 'color-border-ring absolute inset-0 z-10 pointer-events-none';
    d.style.boxShadow = `inset 0 0 0 4px ${colorVal}`;
    wrap.appendChild(d);
  }

  // Flagg-badge (bottom-left på bilden) — pill med ikon och namn
  const existingFlag = /** @type {HTMLElement|null} */ (wrap.querySelector('.flag-badge'));
  const flagColor = asset.flag ? COLOR_VALUES[asset.flag] ?? null : null;
  if (flagColor) {
    if (existingFlag) {
      existingFlag.style.color = flagColor;
      existingFlag.style.display = '';
      const span = existingFlag.querySelector('span');
      if (span) { span.style.color = flagColor; }
    } else {
      const d = document.createElement('div');
      d.className = 'flag-badge absolute bottom-1.5 left-1.5 z-20 pointer-events-none flex items-center rounded-full p-1';
      d.style.cssText = `background:rgba(0,0,0,0.65);color:${flagColor}`;
      d.innerHTML = FLAG_SVG;
      wrap.appendChild(d);
    }
  } else if (existingFlag) {
    existingFlag.style.display = 'none';
  }

  // Rating-badge (bottom-right på bilden) — gula stjärnor med mörk bakgrund
  const existingRating = /** @type {HTMLElement|null} */ (wrap.querySelector('.rating-badge'));
  if (asset.rating) {
    const stars = '★'.repeat(asset.rating);
    if (existingRating) {
      existingRating.textContent = stars;
      existingRating.style.display = '';
    } else {
      const d = document.createElement('div');
      d.className = 'rating-badge absolute bottom-1.5 right-1.5 z-20 pointer-events-none flex items-center rounded-full px-1.5 py-0.5';
      d.style.cssText = 'background:rgba(0,0,0,0.65);font-size:11px;line-height:1;color:#facc15;letter-spacing:-1px';
      d.textContent = stars;
      wrap.appendChild(d);
    }
  } else if (existingRating) {
    existingRating.style.display = 'none';
  }
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
