import { api } from '../../api.js';
import { toast, toastWithUndo } from '../../utils.js';

/**
 * Öppnar en modal för att batch-redigera metadata på flera assets.
 * Stöder: taggar (lägg till/ta bort), datum (tilldela alla), plats (tilldela alla).
 *
 * @param {object[]} assets
 */
export function openBatchMetaModal(assets) {
  document.getElementById('batch-meta-modal')?.remove();

  const count = assets.length;

  const modal = document.createElement('div');
  modal.id = 'batch-meta-modal';
  modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" id="bm-backdrop"></div>
    <div class="relative bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

      <div class="flex items-center justify-between px-5 py-4 border-b border-slate-700 shrink-0">
        <h2 class="text-sm font-semibold text-white">Batch edit — ${count} bilder</h2>
        <button id="bm-close" class="text-slate-400 hover:text-white p-1 rounded">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-5 py-4 space-y-6">

        <!-- Taggar: lägg till -->
        <div>
          <label class="block text-xs font-medium text-slate-400 mb-2">Lägg till taggar</label>
          <div id="bm-add-tags-chips" class="flex flex-wrap gap-1.5 mb-2"></div>
          <div class="relative">
            <input id="bm-add-tag-input" type="text" placeholder="Skriv taggnamn…"
              class="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                     placeholder-slate-500 focus:outline-none focus:border-blue-500"/>
            <div id="bm-add-tag-suggestions" class="absolute left-0 right-0 top-full mt-1 bg-slate-800 border border-slate-600
                 rounded-lg shadow-lg z-10 hidden max-h-40 overflow-y-auto"></div>
          </div>
        </div>

        <!-- Taggar: ta bort -->
        <div>
          <label class="block text-xs font-medium text-slate-400 mb-2">Ta bort taggar</label>
          <div id="bm-remove-tags-chips" class="flex flex-wrap gap-1.5 mb-2"></div>
          <div class="relative">
            <input id="bm-remove-tag-input" type="text" placeholder="Skriv taggnamn…"
              class="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                     placeholder-slate-500 focus:outline-none focus:border-blue-500"/>
            <div id="bm-remove-tag-suggestions" class="absolute left-0 right-0 top-full mt-1 bg-slate-800 border border-slate-600
                 rounded-lg shadow-lg z-10 hidden max-h-40 overflow-y-auto"></div>
          </div>
        </div>

        <!-- Datum -->
        <div>
          <div class="flex items-center gap-2 mb-2">
            <input id="bm-date-check" type="checkbox" class="w-4 h-4 rounded accent-blue-500">
            <label for="bm-date-check" class="text-xs font-medium text-slate-400 cursor-pointer">Ange nytt datum för alla</label>
          </div>
          <input id="bm-date-input" type="datetime-local" disabled
            class="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                   disabled:opacity-40 focus:outline-none focus:border-blue-500 [color-scheme:dark]"/>
        </div>

        <!-- Plats -->
        <div>
          <div class="flex items-center gap-2 mb-2">
            <input id="bm-loc-check" type="checkbox" class="w-4 h-4 rounded accent-blue-500">
            <label for="bm-loc-check" class="text-xs font-medium text-slate-400 cursor-pointer">Sätt plats för alla</label>
          </div>
          <div class="flex gap-2">
            <input id="bm-loc-input" type="text" placeholder="Sök stad eller adress…" disabled
              class="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                     placeholder-slate-500 disabled:opacity-40 focus:outline-none focus:border-blue-500"/>
            <button id="bm-loc-search" disabled
              class="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 text-sm rounded-lg transition-colors">
              Sök
            </button>
          </div>
          <div id="bm-loc-results" class="mt-2 space-y-1 hidden"></div>
          <div id="bm-loc-chosen" class="hidden mt-2 flex items-center gap-2 bg-green-900/30 border border-green-700/50 rounded-lg px-3 py-2">
            <svg class="w-4 h-4 text-green-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
            </svg>
            <span id="bm-loc-chosen-label" class="text-xs text-green-300 flex-1"></span>
            <button id="bm-loc-clear" class="text-slate-500 hover:text-white ml-auto">✕</button>
          </div>
        </div>

      </div>

      <!-- Footer -->
      <div class="flex justify-end gap-2 px-5 py-4 border-t border-slate-700 shrink-0">
        <button id="bm-cancel" class="px-4 py-2 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">
          Avbryt
        </button>
        <button id="bm-save" class="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors">
          Spara
        </button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  // ── Tag-chip state ────────────────────────────────────────────────────────
  const addTags    = [];
  const removeTags = [];

  function renderChips(container, arr, color) {
    container.innerHTML = '';
    arr.forEach((tag, i) => {
      const chip = document.createElement('span');
      chip.className = `inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${color}`;
      chip.innerHTML = `${tag.name} <button class="hover:text-white opacity-70 hover:opacity-100">✕</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        arr.splice(i, 1);
        renderChips(container, arr, color);
      });
      container.appendChild(chip);
    });
  }

  function setupTagInput(inputEl, suggestEl, arr, chipsEl, chipColor) {
    let timer;
    inputEl.addEventListener('input', () => {
      clearTimeout(timer);
      const q = inputEl.value.trim();
      if (!q) { suggestEl.classList.add('hidden'); return; }
      timer = setTimeout(async () => {
        try {
          const { data } = await api.tagAutoSuggest(q);
          suggestEl.innerHTML = '';
          if (!data?.length) { suggestEl.classList.add('hidden'); return; }
          suggestEl.classList.remove('hidden');
          data.slice(0, 8).forEach((t) => {
            const btn = document.createElement('button');
            btn.className = 'w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700 transition-colors';
            btn.textContent = t.name;
            btn.addEventListener('click', () => {
              if (!arr.find((x) => x.id === t.id)) {
                arr.push(t);
                renderChips(chipsEl, arr, chipColor);
              }
              inputEl.value = '';
              suggestEl.classList.add('hidden');
            });
            suggestEl.appendChild(btn);
          });
        } catch {}
      }, 250);
    });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = suggestEl.querySelector('button');
        if (first) first.click();
      }
      if (e.key === 'Escape') suggestEl.classList.add('hidden');
    });
  }

  setupTagInput(
    document.getElementById('bm-add-tag-input'),
    document.getElementById('bm-add-tag-suggestions'),
    addTags,
    document.getElementById('bm-add-tags-chips'),
    'bg-blue-700/60 text-blue-200',
  );
  setupTagInput(
    document.getElementById('bm-remove-tag-input'),
    document.getElementById('bm-remove-tag-suggestions'),
    removeTags,
    document.getElementById('bm-remove-tags-chips'),
    'bg-red-700/60 text-red-200',
  );

  // ── Datum toggle ──────────────────────────────────────────────────────────
  document.getElementById('bm-date-check').addEventListener('change', (e) => {
    document.getElementById('bm-date-input').disabled = !e.target.checked;
  });

  // ── Plats toggle + sökning ────────────────────────────────────────────────
  let chosenLat = null, chosenLon = null, chosenLabel = null;

  document.getElementById('bm-loc-check').addEventListener('change', (e) => {
    document.getElementById('bm-loc-input').disabled = !e.target.checked;
    document.getElementById('bm-loc-search').disabled = !e.target.checked;
  });

  async function doLocSearch() {
    const q = document.getElementById('bm-loc-input').value.trim();
    if (!q) return;
    const resEl = document.getElementById('bm-loc-results');
    try {
      const { data } = await api.geocode(q);
      resEl.innerHTML = '';
      if (!data?.length) {
        resEl.innerHTML = '<p class="text-xs text-slate-500 px-1">Inga träffar</p>';
        resEl.classList.remove('hidden');
        return;
      }
      resEl.classList.remove('hidden');
      data.slice(0, 5).forEach((r) => {
        const btn = document.createElement('button');
        btn.className = 'w-full text-left px-3 py-1.5 text-xs text-slate-200 bg-slate-700/60 hover:bg-slate-600 rounded-lg transition-colors';
        btn.textContent = r.displayName;
        btn.addEventListener('click', () => {
          chosenLat = r.lat; chosenLon = r.lon; chosenLabel = r.label;
          document.getElementById('bm-loc-chosen-label').textContent = r.label;
          document.getElementById('bm-loc-chosen').classList.remove('hidden');
          resEl.classList.add('hidden');
        });
        resEl.appendChild(btn);
      });
    } catch {}
  }

  document.getElementById('bm-loc-search').addEventListener('click', doLocSearch);
  document.getElementById('bm-loc-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doLocSearch(); }
  });
  document.getElementById('bm-loc-clear').addEventListener('click', () => {
    chosenLat = chosenLon = chosenLabel = null;
    document.getElementById('bm-loc-chosen').classList.add('hidden');
    document.getElementById('bm-loc-input').value = '';
  });

  // ── Stäng ─────────────────────────────────────────────────────────────────
  function close() { modal.remove(); }

  document.getElementById('bm-close').addEventListener('click', close);
  document.getElementById('bm-cancel').addEventListener('click', close);
  document.getElementById('bm-backdrop').addEventListener('click', close);
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });

  // ── Spara ─────────────────────────────────────────────────────────────────
  document.getElementById('bm-save').addEventListener('click', async () => {
    const saveBtn = document.getElementById('bm-save');
    if (!saveBtn) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Sparar…';

    const assetIds = assets.map((a) => a.id);

    try {
      // Taggar
      if (addTags.length || removeTags.length) {
        await api.bulkTags({
          assetIds,
          addTagIds:    addTags.map((t) => t.id),
          removeTagIds: removeTags.map((t) => t.id),
        });
      }

      // Datum
      const dateCheck = document.getElementById('bm-date-check');
      const dateVal   = document.getElementById('bm-date-input').value;
      if (dateCheck?.checked && dateVal) {
        await api.bulkDatetime({
          assetIds,
          takenAt: new Date(dateVal).toISOString(),
        });
      }

      // Plats
      const locCheck = document.getElementById('bm-loc-check');
      if (locCheck?.checked && chosenLat != null) {
        await api.bulkLocation({
          assetIds,
          lat: chosenLat, lon: chosenLon, label: chosenLabel,
        });
      }

      toast(`${assetIds.length} bilder uppdaterade`, 'success');
      close();
    } catch (err) {
      toast('Kunde inte spara: ' + (err.message ?? 'Okänt fel'), 'error');
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Spara'; }
    }
  });
}
