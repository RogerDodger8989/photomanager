import { api } from '../../api.js';
import { toast } from '../../utils.js';
import { buildPhotoCell } from '../gridCell.js';
import { openLightbox } from '../lightbox.js';
import { getThumbSettings } from '../thumbSettings.js';

/**
 * Skapar en ny stack av givna assets.
 * Anropar onStackCreated(stackId, coverAssetId, memberIds) för direkt DOM-uppdatering,
 * eller onRefresh() som fallback.
 */
export async function createStack(assets, { onRefresh, onStackCreated } = {}) {
  if (assets.length < 2) {
    toast('Välj minst 2 bilder för att skapa en stack', 'warn');
    return;
  }
  try {
    const assetIds = assets.map((a) => a.id);
    const coverId  = assets[0].id;
    const { data } = await api.createStack({ assetIds, coverId });
    toast(`Stack skapad med ${assets.length} bilder`, 'success');

    if (onStackCreated) {
      onStackCreated(data.stackId, data.coverAssetId, assetIds);
    } else {
      onRefresh?.();
    }
  } catch (err) {
    toast('Kunde inte skapa stack: ' + (err.message ?? ''), 'error');
  }
}

/**
 * Tar bort ett enskilt asset från sin stack.
 * Anropar onRemoved(assetId, responseData) eller onRefresh() som fallback.
 */
export async function removeFromStack(asset, { onRefresh, onRemoved } = {}) {
  if (!asset.stack_id) return;
  try {
    const { data } = await api.removeFromStack(asset.stack_id, asset.id);
    toast('Bilden togs bort från stacken', 'success');

    if (onRemoved) {
      onRemoved(asset.id, data);
    } else {
      onRefresh?.();
    }
  } catch (err) {
    toast('Kunde inte ta bort från stack: ' + (err.message ?? ''), 'error');
  }
}

/**
 * Expanderar en stack inline i griden (Lightroom-stil).
 * Hämtar members via API och injicerar celler direkt efter cover-cellen.
 */
export async function expandStack(asset, { grid, allItems, thumbSettings, expandedStacks, onCellBuilt = null }) {
  if (!asset.stack_id || expandedStacks.has(asset.stack_id)) return;

  try {
    const { data } = await api.getStack(asset.stack_id);
    const { stack, members } = data;

    const coverCell = grid.querySelector(`[data-id="${stack.cover_asset_id}"]`);
    if (!coverCell) return;

    coverCell.classList.add('stack-cover-expanded');
    expandedStacks.add(asset.stack_id);

    // Ändra cover-badge till "▾ N" med violett bakgrund
    _setBadgeExpanded(coverCell, members.length, true);

    const ts = thumbSettings ?? await getThumbSettings().catch(() => null);
    let insertAfter = coverCell;
    let memberIdx = 1;

    members.forEach((member) => {
      if (member.id === stack.cover_asset_id) return;

      // Rensa stack_id/stack_size så att member-cellen inte visar sin egna badge
      const memberData = { ...member, stack_id: null, stack_size: null };

      const memberCell = buildPhotoCell(
        memberData,
        () => openLightbox(members, members.findIndex((m) => m.id === member.id)),
        undefined,
        ts,
      );
      memberCell.dataset.id       = member.id;  // behåll originalets id för selektion
      memberCell.dataset.stackMember = asset.stack_id;
      memberCell.classList.add('stack-member-cell');

      // Lägg till liten "↳ N/M" indikator under selectionens plats (top-7 left-0)
      const wrap = memberCell.querySelector('.photo-img-wrap');
      if (wrap) {
        const ind = document.createElement('div');
        ind.className = 'absolute top-1 left-1 z-10 pointer-events-none';
        ind.innerHTML = `<span class="bg-violet-700/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none">↳ ${memberIdx + 1}/${members.length}</span>`;
        wrap.appendChild(ind);
      }
      memberIdx++;

      insertAfter.insertAdjacentElement('afterend', memberCell);
      insertAfter = memberCell;

      // Koppla selektionshanterare om callback finns
      onCellBuilt?.(memberCell, member);
    });
  } catch (err) {
    toast('Kunde inte expandera stacken', 'error');
    console.error(err);
  }
}

/**
 * Minimerar en expanderad stack — tar bort injicerade member-celler.
 */
export function collapseStack(asset, { grid, expandedStacks }) {
  if (!asset.stack_id) return;
  const stackId = asset.stack_id;

  grid.querySelectorAll(`[data-stack-member="${stackId}"]`).forEach((el) => el.remove());

  // Återställ cover-badge och ta bort expanded-klassen
  grid.querySelectorAll(`[data-stack-id="${stackId}"]`).forEach((c) => {
    c.classList.remove('stack-cover-expanded');
    _setBadgeExpanded(c, null, false);
  });
  expandedStacks.delete(stackId);
}

/**
 * Öppnar stack-hanteringsmodal med rutnät av alla members.
 * Stöder: sätt omslag, ta bort member, lös upp stack, omordning via D&D.
 */
export async function openStackModal(asset, {
  onMemberRemoved = null,
  onDissolve = null,
  onCoverChanged = null,
} = {}) {
  if (!asset.stack_id) return;

  let stackData;
  try {
    const { data } = await api.getStack(asset.stack_id);
    stackData = data;
  } catch {
    toast('Kunde inte hämta stack', 'error');
    return;
  }

  let { stack, members } = stackData;
  let dragSrc = null;

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[9800] flex items-center justify-center bg-black/70 p-4';
  document.body.appendChild(overlay);

  const closeModal = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  const render = () => {
    overlay.innerHTML = `
      <div class="bg-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl border border-slate-700 flex flex-col max-h-[85vh]">
        <div class="flex items-center justify-between px-5 py-4 border-b border-slate-700 shrink-0">
          <div>
            <h2 class="text-base font-semibold text-white">🗂️ Hantera stack</h2>
            <p class="text-xs text-slate-400 mt-0.5">${members.length} bilder · Dra för att ändra ordning</p>
          </div>
          <button id="sm-close" class="text-slate-400 hover:text-white transition-colors text-xl leading-none px-2">✕</button>
        </div>
        <div id="sm-grid" class="p-4 grid gap-2 overflow-y-auto flex-1"
             style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">
          ${members.map((m) => `
            <div class="sm-card group relative rounded-lg overflow-hidden bg-slate-700 cursor-move select-none"
                 data-id="${m.id}" draggable="true">
              <div class="aspect-square overflow-hidden">
                <img src="${m.thumb_small_path ? `/thumbs/${m.thumb_small_path}` : '/icons/placeholder.svg'}"
                     loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform">
              </div>
              ${m.id === stack.cover_asset_id ? `<div class="absolute top-1 left-1 bg-violet-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full pointer-events-none">OMSLAG</div>` : ''}
              <div class="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-end justify-center opacity-0 group-hover:opacity-100 gap-1 pb-2 px-1">
                ${m.id !== stack.cover_asset_id ? `<button class="sm-set-cover bg-violet-700 hover:bg-violet-500 text-white text-[10px] px-2 py-1 rounded transition-colors" data-id="${m.id}">⭐ Omslag</button>` : ''}
                <button class="sm-remove bg-red-800 hover:bg-red-600 text-white text-[10px] px-2 py-1 rounded transition-colors" data-id="${m.id}">✕ Ta bort</button>
              </div>
              <div class="absolute bottom-0 left-0 right-0 bg-black/70 px-1.5 py-0.5 pointer-events-none">
                <div class="text-[9px] text-slate-300 truncate">${(m.file_name ?? '').replace(/^.*[\\/]/, '')}</div>
              </div>
            </div>`).join('')}
        </div>
        <div class="px-5 py-4 border-t border-slate-700 flex items-center justify-between shrink-0">
          <button id="sm-dissolve" class="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 rounded hover:bg-slate-700 transition-colors">
            💥 Lös upp stack
          </button>
          <button id="sm-done" class="px-4 py-2 rounded-lg text-sm bg-slate-700 hover:bg-slate-600 text-white transition-colors">Klar</button>
        </div>
      </div>`;

    overlay.querySelector('#sm-close')?.addEventListener('click', closeModal);
    overlay.querySelector('#sm-done')?.addEventListener('click', closeModal);

    overlay.querySelectorAll('.sm-set-cover').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = /** @type {HTMLElement} */ (btn).dataset.id;
        try {
          await api.setStackCover(stack.id, { coverId: id });
          stack.cover_asset_id = id;
          onCoverChanged?.(id);
          render();
        } catch { toast('Kunde inte ändra omslag', 'error'); }
      });
    });

    overlay.querySelectorAll('.sm-remove').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = /** @type {HTMLElement} */ (btn).dataset.id;
        if (!confirm('Ta bort bilden från stacken?')) return;
        try {
          const { data: res } = await api.removeFromStack(stack.id, id);
          members = members.filter((m) => m.id !== id);
          onMemberRemoved?.(id, res);
          if (res?.stackDeleted || members.length < 2) {
            closeModal();
            onDissolve?.();
            return;
          }
          if (stack.cover_asset_id === id) stack.cover_asset_id = members[0]?.id;
          render();
        } catch { toast('Kunde inte ta bort bild', 'error'); }
      });
    });

    overlay.querySelector('#sm-dissolve')?.addEventListener('click', async () => {
      if (!confirm('Lös upp stacken? Bilderna förblir kvar men staplas inte längre.')) return;
      try {
        await api.dissolveStack(stack.id);
        closeModal();
        onDissolve?.();
      } catch { toast('Kunde inte lösa upp stack', 'error'); }
    });

    // D&D omordning inuti modal
    const smGrid = overlay.querySelector('#sm-grid');
    smGrid?.querySelectorAll('.sm-card').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        dragSrc = card;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.dataset.id);
        setTimeout(() => card.classList.add('opacity-40'), 0);
      });
      card.addEventListener('dragend', () => card.classList.remove('opacity-40'));
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (dragSrc !== card) card.classList.add('outline', 'outline-2', 'outline-violet-500');
      });
      card.addEventListener('dragleave', () => card.classList.remove('outline', 'outline-2', 'outline-violet-500'));
      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        card.classList.remove('outline', 'outline-2', 'outline-violet-500');
        if (!dragSrc || dragSrc === card) return;

        const srcId = dragSrc.dataset.id;
        const dstId = card.dataset.id;
        const si = members.findIndex((m) => m.id === srcId);
        const di = members.findIndex((m) => m.id === dstId);
        if (si === -1 || di === -1) return;

        const [moved] = members.splice(si, 1);
        members.splice(di, 0, moved);

        try {
          const { data: res } = await api.reorderStack(stack.id, { order: members.map((m) => m.id) });
          if (res?.coverId) stack.cover_asset_id = res.coverId;
          onCoverChanged?.(stack.cover_asset_id);
          render();
        } catch { toast('Kunde inte ändra ordning', 'error'); }
      });
    });
  };

  render();
}

/**
 * Löser upp en hel stack direkt, uppdaterar DOM utan omladdning.
 */
export async function dissolveStackOp(asset, { grid, allItems, expandedStacks }) {
  if (!asset.stack_id) return;
  if (!confirm('Lös upp stacken? Bilderna förblir kvar men staplas inte längre.')) return;

  const stackId = asset.stack_id;

  // Ta bort expanderade member-celler
  grid.querySelectorAll(`[data-stack-member="${stackId}"]`).forEach((el) => el.remove());
  expandedStacks?.delete(stackId);

  try {
    await api.dissolveStack(stackId);
    toast('Stack upplöst', 'success');

    // Rensa stack-attribut på alla berörda assets
    allItems.forEach((a) => {
      if (a.stack_id !== stackId) return;
      a.stack_id  = null;
      a.stack_size = null;
      const c = grid.querySelector(`[data-id="${a.id}"]`);
      if (!c) return;
      c.removeAttribute('data-stack-id');
      c.querySelector('.photo-img-wrap')?.classList.remove('is-stack-wrap');
      c.querySelector('.stack-badge')?.remove();
    });
  } catch (err) {
    toast('Kunde inte lösa upp stack: ' + (err.message ?? ''), 'error');
  }
}

// ── Intern hjälp: sätt/återställ badge-utseende på cover-cell ────────────────
function _setBadgeExpanded(coverCell, totalCount, isExpanded) {
  const badge = coverCell.querySelector('.stack-badge');
  if (!badge) return;

  const iconEl    = badge.querySelector('.stack-icon');
  const innerSpan = badge.querySelector('span');

  if (isExpanded) {
    if (iconEl) iconEl.textContent = '▾';
    if (innerSpan) { innerSpan.style.background = '#7c3aed'; innerSpan.style.borderColor = '#9f7aea'; }
    badge.title = 'Klicka för att minimera stack';
  } else {
    if (iconEl) iconEl.textContent = '▸';
    if (innerSpan) { innerSpan.style.background = ''; innerSpan.style.borderColor = ''; }
    badge.title = 'Klicka för att expandera stack';
  }
}
