import { api } from '../../api.js';
import { toast } from '../../utils.js';
import { showUndoToast } from '../lightbox.js';

// ── Persistence ──────────────────────────────────────────────────────────────
const LS_LAST      = 'pm-rename-last';      // { pattern, seqStart, seqStep }
const LS_TEMPLATES = 'pm-rename-templates'; // [{ name, pattern, seqStart, seqStep }]

function loadLastPattern()  { try { return JSON.parse(localStorage.getItem(LS_LAST) ?? 'null'); } catch { return null; } }
function saveLastPattern(p) { localStorage.setItem(LS_LAST, JSON.stringify(p)); }
function loadTemplates()    { try { return JSON.parse(localStorage.getItem(LS_TEMPLATES) ?? '[]'); } catch { return []; } }
function saveTemplates(t)   { localStorage.setItem(LS_TEMPLATES, JSON.stringify(t)); }

// ── Datum-formatering ────────────────────────────────────────────────────────
function applyDateFormat(date, fmt) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return '';
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  return fmt
    .replace(/yyyy/g, d.getFullYear())
    .replace(/yy/g,   String(d.getFullYear()).slice(-2))
    .replace(/MM/g,   pad(d.getMonth() + 1))
    .replace(/dd/g,   pad(d.getDate()))
    .replace(/HH/g,   pad(d.getHours()))
    .replace(/mm/g,   pad(d.getMinutes()))
    .replace(/ss/g,   pad(d.getSeconds()));
}

// ── Token-rendering ──────────────────────────────────────────────────────────
function stem(name) { const i = name.lastIndexOf('.'); return i >= 0 ? name.slice(0, i) : name; }
function ext(name)  { const i = name.lastIndexOf('.'); return i >= 0 ? name.slice(i) : ''; }

function renderPattern(pat, asset, enriched, seqIdx, seqStart, seqStep, dateSource, fixedDate) {
  let result = pat;

  // [file] → filnamn utan ändelse
  result = result.replace(/\[file\]/g, stem(asset.file_name ?? ''));

  // [date:format] → formaterat datum
  const dateVal = dateSource === 'fixed' ? (fixedDate ?? new Date()) : (asset.taken_at ? new Date(asset.taken_at) : null);
  result = result.replace(/\[date:([^\]]+)\]/g, (_, fmt) => applyDateFormat(dateVal, fmt));
  result = result.replace(/\[date\]/g, dateVal ? applyDateFormat(dateVal, 'yyyyMMddTHHmmss') : '');

  // [cam] → kameramärke + modell
  const cam = [enriched?.camera_make, enriched?.camera_model].filter(Boolean).join(' ');
  result = result.replace(/\[cam\]/g, cam);

  // [location] → platsetikett
  result = result.replace(/\[location\]/g, asset.location_label ?? '');

  // [rating] → betyg
  result = result.replace(/\[rating\]/g, asset.rating ? String(asset.rating) : '');

  // [width] / [height] / [size]
  result = result.replace(/\[width\]/g,  asset.width  ? String(asset.width)  : '');
  result = result.replace(/\[height\]/g, asset.height ? String(asset.height) : '');
  result = result.replace(/\[size\]/g,   asset.file_size ? String(Math.round(asset.file_size / 1024)) : '');

  // [tag:N] / [tag]
  const tags = enriched?.tag_names ?? [];
  result = result.replace(/\[tag:(\d+)\]/g, (_, n) => tags[parseInt(n)] ?? '');
  result = result.replace(/\[tag\]/g, tags[0] ?? '');

  // [person:N] / [person]
  const persons = enriched?.person_names ?? [];
  result = result.replace(/\[person:(\d+)\]/g, (_, n) => persons[parseInt(n)] ?? '');
  result = result.replace(/\[person\]/g, persons[0] ?? '');

  // ##...# → sekvensnummer med zero-padding
  const seqNum = seqStart + seqIdx * seqStep;
  result = result.replace(/#+/g, (m) => String(seqNum).padStart(m.length, '0'));

  // Modifiers (tillämpas på hela resultatet)
  if (result.includes('{upper}')) result = result.replace(/\{upper\}/g, '').toUpperCase();
  else if (result.includes('{lower}')) result = result.replace(/\{lower\}/g, '').toLowerCase();
  else if (result.includes('{first}')) {
    result = result.replace(/\{first\}/g, '');
    result = result.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  result = result.replace(/\{trim\}/g, '').replace(/\s+/g, ' ').trim();

  return result;
}

// ── Huvud-modal ──────────────────────────────────────────────────────────────
export async function openRenameModal(assets, onDone) {
  document.getElementById('rename-modal')?.remove();

  // State
  let seqStart   = 1;
  let seqStep    = 1;
  let dateSource = 'image';
  let fixedDate  = new Date();
  let enriched   = {};  // { [assetId]: { camera_make, camera_model, tag_names, person_names } }
  let activePanel = null; // 'antal' | 'datum' | null

  // Hämta senaste mönster
  const lastSaved = loadLastPattern();
  const defaultPattern = lastSaved?.pattern ?? '[date:yyyyMMdd]-[file]';
  if (lastSaved) { seqStart = lastSaved.seqStart ?? 1; seqStep = lastSaved.seqStep ?? 1; }

  // Modal HTML
  const modal = document.createElement('div');
  modal.id = 'rename-modal';
  modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" id="rn-backdrop"></div>
    <div class="relative bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">

      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3.5 border-b border-slate-700 shrink-0">
        <h2 class="text-sm font-semibold text-white flex items-center gap-2">
          <span class="text-base">✏️</span>
          Döp om ${assets.length === 1 ? `"${assets[0].file_name}"` : `${assets.length} filer`}
        </h2>
        <button id="rn-close" class="text-slate-400 hover:text-white p-1 rounded transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">

        <!-- Mönster-inmatning -->
        <div>
          <label class="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Mönster</label>
          <div class="flex gap-2 items-center">
            <input id="rn-pattern" type="text" autocomplete="off" spellcheck="false"
              value="${defaultPattern.replace(/"/g, '&quot;')}"
              placeholder="t.ex. [date:yyyyMMdd]-[cam]-##"
              class="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                     placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"/>
            <button id="rn-clear-pattern" title="Rensa mönster"
              class="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors shrink-0">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Token-knappar -->
        <div class="space-y-2">
          <div class="flex flex-wrap gap-1.5">
            <!-- Fil -->
            <div class="relative">
              <button class="rn-cat-btn" data-menu="fil">📄 Fil ▾</button>
              <div id="rn-menu-fil" class="rn-dropdown hidden">
                <button class="rn-dd-item" data-insert="[file]"><code>[file]</code> Filnamn</button>
              </div>
            </div>

            <!-- Antal -->
            <button class="rn-cat-btn" id="rn-btn-antal"># Antal…</button>

            <!-- Datum -->
            <button class="rn-cat-btn" id="rn-btn-datum">📅 Datum och tid…</button>

            <!-- Kamera -->
            <button class="rn-cat-btn" data-insert="[cam]">📷 Kamera</button>

            <!-- Plats -->
            <button class="rn-cat-btn" data-insert="[location]">📍 Plats</button>

            <!-- Betyg -->
            <button class="rn-cat-btn" data-insert="[rating]">⭐ Betyg</button>

            <!-- Taggar -->
            <div class="relative">
              <button class="rn-cat-btn" data-menu="tag">🏷️ Taggar ▾</button>
              <div id="rn-menu-tag" class="rn-dropdown hidden">
                <button class="rn-dd-item" data-insert="[tag]"><code>[tag]</code> Första tagg</button>
                <button class="rn-dd-item" data-insert="[tag:1]"><code>[tag:1]</code> Andra tagg</button>
                <button class="rn-dd-item" data-insert="[tag:2]"><code>[tag:2]</code> Tredje tagg</button>
              </div>
            </div>

            <!-- Person -->
            <div class="relative">
              <button class="rn-cat-btn" data-menu="person">👤 Person ▾</button>
              <div id="rn-menu-person" class="rn-dropdown hidden">
                <button class="rn-dd-item" data-insert="[person]"><code>[person]</code> Första person</button>
                <button class="rn-dd-item" data-insert="[person:1]"><code>[person:1]</code> Andra person</button>
              </div>
            </div>

            <!-- Mått -->
            <div class="relative">
              <button class="rn-cat-btn" data-menu="matt">📐 Mått ▾</button>
              <div id="rn-menu-matt" class="rn-dropdown hidden">
                <button class="rn-dd-item" data-insert="[width]"><code>[width]</code> Bredd (px)</button>
                <button class="rn-dd-item" data-insert="[height]"><code>[height]</code> Höjd (px)</button>
                <button class="rn-dd-item" data-insert="[size]"><code>[size]</code> Filstorlek (KiB)</button>
              </div>
            </div>

            <!-- Modifier -->
            <div class="relative">
              <button class="rn-cat-btn" data-menu="mod">✏️ Skiftläge ▾</button>
              <div id="rn-menu-mod" class="rn-dropdown hidden">
                <button class="rn-dd-item" data-insert="{upper}"><code>{upper}</code> VERSALER</button>
                <button class="rn-dd-item" data-insert="{lower}"><code>{lower}</code> gemener</button>
                <button class="rn-dd-item" data-insert="{first}"><code>{first}</code> Första Bokstav</button>
                <button class="rn-dd-item" data-insert="{trim}"><code>{trim}</code> Ta bort mellanslag</button>
              </div>
            </div>
          </div>

          <!-- Sub-panel: Antal -->
          <div id="rn-panel-antal" class="hidden bg-slate-700/40 border border-slate-600 rounded-xl p-3 space-y-2.5">
            <p class="text-xs font-semibold text-slate-300">Sekvensnummer</p>
            <div class="flex gap-2 flex-wrap items-center">
              <div class="flex gap-1">
                ${[1,2,3,4].map(n => `<button class="rn-digit-btn px-2.5 py-1 rounded text-xs font-mono border transition-colors
                  ${n===2 ? 'bg-violet-700 border-violet-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-slate-400'}"
                  data-digits="${n}">${'#'.repeat(n)}</button>`).join('')}
              </div>
              <label class="flex items-center gap-1.5 text-xs text-slate-300">
                Startvärde <input id="rn-seq-start" type="number" value="${seqStart}" min="0"
                  class="w-16 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"/>
              </label>
              <label class="flex items-center gap-1.5 text-xs text-slate-300">
                Steg <input id="rn-seq-step" type="number" value="${seqStep}" min="1"
                  class="w-16 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"/>
              </label>
              <button id="rn-antal-insert" class="px-3 py-1 text-xs rounded-lg bg-violet-700 hover:bg-violet-600 text-white transition-colors">
                Infoga
              </button>
            </div>
          </div>

          <!-- Sub-panel: Datum och tid -->
          <div id="rn-panel-datum" class="hidden bg-slate-700/40 border border-slate-600 rounded-xl p-3 space-y-2.5">
            <p class="text-xs font-semibold text-slate-300">Datum och tid</p>
            <div class="flex gap-2 flex-wrap items-center">
              <label class="flex items-center gap-1.5 text-xs text-slate-300">
                Källa
                <select id="rn-date-source" class="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:outline-none">
                  <option value="image">Bildens datum</option>
                  <option value="fixed">Fast datum</option>
                </select>
              </label>
              <input id="rn-fixed-date" type="datetime-local" class="hidden bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:outline-none"
                value="${new Date().toISOString().slice(0,16)}"/>
            </div>
            <div class="flex gap-2 flex-wrap items-center">
              <label class="flex items-center gap-1.5 text-xs text-slate-300">
                Format
                <input id="rn-date-fmt" type="text" value="yyyyMMdd" placeholder="yyyyMMdd"
                  class="w-36 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white font-mono focus:outline-none focus:border-blue-500"/>
              </label>
              <span class="text-xs text-slate-400">Exempel: <span id="rn-date-preview" class="text-white font-mono"></span></span>
            </div>
            <div class="flex gap-1.5 flex-wrap">
              ${[
                ['yyyyMMdd',         'yyyyMMdd'],
                ['yyyy-MM-dd',       'yyyy-MM-dd'],
                ['yyyyMMdd-HHmmss',  'yyyyMMdd-HHmmss'],
                ['HHmmss',           'HHmmss'],
                ['yyyy',             'yyyy'],
              ].map(([lbl, fmt]) => `<button class="rn-date-preset px-2 py-0.5 text-[10px] rounded bg-slate-700 hover:bg-slate-600 text-slate-300 font-mono transition-colors" data-fmt="${fmt}">${lbl}</button>`).join('')}
            </div>
            <button id="rn-datum-insert" class="px-3 py-1 text-xs rounded-lg bg-violet-700 hover:bg-violet-600 text-white transition-colors">
              Infoga
            </button>
          </div>
        </div>

        <!-- Mallar -->
        <div class="relative flex gap-2 items-center pt-0.5">
          <label class="text-xs font-semibold text-slate-400 uppercase tracking-wider shrink-0">Mallar:</label>
          <select id="rn-template-select" class="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none max-w-xs">
            <option value="">— Välj mall —</option>
          </select>
          <button id="rn-save-template" title="Spara nuvarande mönster som mall"
            class="px-2.5 py-1.5 text-xs rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white transition-colors shrink-0">
            + Spara mall
          </button>
          <button id="rn-delete-template" title="Radera vald mall"
            class="hidden px-2.5 py-1.5 text-xs rounded-lg bg-red-900/50 hover:bg-red-800 text-red-400 hover:text-red-200 transition-colors shrink-0">
            🗑
          </button>

          <!-- Inline-dialog för mallnamn (ersätter prompt()) -->
          <div id="rn-save-dialog" class="hidden absolute bottom-full right-0 mb-2 z-50
            bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-4 w-72">
            <p class="text-xs font-semibold text-white mb-2">Spara mall</p>
            <input id="rn-save-dialog-name" type="text" placeholder="Ge mallen ett namn…" autocomplete="off"
              class="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                     placeholder-slate-500 focus:outline-none focus:border-blue-500"/>
            <div class="flex gap-2 mt-3 justify-end">
              <button id="rn-save-dialog-cancel"
                class="px-3 py-1.5 text-xs rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white transition-colors">
                Avbryt
              </button>
              <button id="rn-save-dialog-ok"
                class="px-3 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors">
                Spara
              </button>
            </div>
          </div>
        </div>

        <!-- Förhandsgranskning -->
        <div>
          <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Förhandsgranskning</label>
          <div class="rounded-xl overflow-hidden border border-slate-700 bg-slate-900/60 max-h-56 overflow-y-auto">
            <table class="w-full text-xs">
              <thead class="sticky top-0 bg-slate-800">
                <tr>
                  <th class="text-left px-3 py-2 text-slate-400 font-medium w-1/2">Aktuellt namn</th>
                  <th class="text-left px-3 py-2 text-slate-400 font-medium w-1/2">Nytt namn</th>
                </tr>
              </thead>
              <tbody id="rn-preview-body"></tbody>
            </table>
          </div>
          <p id="rn-warn" class="text-xs text-amber-400 mt-1.5 hidden"></p>
        </div>

      </div>

      <!-- Progress -->
      <div id="rn-progress" class="hidden px-5 py-2 text-xs text-slate-400 bg-slate-900/50 shrink-0"></div>

      <!-- Footer -->
      <div class="flex justify-between items-center gap-2 px-5 py-3.5 border-t border-slate-700 shrink-0">
        <span id="rn-status" class="text-xs text-slate-500"></span>
        <div class="flex gap-2">
          <button id="rn-cancel" class="px-4 py-2 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">
            Avbryt
          </button>
          <button id="rn-save" class="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors">
            Döp om (${assets.length})
          </button>
        </div>
      </div>
    </div>`;

  // Inline styles för token-knappar
  const style = document.createElement('style');
  style.textContent = `
    .rn-cat-btn {
      padding: 4px 10px; font-size: 11px; border-radius: 6px; border: 1px solid #475569;
      background: #1e293b; color: #cbd5e1; cursor: pointer; transition: all 0.15s; white-space: nowrap;
    }
    .rn-cat-btn:hover { background: #334155; color: #fff; border-color: #64748b; }
    .rn-dropdown {
      position: absolute; top: calc(100% + 4px); left: 0; z-index: 200;
      background: #1e293b; border: 1px solid #475569; border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5); min-width: 180px; overflow: hidden;
    }
    .rn-dd-item {
      display: block; width: 100%; text-align: left; padding: 7px 12px; font-size: 11px;
      color: #cbd5e1; cursor: pointer; border: none; background: none; transition: background 0.1s;
    }
    .rn-dd-item:hover { background: #334155; color: #fff; }
    .rn-dd-item code { color: #a78bfa; margin-right: 6px; }
  `;
  document.head.appendChild(style);
  document.body.appendChild(modal);

  // ── Hjälpfunktioner ──────────────────────────────────────────────────────
  function close() { modal.remove(); style.remove(); }

  /** Infoga text i mönsterfältet vid aktuell cursor-position */
  function insertAtCursor(text) {
    const inp = /** @type {HTMLInputElement} */ (document.getElementById('rn-pattern'));
    if (!inp) return;
    const s = inp.selectionStart ?? inp.value.length;
    const e = inp.selectionEnd   ?? inp.value.length;
    inp.value = inp.value.slice(0, s) + text + inp.value.slice(e);
    inp.focus();
    inp.selectionStart = inp.selectionEnd = s + text.length;
    inp.dispatchEvent(new Event('input'));
  }

  function closeAllMenus() {
    modal.querySelectorAll('.rn-dropdown').forEach(d => d.classList.add('hidden'));
  }

  function getSeqStart() { return parseInt(/** @type {HTMLInputElement|null} */ (document.getElementById('rn-seq-start'))?.value ?? '1', 10) || 1; }
  function getSeqStep()  { return parseInt(/** @type {HTMLInputElement|null} */ (document.getElementById('rn-seq-step'))?.value  ?? '1', 10) || 1; }

  // ── Förhandsgranskning ────────────────────────────────────────────────────
  let _previewTimer = null;
  function schedulePreview() {
    clearTimeout(_previewTimer);
    _previewTimer = setTimeout(updatePreview, 80);
  }

  function updatePreview() {
    const pat     = /** @type {HTMLInputElement|null} */ (document.getElementById('rn-pattern'))?.value ?? '';
    const sStart  = getSeqStart();
    const sStep   = getSeqStep();
    const tbody   = document.getElementById('rn-preview-body');
    const warnEl  = document.getElementById('rn-warn');
    const statusEl = document.getElementById('rn-status');
    if (!tbody) return;

    const newNames = assets.map((asset, i) => {
      const enr = enriched[asset.id] ?? {};
      const rendered = renderPattern(pat, asset, enr, i, sStart, sStep, dateSource, fixedDate);
      return rendered + ext(asset.file_name ?? '');
    });

    // Kontrollera kollisioner
    const dupes = newNames.filter((n, i) => newNames.indexOf(n) !== i);
    const empties = newNames.filter(n => !n || n === ext(assets[0]?.file_name ?? ''));

    tbody.innerHTML = assets.map((asset, i) => {
      const nName = newNames[i];
      const isEmpty = !nName || nName === ext(asset.file_name ?? '');
      const isDupe  = dupes.includes(nName);
      const isUnchanged = nName === asset.file_name;
      const cls = isEmpty || isDupe ? 'text-amber-400' : isUnchanged ? 'text-slate-500' : 'text-green-400';
      return `<tr class="border-t border-slate-700/50 hover:bg-slate-800/30">
        <td class="px-3 py-1.5 text-slate-400 w-1/2 whitespace-nowrap overflow-x-auto select-text cursor-text">${_esc(asset.file_name)}</td>
        <td class="px-3 py-1.5 truncate max-w-0 w-1/2 ${cls} font-mono cursor-help" title="${_esc(nName || '')}">${_esc(nName || '(tomt)')}</td>
      </tr>`;
    }).join('');

    const warns = [];
    if (empties.length) warns.push(`${empties.length} fil(er) saknar namn`);
    if (dupes.length)   warns.push(`${dupes.length} dubblettnamn`);
    if (warnEl) {
      warnEl.textContent = warns.join(' · ');
      warnEl.classList.toggle('hidden', !warns.length);
    }
    if (statusEl) statusEl.textContent = `${assets.length - empties.length} namnbyten`;
  }

  // ── Datum-panel ───────────────────────────────────────────────────────────
  function updateDatePreview() {
    const fmt   = /** @type {HTMLInputElement|null} */ (document.getElementById('rn-date-fmt'))?.value ?? '';
    const previewEl = document.getElementById('rn-date-preview');
    const exDate = dateSource === 'fixed' ? fixedDate : (assets[0]?.taken_at ? new Date(assets[0].taken_at) : new Date());
    if (previewEl) previewEl.textContent = applyDateFormat(exDate, fmt);
  }

  // ── Mallar ────────────────────────────────────────────────────────────────
  function renderTemplates() {
    const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('rn-template-select'));
    const del = document.getElementById('rn-delete-template');
    if (!sel) return;
    const tpls = loadTemplates();
    sel.innerHTML = '<option value="">— Välj mall —</option>' +
      tpls.map(t => `<option value="${_esc(t.name)}">${_esc(t.name)}</option>`).join('');
    if (del) del.classList.toggle('hidden', tpls.length === 0);
  }

  // ── Event-lyssnare ────────────────────────────────────────────────────────
  document.getElementById('rn-close')?.addEventListener('click', close);
  document.getElementById('rn-cancel')?.addEventListener('click', close);
  document.getElementById('rn-backdrop')?.addEventListener('click', close);

  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });

  // Mönster-input → live preview
  document.getElementById('rn-pattern')?.addEventListener('input', schedulePreview);

  // Rensa mönster
  document.getElementById('rn-clear-pattern')?.addEventListener('click', () => {
    const inp = document.getElementById('rn-pattern');
    if (inp) { /** @type {HTMLInputElement} */ (inp).value = ''; inp.focus(); inp.dispatchEvent(new Event('input')); }
  });

  // Dropdown-menyer (Fil, Taggar, Person, Mått, Modifier)
  modal.querySelectorAll('[data-menu]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key  = /** @type {HTMLElement} */ (btn).dataset.menu;
      const menu = document.getElementById(`rn-menu-${key}`);
      closeAllMenus();
      if (menu) menu.classList.toggle('hidden');
    });
  });

  // Direkta token-insert knappar
  modal.querySelectorAll('[data-insert]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const token = /** @type {HTMLElement} */ (btn).dataset.insert;
      if (token) insertAtCursor(token);
      closeAllMenus();
    });
  });

  // Dropdown-items (från menyer)
  modal.querySelectorAll('.rn-dd-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const token = /** @type {HTMLElement} */ (item).dataset.insert;
      if (token) insertAtCursor(token);
      closeAllMenus();
    });
  });

  // Stäng dropdowns vid klick utanför
  document.addEventListener('click', closeAllMenus, { once: false });
  modal.addEventListener('click', (e) => e.stopPropagation()); // förhindra stängning vid klick inuti

  // Sub-panel: Antal
  document.getElementById('rn-btn-antal')?.addEventListener('click', () => {
    const p = document.getElementById('rn-panel-antal');
    const d = document.getElementById('rn-panel-datum');
    d?.classList.add('hidden');
    p?.classList.toggle('hidden');
    activePanel = p?.classList.contains('hidden') ? null : 'antal';
  });

  // Siffror-knappar (padning)
  let selectedDigits = 2;
  modal.querySelectorAll('.rn-digit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedDigits = parseInt(/** @type {HTMLElement} */ (btn).dataset.digits ?? '2', 10);
      modal.querySelectorAll('.rn-digit-btn').forEach(b => {
        const active = /** @type {HTMLElement} */ (b).dataset.digits === String(selectedDigits);
        b.classList.toggle('bg-violet-700', active);
        b.classList.toggle('border-violet-500', active);
        b.classList.toggle('text-white', active);
        b.classList.toggle('bg-slate-800', !active);
        b.classList.toggle('border-slate-600', !active);
        b.classList.toggle('text-slate-300', !active);
      });
    });
  });

  document.getElementById('rn-seq-start')?.addEventListener('input', () => {
    seqStart = getSeqStart();
    schedulePreview();
  });
  document.getElementById('rn-seq-step')?.addEventListener('input', () => {
    seqStep = getSeqStep();
    schedulePreview();
  });

  document.getElementById('rn-antal-insert')?.addEventListener('click', () => {
    insertAtCursor('#'.repeat(selectedDigits));
    document.getElementById('rn-panel-antal')?.classList.add('hidden');
  });

  // Sub-panel: Datum
  document.getElementById('rn-btn-datum')?.addEventListener('click', () => {
    const p = document.getElementById('rn-panel-datum');
    const a = document.getElementById('rn-panel-antal');
    a?.classList.add('hidden');
    p?.classList.toggle('hidden');
    activePanel = p?.classList.contains('hidden') ? null : 'datum';
    updateDatePreview();
  });

  document.getElementById('rn-date-source')?.addEventListener('change', (e) => {
    dateSource = /** @type {HTMLSelectElement} */ (e.target).value;
    const fixedInput = document.getElementById('rn-fixed-date');
    fixedInput?.classList.toggle('hidden', dateSource !== 'fixed');
    updateDatePreview();
    schedulePreview();
  });

  document.getElementById('rn-fixed-date')?.addEventListener('input', (e) => {
    const val = /** @type {HTMLInputElement} */ (e.target).value;
    fixedDate = val ? new Date(val) : new Date();
    updateDatePreview();
    schedulePreview();
  });

  document.getElementById('rn-date-fmt')?.addEventListener('input', () => {
    updateDatePreview();
    schedulePreview();
  });

  modal.querySelectorAll('.rn-date-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const fmt = /** @type {HTMLElement} */ (btn).dataset.fmt ?? '';
      const inp = /** @type {HTMLInputElement|null} */ (document.getElementById('rn-date-fmt'));
      if (inp) { inp.value = fmt; inp.dispatchEvent(new Event('input')); }
    });
  });

  document.getElementById('rn-datum-insert')?.addEventListener('click', () => {
    const fmt = /** @type {HTMLInputElement|null} */ (document.getElementById('rn-date-fmt'))?.value ?? 'yyyyMMdd';
    insertAtCursor(`[date:${fmt}]`);
    document.getElementById('rn-panel-datum')?.classList.add('hidden');
  });

  // Mallar
  renderTemplates();

  document.getElementById('rn-template-select')?.addEventListener('change', (e) => {
    const name = /** @type {HTMLSelectElement} */ (e.target).value;
    if (!name) return;
    const tpl = loadTemplates().find(t => t.name === name);
    if (!tpl) return;
    const inp = /** @type {HTMLInputElement|null} */ (document.getElementById('rn-pattern'));
    if (inp) { inp.value = tpl.pattern; inp.dispatchEvent(new Event('input')); }
    if (tpl.seqStart !== undefined) {
      seqStart = tpl.seqStart;
      const si = /** @type {HTMLInputElement|null} */ (document.getElementById('rn-seq-start'));
      if (si) si.value = String(seqStart);
    }
    if (tpl.seqStep !== undefined) {
      seqStep = tpl.seqStep;
      const ss = /** @type {HTMLInputElement|null} */ (document.getElementById('rn-seq-step'));
      if (ss) ss.value = String(seqStep);
    }
  });

  function openSaveDialog() {
    const pat = /** @type {HTMLInputElement|null} */ (document.getElementById('rn-pattern'))?.value.trim();
    if (!pat) { toast('Ange ett mönster att spara', 'warn'); return; }
    const dlg = document.getElementById('rn-save-dialog');
    if (!dlg) return;
    dlg.classList.remove('hidden');
    const nameInp = /** @type {HTMLInputElement|null} */ (document.getElementById('rn-save-dialog-name'));
    if (nameInp) { nameInp.value = ''; nameInp.focus(); }
  }

  function closeSaveDialog() {
    document.getElementById('rn-save-dialog')?.classList.add('hidden');
  }

  function commitSaveDialog() {
    const pat = /** @type {HTMLInputElement|null} */ (document.getElementById('rn-pattern'))?.value.trim();
    const nameInp = /** @type {HTMLInputElement|null} */ (document.getElementById('rn-save-dialog-name'));
    const name = nameInp?.value.trim();
    if (!name) { nameInp?.focus(); return; }
    const tpls = loadTemplates().filter(t => t.name !== name);
    tpls.push({ name, pattern: pat ?? '', seqStart: getSeqStart(), seqStep: getSeqStep() });
    saveTemplates(tpls);
    renderTemplates();
    const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('rn-template-select'));
    if (sel) sel.value = name;
    toast(`Mall "${name}" sparad`, 'success');
    closeSaveDialog();
  }

  document.getElementById('rn-save-template')?.addEventListener('click', openSaveDialog);
  document.getElementById('rn-save-dialog-cancel')?.addEventListener('click', closeSaveDialog);
  document.getElementById('rn-save-dialog-ok')?.addEventListener('click', commitSaveDialog);
  document.getElementById('rn-save-dialog-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); commitSaveDialog(); }
    if (e.key === 'Escape') { e.preventDefault(); closeSaveDialog(); }
  });

  document.getElementById('rn-delete-template')?.addEventListener('click', () => {
    const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('rn-template-select'));
    const name = sel?.value;
    if (!name) { toast('Välj en mall att radera', 'warn'); return; }
    if (!confirm(`Radera mallen "${name}"?`)) return;
    saveTemplates(loadTemplates().filter(t => t.name !== name));
    renderTemplates();
    toast(`Mall "${name}" raderad`, 'success');
  });

  // ── Spara / Döp om ────────────────────────────────────────────────────────
  document.getElementById('rn-save')?.addEventListener('click', async () => {
    const saveBtn  = document.getElementById('rn-save');
    const progEl   = document.getElementById('rn-progress');
    if (!saveBtn) return;

    const pat    = /** @type {HTMLInputElement|null} */ (document.getElementById('rn-pattern'))?.value.trim() ?? '';
    const sStart = getSeqStart();
    const sStep  = getSeqStep();

    if (!pat) { toast('Ange ett mönster', 'warn'); return; }

    // Bygg rename-lista (spara gamla namn för undo)
    const renames = assets.map((asset, i) => {
      const enr = enriched[asset.id] ?? {};
      const newStem = renderPattern(pat, asset, enr, i, sStart, sStep, dateSource, fixedDate);
      return { assetId: asset.id, oldName: asset.file_name, newName: newStem + ext(asset.file_name ?? '') };
    });

    const empty = renames.filter(r => !r.newName || r.newName === ext(assets[0]?.file_name ?? ''));
    if (empty.length) { toast(`${empty.length} fil(er) saknar namn — kontrollera mönstret`, 'warn'); return; }

    saveLastPattern({ pattern: pat, seqStart: sStart, seqStep: sStep });

    /** @type {HTMLButtonElement} */ (saveBtn).disabled = true;
    saveBtn.textContent = 'Döper om…';
    progEl?.classList.remove('hidden');

    let done = 0, errors = 0;
    const succeeded = [];
    for (const r of renames) {
      if (progEl) progEl.textContent = `Döper om ${done + 1}/${renames.length}…`;
      try {
        await api.renameAsset({ assetId: r.assetId, newName: r.newName });
        succeeded.push(r);
        done++;
      } catch { errors++; }
    }

    progEl?.classList.add('hidden');

    if (errors) toast(`${done} omdöpta, ${errors} misslyckades`, 'warn');

    close();
    onDone?.();

    if (done > 0) {
      showUndoToast(
        `${done} fil${done > 1 ? 'er' : ''} omdöpt${done > 1 ? 'a' : ''}`,
        async () => {
          for (const r of succeeded) {
            await api.renameAsset({ assetId: r.assetId, newName: r.oldName }).catch(() => {});
          }
          onDone?.();
        },
        5000,
      );
    }
  });

  // ── Initial: hämta enriched metadata asynkront ───────────────────────────
  const assetIds = assets.map(a => a.id);
  updatePreview(); // visa direkt med det vi har

  try {
    const { data } = await api.batchMetadata({ assetIds });
    enriched = data ?? {};
    updatePreview(); // uppdatera med kamera/tagg/person-data
  } catch {
    // Fortsätt utan enriched — tokens renderas som tomma strängar
  }

  // Fokusera mönsterfältet
  const patInp = document.getElementById('rn-pattern');
  if (patInp) {
    const inp = /** @type {HTMLInputElement} */ (patInp);
    inp.focus();
    inp.selectionStart = inp.selectionEnd = inp.value.length;
  }

  updateDatePreview();
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
