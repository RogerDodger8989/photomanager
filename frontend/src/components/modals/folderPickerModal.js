import { api } from '../../api.js';
import { toast } from '../../utils.js';

/**
 * Öppnar en mappväljare för kopiera eller flytta.
 *
 * @param {{ mode: 'copy'|'move', assets: object[], onDone?: function }} opts
 */
export function openFolderPickerModal({ mode, assets, onDone }) {
  document.getElementById('folder-picker-modal')?.remove();

  const isCopy = mode === 'copy';
  const title  = isCopy ? `Kopiera ${assets.length} bild${assets.length > 1 ? 'er' : ''}` : `Flytta ${assets.length} bild${assets.length > 1 ? 'er' : ''}`;

  const modal = document.createElement('div');
  modal.id = 'folder-picker-modal';
  modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" id="fp-backdrop"></div>
    <div class="relative bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col">

      <div class="flex items-center justify-between px-5 py-4 border-b border-slate-700 shrink-0">
        <h2 class="text-sm font-semibold text-white">${title}</h2>
        <button id="fp-close" class="text-slate-400 hover:text-white p-1 rounded">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <div class="px-5 py-2 border-b border-slate-700 shrink-0">
        <p class="text-xs text-slate-400">Välj målmapp:</p>
        <div id="fp-selected-path" class="text-xs text-blue-300 mt-1 min-h-[1rem]">—</div>
      </div>

      <div id="fp-tree" class="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        <p class="text-xs text-slate-500">Laddar mappar…</p>
      </div>

      <div class="flex justify-between items-center gap-2 px-5 py-4 border-t border-slate-700 shrink-0">
        <button id="fp-new-folder" class="text-xs text-slate-400 hover:text-white underline">
          + Ny mapp
        </button>
        <div class="flex gap-2">
          <button id="fp-cancel" class="px-4 py-2 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">
            Avbryt
          </button>
          <button id="fp-ok" disabled class="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg transition-colors">
            ${isCopy ? 'Kopiera' : 'Flytta'}
          </button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(modal);

  let selectedFolder = null;

  function close() { modal.remove(); }

  document.getElementById('fp-close').addEventListener('click', close);
  document.getElementById('fp-cancel').addEventListener('click', close);
  document.getElementById('fp-backdrop').addEventListener('click', close);
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });

  // ── Ladda mappträd ────────────────────────────────────────────────────────
  async function loadTree() {
    try {
      const { data } = await api.folderTree();
      const treeEl = document.getElementById('fp-tree');
      if (!treeEl) return;
      treeEl.innerHTML = '';

      if (!data?.length) {
        treeEl.innerHTML = '<p class="text-xs text-slate-500">Inga bevakade mappar hittades.</p>';
        return;
      }

      function renderFolder(folder, depth = 0) {
        const item = document.createElement('button');
        item.className = `w-full text-left text-sm px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2
          hover:bg-slate-700 text-slate-200`;
        item.style.paddingLeft = `${12 + depth * 16}px`;
        item.innerHTML = `<span class="text-slate-500">📁</span> <span class="truncate">${folder.label || folder.relPath || folder.path}</span>`;
        item.addEventListener('click', () => {
          // Avmarkera föregående
          treeEl.querySelectorAll('.fp-selected').forEach((el) => {
            el.classList.remove('fp-selected', 'bg-blue-700/40', 'text-blue-200');
          });
          item.classList.add('fp-selected', 'bg-blue-700/40', 'text-blue-200');
          selectedFolder = folder.path;
          const pathEl = document.getElementById('fp-selected-path');
          if (pathEl) pathEl.textContent = folder.label || folder.relPath || folder.path;
          const okBtn = document.getElementById('fp-ok');
          if (okBtn) okBtn.disabled = false;
        });
        treeEl.appendChild(item);

        // Undermappar
        if (folder.children?.length) {
          folder.children.forEach((child) => renderFolder(child, depth + 1));
        }
      }

      data.forEach((f) => renderFolder(f, 0));
    } catch (err) {
      const treeEl = document.getElementById('fp-tree');
      if (treeEl) treeEl.innerHTML = `<p class="text-xs text-red-400">Kunde inte ladda mappar: ${err.message}</p>`;
    }
  }

  loadTree();

  // ── Ny mapp ───────────────────────────────────────────────────────────────
  document.getElementById('fp-new-folder').addEventListener('click', async () => {
    const name = prompt('Namn på ny mapp:');
    if (!name) return;
    const parentFolder = selectedFolder;
    if (!parentFolder) { toast('Välj en mapp att skapa undermappen i', 'warn'); return; }
    try {
      await api.createFolder({ parentPath: parentFolder, name });
      toast('Mapp skapad', 'success');
      await loadTree();
    } catch (err) {
      toast('Kunde inte skapa mapp: ' + err.message, 'error');
    }
  });

  // ── OK ────────────────────────────────────────────────────────────────────
  document.getElementById('fp-ok').addEventListener('click', async () => {
    if (!selectedFolder) return;
    const okBtn = document.getElementById('fp-ok');
    if (okBtn) { okBtn.disabled = true; okBtn.textContent = isCopy ? 'Kopierar…' : 'Flyttar…'; }

    const assetIds = assets.map((a) => a.id);

    try {
      if (isCopy) {
        await api.post('/api/files/copy', { assetIds, targetFolder: selectedFolder });
        toast(`${assetIds.length} bild${assetIds.length > 1 ? 'er' : ''} kopierade`, 'success');
      } else {
        await api.moveFiles({ assetIds, targetFolder: selectedFolder });
        toast(`${assetIds.length} bild${assetIds.length > 1 ? 'er' : ''} flyttade`, 'success');
      }
      close();
      onDone?.();
    } catch (err) {
      toast((isCopy ? 'Kopiering' : 'Flytt') + ' misslyckades: ' + err.message, 'error');
      if (okBtn) { okBtn.disabled = false; okBtn.textContent = isCopy ? 'Kopiera' : 'Flytta'; }
    }
  });
}
