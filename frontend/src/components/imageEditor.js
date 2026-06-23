import { api } from '../api.js';
import { toast } from '../utils.js';

/**
 * @param {{ id: string, file_name: string, thumb_large_path?: string, mime_type?: string }} asset
 * @param {(updatedAsset: object) => void} [onSaved]
 */
export function openImageEditor(asset, onSaved) {
  if (asset.mime_type?.startsWith('video/')) {
    toast('Videoredigering stöds inte', 'error');
    return;
  }

  // ── State ─────────────────────────────────────────────────────────────────────
  let rotation   = 0;
  let flipH      = false;
  let flipV      = false;
  let brightness = 1.0;
  let contrast   = 1.0;
  let saturation = 1.0;
  let sharpenActive = false;
  let isSaving   = false;

  // Crop: during drawing/editing, cropRect = {x1,y1,x2,y2} in IMG display-px.
  // On confirm, cropFinal stores PERCENTAGES of the displayed image (= % of original).
  let cropMode  = false;
  let cropRect  = null;   // {x1,y1,x2,y2} display-px
  let cropFinal = null;   // {lp,tp,wp,hp} — left/top/width/height as 0–1 fractions

  // Drag tracking
  let dragType       = null;
  let dragStartMouse = null;
  let dragStartRect  = null;

  // ── Root element ──────────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-[9500] bg-slate-900 flex flex-col';
  document.body.appendChild(root);

  // ── render ────────────────────────────────────────────────────────────────────
  const render = () => {
    const hasCrop = cropFinal !== null;
    root.innerHTML = `
      <div class="flex items-center justify-between px-4 py-3 border-b border-slate-700 flex-shrink-0">
        <div class="flex items-center gap-3">
          <button id="ie-back" class="text-slate-400 hover:text-white text-sm flex items-center gap-1.5 transition-colors">← Avbryt</button>
          <span class="text-white font-medium text-sm truncate max-w-xs">${escHtml(asset.file_name)}</span>
        </div>
        <div class="flex items-center gap-2">
          <button id="ie-reset" class="px-3 py-1.5 text-xs text-slate-400 hover:text-white border border-slate-600 hover:border-slate-400 rounded-lg transition-colors">↺ Återställ</button>
          <button id="ie-save-copy" class="px-4 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors">💾 Spara som kopia</button>
          <button id="ie-save-replace" class="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors font-medium">⚠ Ersätt original</button>
        </div>
      </div>

      <div class="flex flex-1 min-h-0 overflow-hidden">
        <!-- Preview -->
        <div class="flex-1 flex items-center justify-center p-6 min-w-0" style="background:rgb(8 10 14)">
          <div class="relative overflow-hidden select-none" id="ie-img-wrap">
            <img id="ie-preview"
              src="${asset.thumb_large_path ? `/thumbs/${asset.thumb_large_path}` : '/icons/placeholder.svg'}"
              class="block max-h-[75vh] max-w-full object-contain"
              style="${previewStyle()}"
              draggable="false">
            ${cropMode ? `<div id="ie-crop-bg" class="absolute inset-0" style="z-index:5;cursor:crosshair"></div>` : ''}
            ${cropMode && cropRect ? selHtml(cropRect) : ''}
            ${!cropMode && hasCrop ? `<div style="position:absolute;bottom:8px;left:8px;background:rgba(0,0,0,.75);color:white;font-size:10px;padding:3px 8px;border-radius:4px;pointer-events:none;z-index:5">
              ✂ Förhandsgranskar beskärning
            </div>` : ''}
          </div>
        </div>

        <!-- Verktyg -->
        <div class="w-72 flex-shrink-0 bg-slate-800 border-l border-slate-700 overflow-y-auto p-5 space-y-6">

          <!-- Beskärning -->
          <div>
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Beskärning</p>
            <button id="ie-crop-btn" class="ie-action-btn ${cropMode ? 'ie-action-btn--active' : ''}">
              ✂ ${cropMode ? 'Bekräfta (Enter)' : hasCrop ? 'Rita ny beskärning' : 'Rita beskärning'}
            </button>
            <p class="text-[10px] text-slate-500 mt-1.5 leading-relaxed">
              ${cropMode
                ? 'Dra på bilden för att välja area. Dra i handtagen för att justera. Enter = bekräfta · Esc = avbryt.'
                : hasCrop
                  ? `Valt område: ${Math.round(cropFinal.lp*100)}%, ${Math.round(cropFinal.tp*100)}% · ${Math.round(cropFinal.wp*100)}%×${Math.round(cropFinal.hp*100)}%`
                  : 'Klicka för att aktivera, dra sedan på bilden.'}
            </p>
            ${hasCrop && !cropMode ? `<button id="ie-crop-clear" class="ie-action-btn mt-2" style="font-size:.75rem">✕ Ta bort beskärning</button>` : ''}
          </div>

          <!-- Rotera & Spegla -->
          <div>
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Rotera & Spegla</p>
            <div class="grid grid-cols-4 gap-1.5">
              <button class="ie-tool-btn" id="ie-rot-ccw">↺</button>
              <button class="ie-tool-btn" id="ie-rot-180" style="font-size:.7rem">180°</button>
              <button class="ie-tool-btn" id="ie-rot-cw">↻</button>
              <button class="ie-tool-btn ${flipH ? 'ie-tool-btn--active' : ''}" id="ie-flip-h">⇔</button>
              <button class="ie-tool-btn ${flipV ? 'ie-tool-btn--active' : ''} col-span-3" id="ie-flip-v">⇕ Spegla V</button>
            </div>
          </div>

          <!-- Ljus & Färg -->
          <div>
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Ljus & Färg</p>
            <div class="space-y-4">
              ${slider('ie-brightness', 'Ljusstyrka', brightness, 0.2, 3.0, 0.05)}
              ${slider('ie-contrast',   'Kontrast',   contrast,   0.2, 3.0, 0.05)}
              ${slider('ie-saturation', 'Mättnad',    saturation, 0.0, 3.0, 0.05)}
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
            <p><strong class="text-slate-400">💾 Spara som kopia</strong> — ny fil, originalet rörs inte.</p>
            <p class="mt-1"><strong class="text-slate-400">⚠ Ersätt original</strong> — skriver över originalfilen permanent.</p>
          </div>
        </div>
      </div>

      <style>
        .ie-tool-btn{background:rgb(51 65 85);color:rgb(148 163 184);border:1px solid rgb(71 85 105);border-radius:.5rem;padding:.375rem .5rem;font-size:.875rem;cursor:pointer;transition:all .15s;white-space:nowrap;overflow:hidden}
        .ie-tool-btn:hover{background:rgb(71 85 105);color:white}
        .ie-tool-btn--active{background:rgb(37 99 235)!important;color:white!important;border-color:rgb(59 130 246)!important}
        .ie-action-btn{width:100%;text-align:left;background:rgb(51 65 85);color:rgb(148 163 184);border:1px solid rgb(71 85 105);border-radius:.5rem;padding:.5rem .75rem;font-size:.8125rem;cursor:pointer;transition:all .15s}
        .ie-action-btn:hover{background:rgb(71 85 105);color:white}
        .ie-action-btn--active{background:rgb(30 64 175);color:rgb(147 197 253);border-color:rgb(37 99 235)}
        input[type=range].ie-slider{width:100%;accent-color:rgb(59 130 246);cursor:pointer}
        .ie-handle{position:absolute;width:12px;height:12px;background:white;border:1.5px solid rgba(0,0,0,.4);border-radius:50%;z-index:12}
      </style>`;

    attachListeners();
  };

  // ── Selection HTML ─────────────────────────────────────────────────────────────
  function selHtml(r) {
    const x = Math.min(r.x1, r.x2), y = Math.min(r.y1, r.y2);
    const w = Math.abs(r.x2 - r.x1),  h = Math.abs(r.y2 - r.y1);
    const O = 6;
    const handles = [
      { d:'nw', s:`top:-${O}px;left:-${O}px;cursor:nw-resize` },
      { d:'n',  s:`top:-${O}px;left:calc(50% - ${O}px);cursor:n-resize` },
      { d:'ne', s:`top:-${O}px;right:-${O}px;cursor:ne-resize` },
      { d:'e',  s:`top:calc(50% - ${O}px);right:-${O}px;cursor:e-resize` },
      { d:'se', s:`bottom:-${O}px;right:-${O}px;cursor:se-resize` },
      { d:'s',  s:`bottom:-${O}px;left:calc(50% - ${O}px);cursor:s-resize` },
      { d:'sw', s:`bottom:-${O}px;left:-${O}px;cursor:sw-resize` },
      { d:'w',  s:`top:calc(50% - ${O}px);left:-${O}px;cursor:w-resize` },
    ].map(({ d, s }) => `<div class="ie-handle" data-handle="${d}" style="${s}"></div>`).join('');

    return `<div id="ie-crop-sel" style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;
      border:1.5px solid rgba(255,255,255,.9);box-shadow:0 0 0 9999px rgba(0,0,0,.52);
      cursor:move;z-index:10;box-sizing:border-box">
      <div style="position:absolute;inset:0;pointer-events:none">
        <div style="position:absolute;top:33.3%;left:0;right:0;height:1px;background:rgba(255,255,255,.22)"></div>
        <div style="position:absolute;top:66.6%;left:0;right:0;height:1px;background:rgba(255,255,255,.22)"></div>
        <div style="position:absolute;left:33.3%;top:0;bottom:0;width:1px;background:rgba(255,255,255,.22)"></div>
        <div style="position:absolute;left:66.6%;top:0;bottom:0;width:1px;background:rgba(255,255,255,.22)"></div>
      </div>
      ${handles}
    </div>`;
  }

  // ── Preview ───────────────────────────────────────────────────────────────────
  function previewStyle() {
    const t = [];
    if (rotation) t.push(`rotate(${rotation}deg)`);
    if (flipH) t.push('scaleX(-1)');
    if (flipV) t.push('scaleY(-1)');
    const f = [
      brightness !== 1 ? `brightness(${brightness})` : '',
      contrast   !== 1 ? `contrast(${contrast})` : '',
      saturation !== 1 ? `saturate(${saturation})` : '',
    ].filter(Boolean).join(' ');
    // Visa beskärningens förhandsvisning med clip-path när crop är bekräftad
    let clip = '';
    if (cropFinal && !cropMode) {
      const ct = (cropFinal.tp * 100).toFixed(2) + '%';
      const cr = ((1 - cropFinal.lp - cropFinal.wp) * 100).toFixed(2) + '%';
      const cb = ((1 - cropFinal.tp - cropFinal.hp) * 100).toFixed(2) + '%';
      const cl = (cropFinal.lp * 100).toFixed(2) + '%';
      clip = `clip-path:inset(${ct} ${cr} ${cb} ${cl} round 0px);`;
    }
    return `${t.length ? `transform:${t.join(' ')};` : ''}${f ? `filter:${f};` : ''}${clip}`;
  }

  function updatePreview() {
    const img = root.querySelector('#ie-preview');
    if (img) /** @type {HTMLElement} */ (img).style.cssText = previewStyle();
  }

  function slider(id, label, value, min, max, step) {
    const pct = Math.round((value - 1) * 100);
    return `<div>
      <div class="flex justify-between items-baseline mb-1">
        <label class="text-xs text-slate-300">${label}</label>
        <span id="${id}-val" class="text-xs text-slate-400 font-mono">${pct >= 0 ? '+' : ''}${pct}%</span>
      </div>
      <input id="${id}" type="range" class="ie-slider" min="${min}" max="${max}" step="${step}" value="${value}">
    </div>`;
  }

  // ── Crop logic ────────────────────────────────────────────────────────────────
  function imgEl() { return /** @type {HTMLImageElement} */ (root.querySelector('#ie-preview')); }

  function clampToImg(r) {
    const img = imgEl();
    const mw = img ? img.clientWidth  : 9999;
    const mh = img ? img.clientHeight : 9999;
    return {
      x1: Math.max(0, Math.min(r.x1, mw)),
      y1: Math.max(0, Math.min(r.y1, mh)),
      x2: Math.max(0, Math.min(r.x2, mw)),
      y2: Math.max(0, Math.min(r.y2, mh)),
    };
  }

  function updateSelEl() {
    const sel = /** @type {HTMLElement} */ (root.querySelector('#ie-crop-sel'));
    if (!sel || !cropRect) return;
    sel.style.left   = `${Math.min(cropRect.x1, cropRect.x2)}px`;
    sel.style.top    = `${Math.min(cropRect.y1, cropRect.y2)}px`;
    sel.style.width  = `${Math.abs(cropRect.x2 - cropRect.x1)}px`;
    sel.style.height = `${Math.abs(cropRect.y2 - cropRect.y1)}px`;
  }

  function injectSel() {
    root.querySelector('#ie-crop-sel')?.remove();
    root.querySelector('#ie-img-wrap')?.insertAdjacentHTML('beforeend', selHtml(cropRect));
    bindSelListeners();
  }

  function bindSelListeners() {
    const sel = root.querySelector('#ie-crop-sel');
    if (!sel) return;
    sel.addEventListener('mousedown', (e) => {
      const me = /** @type {MouseEvent} */ (e);
      if (/** @type {HTMLElement} */ (me.target).dataset.handle) return;
      me.preventDefault(); me.stopPropagation();
      beginDrag(me, 'move');
    });
    sel.querySelectorAll('[data-handle]').forEach((h) => {
      h.addEventListener('mousedown', (e) => {
        const me = /** @type {MouseEvent} */ (e);
        me.preventDefault(); me.stopPropagation();
        beginDrag(me, /** @type {HTMLElement} */ (h).dataset.handle ?? '');
      });
    });
  }

  function beginDrag(e, type) {
    dragType       = type;
    dragStartMouse = { x: e.clientX, y: e.clientY };
    dragStartRect  = cropRect ? { ...cropRect } : null;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
  }

  function onMouseMove(e) {
    const me = /** @type {MouseEvent} */ (e);
    const img = imgEl();
    if (!img) return;
    const ir = img.getBoundingClientRect();
    const dx = me.clientX - dragStartMouse.x;
    const dy = me.clientY - dragStartMouse.y;
    const mx = me.clientX - ir.left;
    const my = me.clientY - ir.top;

    if (dragType === 'draw') {
      cropRect = clampToImg({ x1: dragStartRect.x1, y1: dragStartRect.y1, x2: mx, y2: my });
      if (!root.querySelector('#ie-crop-sel')) { injectSel(); } else { updateSelEl(); }
    } else if (dragType === 'move' && dragStartRect) {
      const w = dragStartRect.x2 - dragStartRect.x1, h = dragStartRect.y2 - dragStartRect.y1;
      const nx1 = Math.max(0, Math.min(dragStartRect.x1 + dx, img.clientWidth  - w));
      const ny1 = Math.max(0, Math.min(dragStartRect.y1 + dy, img.clientHeight - h));
      cropRect = { x1: nx1, y1: ny1, x2: nx1 + w, y2: ny1 + h };
      updateSelEl();
    } else if (dragStartRect) {
      const r = { ...dragStartRect };
      const d = dragType;
      if (d.includes('n')) r.y1 = dragStartRect.y1 + dy;
      if (d.includes('s')) r.y2 = dragStartRect.y2 + dy;
      if (d.includes('w')) r.x1 = dragStartRect.x1 + dx;
      if (d.includes('e')) r.x2 = dragStartRect.x2 + dx;
      cropRect = clampToImg(r);
      updateSelEl();
    }
  }

  function onMouseUp() {
    dragType = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);
  }

  function confirmCrop() {
    if (!cropRect) return;
    const img = imgEl();
    if (!img) return;
    const dispW = img.clientWidth, dispH = img.clientHeight;
    if (dispW === 0 || dispH === 0) return;
    const x = Math.min(cropRect.x1, cropRect.x2), y = Math.min(cropRect.y1, cropRect.y2);
    const w = Math.abs(cropRect.x2 - cropRect.x1), h = Math.abs(cropRect.y2 - cropRect.y1);
    if (w < 4 || h < 4) { cropRect = null; cropMode = false; render(); return; }

    // Store as fractions of displayed image.
    // Since thumbnail preserves aspect ratio, fraction of display = fraction of original.
    cropFinal = { lp: x / dispW, tp: y / dispH, wp: w / dispW, hp: h / dispH };
    cropRect  = null;
    cropMode  = false;
    render();
  }

  // ── attachListeners ───────────────────────────────────────────────────────────
  function attachListeners() {
    root.querySelector('#ie-back')?.addEventListener('click', () => { onMouseUp(); root.remove(); });

    root.querySelector('#ie-crop-btn')?.addEventListener('click', () => {
      if (cropMode) { confirmCrop(); }
      else { cropMode = true; cropRect = null; render(); }
    });
    root.querySelector('#ie-crop-clear')?.addEventListener('click', () => {
      cropFinal = null; cropRect = null; cropMode = false; render();
    });

    // Start drawing on the transparent background layer
    root.querySelector('#ie-crop-bg')?.addEventListener('mousedown', (e) => {
      const me = /** @type {MouseEvent} */ (e);
      me.preventDefault();
      const img = imgEl();
      if (!img) return;
      const ir = img.getBoundingClientRect();
      const mx = me.clientX - ir.left, my = me.clientY - ir.top;
      cropRect      = { x1: mx, y1: my, x2: mx, y2: my };
      dragType      = 'draw';
      dragStartMouse = { x: me.clientX, y: me.clientY };
      dragStartRect  = { x1: mx, y1: my, x2: mx, y2: my };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup',   onMouseUp);
    });

    if (cropMode && cropRect) bindSelListeners();

    // Rotate & flip
    root.querySelector('#ie-rot-cw') ?.addEventListener('click', () => { rotation = (rotation + 90) % 360;       updatePreview(); });
    root.querySelector('#ie-rot-ccw')?.addEventListener('click', () => { rotation = (rotation - 90 + 360) % 360; updatePreview(); });
    root.querySelector('#ie-rot-180')?.addEventListener('click', () => { rotation = (rotation + 180) % 360;      updatePreview(); });
    root.querySelector('#ie-flip-h') ?.addEventListener('click', () => { flipH = !flipH; root.querySelector('#ie-flip-h')?.classList.toggle('ie-tool-btn--active', flipH); updatePreview(); });
    root.querySelector('#ie-flip-v') ?.addEventListener('click', () => { flipV = !flipV; root.querySelector('#ie-flip-v')?.classList.toggle('ie-tool-btn--active', flipV); updatePreview(); });

    const bindSlider = (id, setter) => {
      const el  = /** @type {HTMLInputElement} */ (root.querySelector(`#${id}`));
      const val = root.querySelector(`#${id}-val`);
      el?.addEventListener('input', () => {
        const v = parseFloat(el.value); setter(v);
        if (val) { const p = Math.round((v - 1) * 100); val.textContent = `${p >= 0 ? '+' : ''}${p}%`; }
        updatePreview();
      });
    };
    bindSlider('ie-brightness', (v) => { brightness = v; });
    bindSlider('ie-contrast',   (v) => { contrast   = v; });
    bindSlider('ie-saturation', (v) => { saturation = v; });

    root.querySelector('#ie-auto-enhance')?.addEventListener('click', () => {
      brightness = 1.05; contrast = 1.1; saturation = 1.05;
      const set = (id, v, label) => {
        const el = /** @type {HTMLInputElement} */ (root.querySelector(`#${id}`));
        const ve = root.querySelector(`#${id}-val`);
        if (el) el.value = String(v);
        if (ve) ve.textContent = label;
      };
      set('ie-brightness', 1.05, '+5%');
      set('ie-contrast',   1.1,  '+10%');
      set('ie-saturation', 1.05, '+5%');
      updatePreview();
    });

    root.querySelector('#ie-sharpen')?.addEventListener('click', () => {
      sharpenActive = !sharpenActive;
      root.querySelector('#ie-sharpen')?.classList.toggle('ie-action-btn--active', sharpenActive);
    });

    root.querySelector('#ie-reset')?.addEventListener('click', () => {
      rotation = 0; flipH = false; flipV = false;
      brightness = 1; contrast = 1; saturation = 1; sharpenActive = false;
      cropFinal = null; cropRect = null; cropMode = false;
      onMouseUp();
      render();
    });

    // ── Save ───────────────────────────────────────────────────────────────────
    const doSave = async (saveAs) => {
      if (isSaving) return;
      isSaving = true;
      const btnId = saveAs === 'copy' ? '#ie-save-copy' : '#ie-save-replace';
      const btn   = /** @type {HTMLButtonElement} */ (root.querySelector(btnId));
      const orig  = btn?.textContent ?? '';
      if (btn) { btn.textContent = 'Sparar…'; btn.disabled = true; }

      try {
        const ops = buildOperations();
        if (!ops.length) {
          toast('Inga ändringar att spara', 'info');
          isSaving = false;
          if (btn) { btn.textContent = orig; btn.disabled = false; }
          return;
        }
        const { data } = await api.editAsset(asset.id, { operations: ops, saveAs });

        if (saveAs === 'copy') {
          toast('Kopia sparad och tillagd i biblioteket!', 'success');
          window.dispatchEvent(new CustomEvent('pm:asset-added', { detail: { asset: data } }));
          onMouseUp();
          root.remove();
          // Original is unchanged — do NOT call onSaved
        } else {
          toast('Original ersatt!', 'success');
          onMouseUp();
          root.remove();
          onSaved?.(data);
        }
      } catch (e) {
        toast(/** @type {Error} */ (e).message, 'error');
        if (btn) { btn.textContent = orig; btn.disabled = false; }
        isSaving = false;
      }
    };

    root.querySelector('#ie-save-copy')?.addEventListener('click', () => doSave('copy'));
    root.querySelector('#ie-save-replace')?.addEventListener('click', async () => {
      const { confirm: dlg } = await import('../utils.js');
      if (await dlg('Ersätt originalet? Handlingen kan inte ångras.')) doSave('replace');
    });

    // Keyboard
    root.addEventListener('keydown', (e) => {
      const ke = /** @type {KeyboardEvent} */ (e);
      if (ke.key === 'Escape') {
        if (cropMode) { cropMode = false; cropRect = null; onMouseUp(); render(); }
        else { onMouseUp(); root.remove(); }
      }
      if (ke.key === 'Enter' && cropMode) { ke.preventDefault(); confirmCrop(); }
    });
    root.setAttribute('tabindex', '-1');
    root.focus();
  }

  // ── buildOperations ───────────────────────────────────────────────────────────
  function buildOperations() {
    const ops = [];
    // Crop stores fractions; backend multiplies by original image dimensions.
    if (cropFinal) ops.push({ type: 'crop', lp: cropFinal.lp, tp: cropFinal.tp, wp: cropFinal.wp, hp: cropFinal.hp });
    if (rotation)  ops.push({ type: 'rotate', angle: rotation });
    if (flipV)     ops.push({ type: 'flip' });
    if (flipH)     ops.push({ type: 'flop' });
    if (brightness !== 1 || saturation !== 1) {
      const m = {};
      if (brightness !== 1) m.brightness = brightness;
      if (saturation !== 1) m.saturation = saturation;
      ops.push({ type: 'modulate', ...m });
    }
    if (contrast !== 1) ops.push({ type: 'linear', a: contrast, b: -(128 * (contrast - 1)) });
    if (sharpenActive) ops.push({ type: 'sharpen' });
    return ops;
  }

  render();
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
