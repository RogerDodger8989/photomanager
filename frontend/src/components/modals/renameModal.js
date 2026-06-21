import { api } from '../../api.js';
import { toast } from '../../utils.js';

/**
 * Öppnar modal för namnbyte. Stöder mönstermaskning vid flera assets.
 *
 * Mönster:
 *   ## (valfritt antal) → nollpaddat räknare
 *   {YYYY} {MM} {DD} {HH} {mm} → datum från taken_at
 *   {NAME} → ursprungligt filnamsstam
 *
 * @param {object[]} assets
 * @param {function} [onDone]
 */
export function openRenameModal(assets, onDone) {
  document.getElementById('rename-modal')?.remove();

  const isBatch = assets.length > 1;
  const ext = (name) => {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i) : '';
  };
  const stem = (name) => {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(0, i) : name;
  };

  function applyPattern(pattern, asset, counter) {
    if (!isBatch) return pattern;

    // Räknare: räkna # i rad → padda
    let result = pattern.replace(/#+/g, (match) => {
      return String(counter).padStart(match.length, '0');
    });

    // Datum-substitutioner
    const d = asset.taken_at ? new Date(asset.taken_at) : null;
    if (d) {
      const pad = (n) => String(n).padStart(2, '0');
      result = result
        .replace(/\{YYYY\}/g, d.getFullYear())
        .replace(/\{MM\}/g,   pad(d.getMonth() + 1))
        .replace(/\{DD\}/g,   pad(d.getDate()))
        .replace(/\{HH\}/g,   pad(d.getHours()))
        .replace(/\{mm\}/g,   pad(d.getMinutes()));
    }

    result = result.replace(/\{NAME\}/g, stem(asset.file_name ?? ''));
    return result;
  }

  const modal = document.createElement('div');
  modal.id = 'rename-modal';
  modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" id="rn-backdrop"></div>
    <div class="relative bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

      <div class="flex items-center justify-between px-5 py-4 border-b border-slate-700 shrink-0">
        <h2 class="text-sm font-semibold text-white">
          ${isBatch ? `Ändra namn på ${assets.length} bilder` : 'Ändra namn'}
        </h2>
        <button id="rn-close" class="text-slate-400 hover:text-white p-1 rounded">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        ${isBatch ? `
        <div class="bg-slate-700/40 rounded-lg p-3 text-xs text-slate-400 space-y-2">
          <p class="font-medium text-slate-300">Klicka på en kod för att lägga till den:</p>
          <div class="flex flex-wrap gap-1.5" id="rn-chips">
            <button class="rn-chip" data-code="##">##</button>
            <button class="rn-chip" data-code="{YYYY}">{YYYY}</button>
            <button class="rn-chip" data-code="{MM}">{MM}</button>
            <button class="rn-chip" data-code="{DD}">{DD}</button>
            <button class="rn-chip" data-code="{HH}">{HH}</button>
            <button class="rn-chip" data-code="{mm}">{mm}</button>
            <button class="rn-chip" data-code="{NAME}">{NAME}</button>
          </div>
          <div class="text-slate-500 leading-relaxed pt-0.5">
            <span class="text-slate-400">##</span> räknare (01, 02…) &nbsp;·&nbsp;
            <span class="text-slate-400">{YYYY}/{MM}/{DD}</span> datum &nbsp;·&nbsp;
            <span class="text-slate-400">{HH}/{mm}</span> tid &nbsp;·&nbsp;
            <span class="text-slate-400">{NAME}</span> originalnamn
          </div>
        </div>
        <div class="flex gap-3 items-end">
          <div class="flex-1">
            <label class="block text-xs font-medium text-slate-400 mb-1.5">Mönster</label>
            <input id="rn-pattern" type="text" placeholder="t.ex. Löderup_##" value=""
              class="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                     placeholder-slate-500 focus:outline-none focus:border-blue-500"/>
          </div>
          <div class="w-20">
            <label class="block text-xs font-medium text-slate-400 mb-1.5">Startvärde</label>
            <input id="rn-start" type="number" value="1" min="0"
              class="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                     focus:outline-none focus:border-blue-500"/>
          </div>
        </div>
        <div>
          <p class="text-xs font-medium text-slate-400 mb-2">Förhandsgranskning</p>
          <div id="rn-preview" class="max-h-52 overflow-y-auto space-y-1 bg-slate-900/50 rounded-lg p-2"></div>
        </div>
        ` : `
        <div>
          <label class="block text-xs font-medium text-slate-400 mb-1.5">Nytt namn (utan extension)</label>
          <input id="rn-single" type="text" value="${stem(assets[0]?.file_name ?? '')}"
            class="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                   focus:outline-none focus:border-blue-500"/>
          <p class="text-xs text-slate-500 mt-1">Extension: <span class="text-slate-300">${ext(assets[0]?.file_name ?? '')}</span></p>
        </div>
        `}
      </div>

      <div id="rn-progress" class="hidden px-5 py-2 text-xs text-slate-400 border-t border-slate-700 shrink-0"></div>

      <div class="flex justify-end gap-2 px-5 py-4 border-t border-slate-700 shrink-0">
        <button id="rn-cancel" class="px-4 py-2 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">
          Avbryt
        </button>
        <button id="rn-save" class="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors">
          Byt namn
        </button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  function close() { modal.remove(); }

  document.getElementById('rn-close').addEventListener('click', close);
  document.getElementById('rn-cancel').addEventListener('click', close);
  document.getElementById('rn-backdrop').addEventListener('click', close);
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });

  // ── Chip-knappar: klicka för att lägga till kod i mönsterfältet ─────────
  if (isBatch) {
    modal.querySelectorAll('.rn-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const input = /** @type {HTMLInputElement} */ (document.getElementById('rn-pattern'));
        if (!input) return;
        const code  = chip.dataset.code ?? '';
        const pos   = input.selectionStart ?? input.value.length;
        input.value = input.value.slice(0, pos) + code + input.value.slice(pos);
        input.focus();
        input.selectionStart = input.selectionEnd = pos + code.length;
        input.dispatchEvent(new Event('input'));
      });
    });
  }

  // ── Förhandsgranskning (batch) ────────────────────────────────────────────
  if (isBatch) {
    const patternInput = document.getElementById('rn-pattern');
    const startInput   = document.getElementById('rn-start');
    const previewEl    = document.getElementById('rn-preview');

    function updatePreview() {
      const pattern = patternInput.value;
      const start   = parseInt(startInput.value, 10) || 1;
      previewEl.innerHTML = '';
      assets.forEach((asset, i) => {
        const newStem = applyPattern(pattern, asset, start + i);
        const newName = newStem + ext(asset.file_name ?? '');
        const row = document.createElement('div');
        row.className = 'text-xs py-0.5 flex gap-2';
        row.innerHTML = `
          <span class="text-slate-500 truncate max-w-[45%]">${asset.file_name}</span>
          <span class="text-slate-600">→</span>
          <span class="text-white truncate">${newName || '(tomt)'}</span>`;
        previewEl.appendChild(row);
      });
    }

    patternInput.addEventListener('input', updatePreview);
    startInput.addEventListener('input', updatePreview);
    updatePreview();
  }

  // ── Spara ─────────────────────────────────────────────────────────────────
  document.getElementById('rn-save').addEventListener('click', async () => {
    const saveBtn   = document.getElementById('rn-save');
    const progressEl = document.getElementById('rn-progress');
    if (!saveBtn) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Byter namn…';

    let renames;
    if (isBatch) {
      const pattern = /** @type {HTMLInputElement} */ (document.getElementById('rn-pattern')).value.trim();
      const start   = parseInt(/** @type {HTMLInputElement} */ (document.getElementById('rn-start')).value, 10) || 1;
      if (!pattern) {
        toast('Ange ett mönster', 'warn');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Byt namn';
        return;
      }
      renames = assets.map((a, i) => ({
        assetId: a.id,
        newName: applyPattern(pattern, a, start + i) + ext(a.file_name ?? ''),
      }));
    } else {
      const val = /** @type {HTMLInputElement} */ (document.getElementById('rn-single'))?.value.trim();
      if (!val) {
        toast('Ange ett namn', 'warn');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Byt namn';
        return;
      }
      const extension = ext(assets[0].file_name ?? '');
      renames = [{ assetId: assets[0].id, newName: val + extension }];
    }

    // Skicka sekventiellt för att undvika kollisioner
    let done = 0;
    let errors = 0;
    if (progressEl) progressEl.classList.remove('hidden');

    for (const r of renames) {
      try {
        if (progressEl) progressEl.textContent = `Byter namn ${done + 1}/${renames.length}…`;
        await api.post('/api/files/rename-asset', r);
        done++;
      } catch (err) {
        errors++;
      }
    }

    if (progressEl) progressEl.classList.add('hidden');

    if (errors) {
      toast(`${done} namnbytta, ${errors} misslyckades`, 'warn');
    } else {
      toast(`${done} bild${done > 1 ? 'er' : ''} omdöpt${done > 1 ? 'a' : ''}`, 'success');
    }

    close();
    onDone?.();
  });
}
