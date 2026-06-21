import { api } from '../api.js';
import { toast } from '../utils.js';

/**
 * Öppna bildredigeraren för en asset.
 * @param {{ id: string, file_name: string, thumb_large_path?: string, mime_type?: string }} asset
 * @param {(updatedAsset: object) => void} [onSaved]
 */
export function openImageEditor(asset, onSaved) {
  if (asset.mime_type?.startsWith('video/')) {
    toast('Videoredigering stöds inte', 'error');
    return;
  }

  // Editor-state
  let rotation  = 0;   // 0, 90, 180, 270
  let flipH     = false;
  let flipV     = false;
  let brightness = 1.0;
  let contrast   = 1.0;
  let saturation = 1.0;
  let isSaving   = false;

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[9500] bg-slate-900/98 flex flex-col';
  document.body.appendChild(overlay);

  const render = () => {
    overlay.innerHTML = `
      <div class="flex items-center justify-between px-4 py-3 border-b border-slate-700 flex-shrink-0">
        <div class="flex items-center gap-3">
          <button id="ie-back" class="text-slate-400 hover:text-white transition-colors flex items-center gap-1.5 text-sm">
            ← Avbryt
          </button>
          <span class="text-white font-medium text-sm truncate max-w-xs">${escHtml(asset.file_name)}</span>
        </div>
        <div class="flex items-center gap-2">
          <button id="ie-reset" class="px-3 py-1.5 text-xs text-slate-400 hover:text-white border border-slate-600 hover:border-slate-400 rounded-lg transition-colors">
            ↺ Återställ
          </button>
          <div class="relative" id="ie-save-wrap">
            <button id="ie-save-copy" class="px-4 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors">
              Spara som kopia
            </button>
          </div>
          <button id="ie-save-replace" class="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors font-medium">
            Ersätt original
          </button>
        </div>
      </div>

      <div class="flex flex-1 min-h-0 overflow-hidden">
        <!-- Preview -->
        <div class="flex-1 flex items-center justify-center p-6 min-w-0 bg-black/30">
          <div class="relative max-h-full max-w-full flex items-center justify-center">
            <img id="ie-preview"
              src="${asset.thumb_large_path ? `/thumbs/${asset.thumb_large_path}` : '/icons/placeholder.svg'}"
              class="max-h-[75vh] max-w-full object-contain transition-all duration-200 select-none"
              style="${previewStyle()}"
              draggable="false">
          </div>
        </div>

        <!-- Verktyg -->
        <div class="w-72 flex-shrink-0 bg-slate-800 border-l border-slate-700 overflow-y-auto p-5 space-y-6">

          <!-- Rotera & Spegla -->
          <div>
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Rotera & Spegla</p>
            <div class="grid grid-cols-4 gap-1.5">
              <button class="ie-tool-btn" id="ie-rot-ccw" title="Rotera moturs">↺</button>
              <button class="ie-tool-btn" id="ie-rot-180" title="180°">⟳ 180°</button>
              <button class="ie-tool-btn ie-tool-btn--wide col-span-1" id="ie-rot-cw" title="Rotera medurs">↻</button>
              <button class="ie-tool-btn ${flipH ? 'ie-tool-btn--active' : ''}" id="ie-flip-h" title="Spegla horisontellt">⇔</button>
              <button class="ie-tool-btn ${flipV ? 'ie-tool-btn--active' : ''} col-span-3" id="ie-flip-v" title="Spegla vertikalt">⇕ Spegla V</button>
            </div>
          </div>

          <!-- Ljus & Färg -->
          <div>
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Ljus & Färg</p>
            <div class="space-y-4">
              ${slider('ie-brightness', 'Ljusstyrka', brightness, 0.2, 3.0, 0.05)}
              ${slider('ie-contrast',  'Kontrast',   contrast,   0.2, 3.0, 0.05)}
              ${slider('ie-saturation','Mättnad',    saturation, 0.0, 3.0, 0.05)}
            </div>
          </div>

          <!-- Snabbkorrigeringar -->
          <div>
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Snabba justeringar</p>
            <div class="space-y-1.5">
              <button id="ie-auto-enhance" class="ie-action-btn">✨ Auto-förbättra</button>
              <button id="ie-sharpen" class="ie-action-btn ${sharpenActive ? 'ie-action-btn--active' : ''}">🔍 Skärpa</button>
            </div>
          </div>

          <!-- Info -->
          <div class="text-xs text-slate-500 leading-relaxed pt-2 border-t border-slate-700">
            <p><strong class="text-slate-400">Ersätt original</strong> — skriver över originalfilen. Kan inte ångras.</p>
            <p class="mt-1"><strong class="text-slate-400">Spara som kopia</strong> — skapar en ny fil och lägger till i biblioteket.</p>
          </div>
        </div>
      </div>

      <style>
        .ie-tool-btn {
          background: rgb(51 65 85);
          color: rgb(148 163 184);
          border: 1px solid rgb(71 85 105);
          border-radius: 0.5rem;
          padding: 0.375rem 0.5rem;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
          overflow: hidden;
        }
        .ie-tool-btn:hover { background: rgb(71 85 105); color: white; }
        .ie-tool-btn--active { background: rgb(37 99 235) !important; color: white !important; border-color: rgb(59 130 246) !important; }
        .ie-action-btn {
          width: 100%;
          text-align: left;
          background: rgb(51 65 85);
          color: rgb(148 163 184);
          border: 1px solid rgb(71 85 105);
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.8125rem;
          cursor: pointer;
          transition: all 0.15s;
        }
        .ie-action-btn:hover { background: rgb(71 85 105); color: white; }
        .ie-action-btn--active { background: rgb(30 64 175); color: rgb(147 197 253); border-color: rgb(37 99 235); }
        input[type=range].ie-slider {
          width: 100%;
          accent-color: rgb(59 130 246);
          cursor: pointer;
        }
      </style>`;

    attachListeners();
  };

  let sharpenActive = false;

  function previewStyle() {
    const transforms = [];
    if (rotation) transforms.push(`rotate(${rotation}deg)`);
    if (flipH) transforms.push('scaleX(-1)');
    if (flipV) transforms.push('scaleY(-1)');
    const transform = transforms.length ? `transform:${transforms.join(' ')};` : '';
    const filter = [
      brightness !== 1 ? `brightness(${brightness})` : '',
      contrast   !== 1 ? `contrast(${contrast})` : '',
      saturation !== 1 ? `saturate(${saturation})` : '',
    ].filter(Boolean).join(' ');
    return `${transform}${filter ? `filter:${filter};` : ''}`;
  }

  function updatePreview() {
    const img = overlay.querySelector('#ie-preview');
    if (img) /** @type {HTMLElement} */ (img).style.cssText = previewStyle();
  }

  function slider(id, label, value, min, max, step) {
    const pct = Math.round((value - 1) * 100);
    const sign = pct >= 0 ? '+' : '';
    return `
      <div>
        <div class="flex justify-between items-baseline mb-1">
          <label class="text-xs text-slate-300">${label}</label>
          <span id="${id}-val" class="text-xs text-slate-400 font-mono">${sign}${pct}%</span>
        </div>
        <input id="${id}" type="range" class="ie-slider" min="${min}" max="${max}" step="${step}" value="${value}">
      </div>`;
  }

  function attachListeners() {
    overlay.querySelector('#ie-back')?.addEventListener('click', () => overlay.remove());

    overlay.querySelector('#ie-rot-cw')?.addEventListener('click', () => {
      rotation = (rotation + 90) % 360;
      updatePreview();
    });
    overlay.querySelector('#ie-rot-ccw')?.addEventListener('click', () => {
      rotation = (rotation - 90 + 360) % 360;
      updatePreview();
    });
    overlay.querySelector('#ie-rot-180')?.addEventListener('click', () => {
      rotation = (rotation + 180) % 360;
      updatePreview();
    });
    overlay.querySelector('#ie-flip-h')?.addEventListener('click', () => {
      flipH = !flipH;
      overlay.querySelector('#ie-flip-h')?.classList.toggle('ie-tool-btn--active', flipH);
      updatePreview();
    });
    overlay.querySelector('#ie-flip-v')?.addEventListener('click', () => {
      flipV = !flipV;
      overlay.querySelector('#ie-flip-v')?.classList.toggle('ie-tool-btn--active', flipV);
      updatePreview();
    });

    const bindSlider = (id, setter) => {
      const el = /** @type {HTMLInputElement} */ (overlay.querySelector(`#${id}`));
      const valEl = overlay.querySelector(`#${id}-val`);
      el?.addEventListener('input', () => {
        const v = parseFloat(el.value);
        setter(v);
        if (valEl) {
          const pct = Math.round((v - 1) * 100);
          valEl.textContent = `${pct >= 0 ? '+' : ''}${pct}%`;
        }
        updatePreview();
      });
    };
    bindSlider('ie-brightness', (v) => { brightness = v; });
    bindSlider('ie-contrast',   (v) => { contrast = v; });
    bindSlider('ie-saturation', (v) => { saturation = v; });

    overlay.querySelector('#ie-auto-enhance')?.addEventListener('click', () => {
      brightness = 1.05; contrast = 1.1; saturation = 1.05;
      // Re-render sliders
      const bs = /** @type {HTMLInputElement} */ (overlay.querySelector('#ie-brightness'));
      const cs = /** @type {HTMLInputElement} */ (overlay.querySelector('#ie-contrast'));
      const ss = /** @type {HTMLInputElement} */ (overlay.querySelector('#ie-saturation'));
      if (bs) bs.value = String(brightness);
      if (cs) cs.value = String(contrast);
      if (ss) ss.value = String(saturation);
      overlay.querySelector('#ie-brightness-val') && (/** @type {HTMLElement} */ (overlay.querySelector('#ie-brightness-val')).textContent = '+5%');
      overlay.querySelector('#ie-contrast-val')   && (/** @type {HTMLElement} */ (overlay.querySelector('#ie-contrast-val')).textContent   = '+10%');
      overlay.querySelector('#ie-saturation-val') && (/** @type {HTMLElement} */ (overlay.querySelector('#ie-saturation-val')).textContent  = '+5%');
      updatePreview();
    });

    overlay.querySelector('#ie-sharpen')?.addEventListener('click', () => {
      sharpenActive = !sharpenActive;
      overlay.querySelector('#ie-sharpen')?.classList.toggle('ie-action-btn--active', sharpenActive);
    });

    overlay.querySelector('#ie-reset')?.addEventListener('click', () => {
      rotation = 0; flipH = false; flipV = false;
      brightness = 1; contrast = 1; saturation = 1;
      sharpenActive = false;
      render();
    });

    const doSave = async (saveAs) => {
      if (isSaving) return;
      isSaving = true;
      const btn = /** @type {HTMLButtonElement} */ (overlay.querySelector(saveAs === 'copy' ? '#ie-save-copy' : '#ie-save-replace'));
      const origText = btn?.textContent ?? '';
      if (btn) { btn.textContent = 'Sparar…'; btn.disabled = true; }

      try {
        const operations = buildOperations();
        if (!operations.length) { toast('Inga ändringar att spara', 'info'); return; }

        const { data } = await api.editAsset(asset.id, { operations, saveAs });
        toast(saveAs === 'copy' ? 'Kopia sparad!' : 'Original ersatt!', 'success');
        overlay.remove();
        onSaved?.(data);
      } catch (e) {
        toast(e.message, 'error');
        if (btn) { btn.textContent = origText; btn.disabled = false; }
        isSaving = false;
      }
    };

    overlay.querySelector('#ie-save-copy')?.addEventListener('click', () => doSave('copy'));
    overlay.querySelector('#ie-save-replace')?.addEventListener('click', async () => {
      const { confirm: doConfirm } = await import('../utils.js');
      const ok = await doConfirm('Ersätt originalet? Handlingen kan inte ångras.');
      if (ok) doSave('replace');
    });

    // Escape stänger
    overlay.addEventListener('keydown', (e) => {
      if (/** @type {KeyboardEvent} */ (e).key === 'Escape') overlay.remove();
    });
    overlay.setAttribute('tabindex', '-1');
    overlay.focus();
  }

  function buildOperations() {
    const ops = [];
    if (rotation)          ops.push({ type: 'rotate', angle: rotation });
    if (flipV)             ops.push({ type: 'flip' });
    if (flipH)             ops.push({ type: 'flop' });
    if (brightness !== 1 || saturation !== 1) {
      const mods = {};
      if (brightness !== 1) mods.brightness = brightness;
      if (saturation !== 1) mods.saturation = saturation;
      ops.push({ type: 'modulate', ...mods });
    }
    if (contrast !== 1) {
      // contrast via linear: output = input * a + b, a>1 = higher contrast
      ops.push({ type: 'linear', a: contrast, b: -(128 * (contrast - 1)) });
    }
    if (sharpenActive) ops.push({ type: 'sharpen' });
    return ops;
  }

  render();
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
