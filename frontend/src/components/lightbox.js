import { api } from '../api.js';
import { toast, formatDate, formatDateTime, isVideo } from '../utils.js';
import { state } from '../state.js';
import { openAddToAlbumModal } from '../views/albums.js';
import { openShareModal } from './shareModal.js';
import { openImageEditor } from './imageEditor.js';

let currentIndex = 0;
let items = [];
let isFav = false;

// ── Zoom-state ────────────────────────────────────────────────────────────────
let zoomLevel = 1;
let panX = 0;
let panY = 0;
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const ZOOM_STEP = 0.25;

const lb              = /** @type {HTMLElement} */ (document.getElementById('lightbox'));
const lbImg           = /** @type {HTMLImageElement} */ (document.getElementById('lb-img'));
const lbVideo         = /** @type {HTMLVideoElement} */ (document.getElementById('lb-video'));
const lbFaces         = /** @type {HTMLElement} */ (document.getElementById('lb-faces'));
const lbInfo          = /** @type {HTMLElement} */ (document.getElementById('lb-info'));
const lbMetaPanel     = /** @type {HTMLElement} */ (document.getElementById('lb-meta-panel'));
const lbMetaCont      = /** @type {HTMLElement} */ (document.getElementById('lb-meta-content'));
const lbMediaArea     = /** @type {HTMLElement} */ (document.getElementById('lb-media-area'));
const lbZoomLabel     = /** @type {HTMLElement} */ (document.getElementById('lb-zoom-label'));

const DRAWER_KEY = 'pm-drawer-open';

export function openLightbox(assetItems, startIndex = 0) {
  _openLightboxInternal(assetItems, startIndex);
  sessionStorage.setItem('pm_lb_items', JSON.stringify(assetItems));
  sessionStorage.setItem('pm_lb_index', String(startIndex));
  history.pushState({ pm_lightbox: true }, '', location.hash);
}

function _openLightboxInternal(assetItems, startIndex) {
  items        = assetItems;
  currentIndex = startIndex;
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
  showItem(currentIndex);

  if (localStorage.getItem(DRAWER_KEY) === '1') {
    lbMetaPanel.classList.remove('hidden');
    loadInfoDrawer(assetItems[startIndex].id);
  }
}

window.addEventListener('popstate', (e) => {
  if (e.state?.pm_lightbox) {
    const savedItems = JSON.parse(sessionStorage.getItem('pm_lb_items') || '[]');
    const savedIndex = parseInt(sessionStorage.getItem('pm_lb_index') || '0', 10);
    if (savedItems.length) {
      _openLightboxInternal(savedItems, savedIndex);
      history.pushState({ pm_lightbox: true }, '', location.hash);
    }
  } else if (lb.classList.contains('open')) {
    closeLightbox();
  }
});

export function closeLightbox() {
  lb.classList.remove('open');
  document.body.style.overflow = '';
  lbVideo.pause();
  lbVideo.src = '';
  lbMetaPanel.classList.add('hidden');
  resetZoom();
  window.dispatchEvent(new CustomEvent('lightbox:closed'));
}

function resetZoom() {
  zoomLevel = 1; panX = 0; panY = 0;
  applyZoom();
}

function applyZoom() {
  const container = document.getElementById('lb-media-container');
  if (!container) return;
  container.style.transform = zoomLevel === 1
    ? ''
    : `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
  container.style.transformOrigin = '0 0';
  container.style.cursor = zoomLevel > 1 ? 'grab' : '';
  if (lbMediaArea) lbMediaArea.style.cursor = zoomLevel > 1 ? 'grab' : '';
  if (lbZoomLabel) lbZoomLabel.textContent = `${Math.round(zoomLevel * 100)}%`;
}

function zoomBy(delta, originX, originY) {
  const container = document.getElementById('lb-media-container');
  if (!container) return;
  const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomLevel + delta));
  if (newZoom === zoomLevel) return;

  // Justera pan så att zoom sker mot en punkt
  const scale = newZoom / zoomLevel;
  panX = originX - scale * (originX - panX);
  panY = originY - scale * (originY - panY);
  zoomLevel = newZoom;

  // Klamp pan så bilden inte drar iväg utanför
  if (zoomLevel <= 1) { panX = 0; panY = 0; }
  applyZoom();
}

function showItem(idx) {
  const asset = items[idx];
  if (!asset) return;
  currentIndex = idx;

  const isVid = isVideo(asset.mime_type);
  lbImg.classList.toggle('hidden',  isVid);
  lbVideo.classList.toggle('hidden', !isVid);

  if (isVid) {
    lbVideo.src = `/api/assets/${asset.id}/stream`;
    lbVideo.load();
  } else {
    lbImg.src = `/thumbs/${asset.thumb_large_path ?? asset.thumb_small_path}`;
    lbImg.alt = asset.file_name;
  }

  const dateStr = asset.taken_at ? formatDate(asset.taken_at) : '';
  const loc     = asset.location_label ? ` · ${asset.location_label}` : '';
  lbInfo.textContent = `${dateStr}${loc}`;

  lbFaces.innerHTML = '';
  if (!isVid) loadFaceOverlays(asset.id, asset.taken_at);

  const dlBtn = document.getElementById('lb-download');
  if (dlBtn) dlBtn.onclick = () => {
    window.location.href = `/api/assets/${asset.id}/original`;
  };

  resetZoom();

  // Favorit-state
  isFav = !!(asset.is_favorite);
  updateFavBtn();

  if (!lbMetaPanel.classList.contains('hidden')) {
    loadInfoDrawer(asset.id);
  }
}

async function loadFaceOverlays(assetId, takenAt) {
  try {
    const { data: faces } = await api.faces(assetId);
    if (!faces?.length) return;
    const _reloadFaces = () => loadFaceOverlays(assetId, takenAt);
    const photoYear = takenAt ? new Date(takenAt).getFullYear() : null;
    faces.forEach((f, idx) => {
      const age = (f.birth_year && photoYear != null) ? photoYear - f.birth_year : null;
      const label = f.person_name
        ? (age !== null && age >= 0 ? `${f.person_name} (${age} år)` : f.person_name)
        : 'Okänd';
      const box = document.createElement('div');
      box.className = 'face-box';
      box.dataset.faceIndex  = idx;
      box.dataset.faceId     = f.id;
      box.dataset.personId   = f.person_id   ?? '';
      box.dataset.personName = f.person_name ?? '';
      box.style.left   = `${f.region_x * 100}%`;
      box.style.top    = `${f.region_y * 100}%`;
      box.style.width  = `${f.region_w * 100}%`;
      box.style.height = `${f.region_h * 100}%`;
      box.innerHTML = `
        <div class="face-edit-bar">
          <button class="face-rename-btn" title="Byt person">✏️</button>
          <span class="face-name-label">${label}</span>
          <button class="face-delete-btn" title="Ta bort">✕</button>
        </div>`;
      lbFaces.appendChild(box);
    });
    initFaceOverlayInteractions(assetId, _reloadFaces);
  } catch {}
}

// ── Info Drawer ──────────────────────────────────────────────────────────────

document.getElementById('lb-info-btn')?.addEventListener('click', () => {
  const asset = items[currentIndex];
  if (!asset) return;
  const isOpen = !lbMetaPanel.classList.contains('hidden');
  if (isOpen) {
    lbMetaPanel.classList.add('hidden');
    localStorage.setItem(DRAWER_KEY, '0');
    return;
  }
  lbMetaPanel.classList.remove('hidden');
  localStorage.setItem(DRAWER_KEY, '1');
  loadInfoDrawer(asset.id);
});

document.getElementById('lb-meta-close')?.addEventListener('click', () => {
  lbMetaPanel.classList.add('hidden');
  localStorage.setItem(DRAWER_KEY, '0');
});

async function loadInfoDrawer(assetId) {
  lbMetaCont.innerHTML = `
    <div class="flex items-center justify-center h-32 text-slate-500 text-sm">
      <svg class="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
      </svg>
      Laddar metadata…
    </div>`;

  try {
    const { data: m } = await api.assetMetadata(assetId);
    lbMetaCont.innerHTML = buildDrawerHTML(m);
    initAccordions(lbMetaCont);
    initDrawerInteractions(lbMetaCont, assetId, m);
    // Ladda om face-overlays så nyskapade faces syns direkt
    lbFaces.innerHTML = '';
    loadFaceOverlays(assetId);
  } catch (err) {
    lbMetaCont.innerHTML = `
      <div class="p-4 text-red-400 text-sm">Kunde inte ladda metadata: ${err.message}</div>`;
  }
}

// ── HTML-bygge ───────────────────────────────────────────────────────────────

function buildDrawerHTML(m) {
  const sections = [
    {
      id: 'file',
      icon: '📄',
      title: 'Allmän info',
      open: true,
      custom: buildFileSection(m.fileInfo, m.albums ?? []),
    },
    {
      id: 'temporal',
      icon: '📍',
      title: 'Tid & Plats',
      open: true,
      custom: buildTemporalSection(m.temporalSpatial),
    },
    {
      id: 'org',
      icon: '🏷️',
      title: 'Innehåll & Organisering',
      open: true,
      custom: buildOrgSection(m.organization),
    },
    {
      id: 'faces',
      icon: '👤',
      title: `Ansikten & Personer${m.faces.length ? ` (${m.faces.length})` : ''}`,
      open: true,
      headerExtra: `<button class="face-add-btn flex-shrink-0 text-slate-400 hover:text-white transition-colors p-1 rounded"
        title="Lägg till ansiktstaggar manuellt" style="font-size:15px;line-height:1;font-weight:600">+</button>
        <button class="face-overlay-toggle flex-shrink-0 text-slate-400 hover:text-white transition-colors p-1 rounded"
        title="Visa/dölj ansiktsmarkeringar" style="font-size:14px;line-height:1">👁</button>
        <button class="face-reindex-btn flex-shrink-0 text-slate-400 hover:text-blue-400 transition-colors p-1 rounded"
        title="Kör om AI-ansiktsanalys för denna bild" style="font-size:13px;line-height:1">🔄</button>`,
      custom: buildFacesSection(m.faces, m.fileInfo.thumbLargePath, m.temporalSpatial.capturedAt),
    },
    {
      id: 'camera',
      icon: '📷',
      title: 'Kamera & Exponering',
      open: false,
      rows: [
        ['Tillverkare',  m.camera.make],
        ['Kameramodell', m.camera.model],
        ['Lins',         m.camera.lens],
        ['Slutartid',    m.camera.shutterSpeed],
        ['Bländare',     m.camera.aperture],
        ['ISO',          m.camera.iso],
        ['Brännvidd',    m.camera.focalLength],
        ['Blixt',        m.camera.flash],
      ],
    },
    {
      id: 'system',
      icon: '⚙️',
      title: 'System & Verktyg',
      open: false,
      custom: buildSystemSection(m.system),
    },
  ];

  return sections.map(s => buildAccordion(s)).join('');
}

/**
 * @param {{ id: any, icon: any, title: any, open: any, rows?: any[], custom?: string, headerExtra?: string }} param0
 */
function buildAccordion({ id, icon, title, open, rows = [], custom, headerExtra = '' }) {
  const bodyContent = custom ?? buildRowList(rows ?? []);
  return `
    <div class="border-b border-slate-800" data-accordion="${id}">
      <div class="flex items-center">
        <button class="accordion-trigger flex-1 flex items-center gap-2 px-4 py-3 text-left hover:bg-slate-800/50 transition-colors min-w-0">
          <span class="text-base leading-none flex-shrink-0">${icon}</span>
          <span class="flex-1 text-sm font-medium text-slate-200 truncate">${title}</span>
        </button>
        ${headerExtra ? `<div class="flex items-center pr-1">${headerExtra}</div>` : ''}
        <button class="accordion-trigger-chevron flex-shrink-0 px-3 py-3 hover:bg-slate-800/50 transition-colors">
          <svg class="accordion-chevron w-4 h-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}"
               fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </button>
      </div>
      <div class="accordion-body ${open ? '' : 'hidden'} pb-2">
        ${bodyContent}
      </div>
    </div>`;
}

function buildRowList(rows) {
  const visible = rows.filter(([, v]) => v != null && v !== '');
  if (!visible.length) return `<p class="px-4 pb-2 text-xs text-slate-500 italic">Ingen data</p>`;
  return visible.map(([label, value]) => `
    <div class="px-4 py-1.5 grid grid-cols-[6.5rem_1fr] gap-2 items-start">
      <span class="text-xs text-slate-500 leading-5 truncate">${label}</span>
      <span class="text-xs text-slate-200 leading-5 break-all">${value}</span>
    </div>`).join('');
}

function buildFileSection(fi, albums = []) {
  const copyBtn = (text) => `
    <button data-copy="${text}" title="Kopiera"
      class="flex-shrink-0 text-slate-500 hover:text-white transition-colors mt-0.5">
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2"/>
      </svg>
    </button>`;
  return `
    <div class="px-4 pb-2 space-y-1.5">
      <div class="grid grid-cols-[6.5rem_1fr] gap-2 items-start">
        <span class="text-xs text-slate-500 leading-5">Filnamn</span>
        <div class="flex items-start gap-1 min-w-0">
          <span class="text-xs text-slate-200 leading-5 break-all flex-1">${fi.fileName}</span>
          ${copyBtn(fi.fileName)}
        </div>
      </div>
      ${fi.fileSize ? row('Filstorlek', fi.fileSize) : ''}
      ${fi.dimensions ? row('Bildstorlek', fi.dimensions) : ''}
      ${fi.megaPixels ? row('Megapixel', fi.megaPixels) : ''}
      ${fi.mimeType ? row('Format', fi.mimeType) : ''}
      ${fi.uploadedBy ? row('Uppladdad av', fi.uploadedBy) : ''}
      ${fi.folderPath ? `
      <div class="grid grid-cols-[6.5rem_1fr] gap-2 items-start">
        <span class="text-xs text-slate-500 leading-5">Mapp</span>
        <div class="flex items-start gap-1 min-w-0">
          <span class="text-xs text-slate-200 leading-5 break-all flex-1">${fi.folderPath}</span>
          ${copyBtn(fi.folderPath)}
        </div>
      </div>` : ''}
      ${albums.length ? `
      <div class="grid grid-cols-[6.5rem_1fr] gap-2 items-start">
        <span class="text-xs text-slate-500 leading-5">Album</span>
        <div class="flex flex-wrap gap-x-2 gap-y-0.5">
          ${albums.map(al => `<button data-album-nav="${al.id}" class="text-xs text-blue-400 hover:text-blue-300 hover:underline transition-colors text-left leading-5">${al.name}</button>`).join('')}
        </div>
      </div>` : ''}
    </div>`;
}

function row(label, value) {
  return `
    <div class="grid grid-cols-[6.5rem_1fr] gap-2 items-start">
      <span class="text-xs text-slate-500 leading-5 truncate">${label}</span>
      <span class="text-xs text-slate-200 leading-5 break-all">${value}</span>
    </div>`;
}

function buildOrgSection(org) {
  const chips = (org.keywords ?? []).map(k =>
    `<span class="inline-block bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded-full">${k}</span>`
  ).join(' ');

  return `
    <div class="px-4 space-y-2.5 pb-2">
      <div>
        <label class="text-xs text-slate-500 block mb-1">Rubrik</label>
        <input id="org-title" type="text" value="${(org.title ?? '').replace(/"/g, '&quot;')}"
          placeholder="Lägg till rubrik…"
          class="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500 placeholder-slate-600">
      </div>
      <div>
        <label class="text-xs text-slate-500 block mb-1">Kommentar</label>
        <textarea id="org-description" rows="3" placeholder="Lägg till kommentar…"
          class="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500 placeholder-slate-600 resize-none">${org.description ?? ''}</textarea>
      </div>
      <div class="grid grid-cols-[6.5rem_1fr] gap-2 items-center">
        <span class="text-xs text-slate-500">Betyg</span>
        <div class="flex gap-0.5" id="star-rating">
          ${[1,2,3,4,5].map(n => `
            <button data-star="${n}" class="star-btn text-xl leading-none transition-colors
              ${n <= (org.rating ?? 0) ? 'text-yellow-400' : 'text-slate-600'}"
              title="${n} stjärna${n > 1 ? 'r' : ''}">★</button>`
          ).join('')}
        </div>
      </div>
      ${chips ? `<div>
        <div class="text-xs text-slate-500 mb-1.5">Nyckelord</div>
        <div class="flex flex-wrap gap-1">${chips}</div>
      </div>` : ''}
    </div>`;
}

function buildFacesSection(faces, thumbPath, capturedAt) {
  if (!faces.length) {
    return `<p class="px-4 pb-2 text-xs text-slate-500 italic">Inga taggade personer</p>`;
  }
  const photoYear = capturedAt ? new Date(capturedAt).getFullYear() : null;

  return `<div class="px-4 pb-2 space-y-2">
    ${faces.map((f, idx) => {
      const thumbStyle = thumbPath ? faceThumbStyle(f.boundingBox, thumbPath) : '';
      const age = (f.birthYear && photoYear != null) ? photoYear - f.birthYear : null;
      const ageLabel = (age !== null && age >= 0) ? ` (${age} år)` : '';
      return `
        <button data-person-id="${f.personId ?? ''}" data-person-name="${f.personName ?? ''}"
          data-face-index="${idx}"
          class="w-full flex items-center gap-3 bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-2 transition-colors text-left">
          <div class="w-12 h-12 rounded-lg flex-shrink-0 overflow-hidden bg-slate-700"
            ${thumbStyle ? `style="${thumbStyle}"` : ''}>
            ${!thumbStyle ? '<span class="flex items-center justify-center w-full h-full text-2xl">👤</span>' : ''}
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-sm text-white font-medium truncate">${f.personName ?? 'Okänd person'}${ageLabel}</div>
            <div class="text-xs text-blue-400">Visa alla bilder →</div>
          </div>
        </button>`;
    }).join('')}
  </div>`;
}

function faceThumbStyle(bb, thumbPath) {
  if (!bb || !thumbPath) return '';
  const padding = 2.0;
  const scale   = (1 / (bb.width || 0.3)) * padding;
  const bpx     = ((bb.x + bb.width  / 2) * 100).toFixed(1);
  const bpy     = ((bb.y + bb.height / 2) * 100).toFixed(1);
  return `background-image:url('/thumbs/${thumbPath}');background-size:${(scale * 100).toFixed(0)}%;background-position:${bpx}% ${bpy}%;background-repeat:no-repeat;background-color:#1e293b`;
}

function buildTemporalSection(ts) {
  const date = ts.capturedAt ? new Date(ts.capturedAt) : null;
  const dateStr = date ? formatDateTime(ts.capturedAt) : null;
  const year    = date?.getFullYear();
  const dateFrom = date ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}` : null;

  const city    = ts.location?.city;
  const region  = ts.location?.region;
  const country = ts.location?.country;

  return `
    <div class="px-4 pb-2 space-y-1.5">
      ${dateStr ? `
        <div class="grid grid-cols-[6.5rem_1fr] gap-2 items-start">
          <span class="text-xs text-slate-500 leading-5">Fotodatum</span>
          <button data-filter-date="${dateFrom}" data-filter-year="${year}"
            class="text-xs text-blue-400 hover:text-blue-300 hover:underline text-left leading-5 transition-colors">
            ${dateStr}
          </button>
        </div>` : ''}
      ${ts.gps?.latitude != null ? `
        <div class="grid grid-cols-[6.5rem_1fr] gap-2 items-center">
          <span class="text-xs text-slate-500">GPS</span>
          <div class="flex items-center gap-1">
            <span class="text-xs text-slate-200 font-mono">${ts.gps.latitude.toFixed(6)}, ${ts.gps.longitude.toFixed(6)}</span>
            <button data-copy="${ts.gps.latitude.toFixed(6)}, ${ts.gps.longitude.toFixed(6)}" title="Kopiera GPS"
              class="flex-shrink-0 text-slate-500 hover:text-white transition-colors">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2"/>
              </svg>
            </button>
          </div>
        </div>` : ''}
      ${city ? `
        <div class="grid grid-cols-[6.5rem_1fr] gap-2 items-start">
          <span class="text-xs text-slate-500 leading-5">Stad</span>
          <button data-filter-location="${city}"
            class="text-xs text-blue-400 hover:text-blue-300 hover:underline text-left leading-5 transition-colors">
            ${city}
          </button>
        </div>` : ''}
      ${region ? row('Region', region) : ''}
      ${country ? row('Land', country) : ''}
      ${!dateStr && !city && !region && !country && !ts.gps
        ? '<p class="text-xs text-slate-500 italic">Ingen tid/plats-data</p>' : ''}
    </div>`;
}

function buildSystemSection(sys) {
  const dupWarning = sys.duplicatesCount > 0
    ? `<div class="flex items-center gap-2 bg-yellow-900/40 border border-yellow-700 rounded-lg px-3 py-2 mt-2">
         <span class="text-yellow-400">⚠️</span>
         <span class="text-xs text-yellow-300">${sys.duplicatesCount} duplikat hittades i biblioteket</span>
       </div>`
    : '';

  const sharedInfo = (sys.sharedWith ?? []).length > 0
    ? sys.sharedWith.map(s =>
        `<span class="inline-block bg-blue-900 text-blue-300 text-xs px-2 py-0.5 rounded-full">${s.sharedWith ?? s.shareType}</span>`
      ).join(' ')
    : '<span class="text-xs text-slate-500">Inte delad</span>';

  return `
    <div class="px-4 pb-2 space-y-2">
      <div class="grid grid-cols-[6.5rem_1fr] gap-2 items-center">
        <span class="text-xs text-slate-500">Visningar</span>
        <span class="text-xs text-slate-200">${sys.viewCount}</span>
      </div>
      <div class="grid grid-cols-[6.5rem_1fr] gap-2 items-start">
        <span class="text-xs text-slate-500 leading-5">Delad med</span>
        <div class="flex flex-wrap gap-1">${sharedInfo}</div>
      </div>
      <div class="grid grid-cols-[6.5rem_1fr] gap-2 items-start">
        <span class="text-xs text-slate-500 leading-5">Duplikat</span>
        <span class="text-xs ${sys.duplicatesCount > 0 ? 'text-yellow-400' : 'text-green-400'}">${sys.duplicatesCount > 0 ? `${sys.duplicatesCount} st` : 'Inga'}</span>
      </div>
      ${sys.indexedAt ? `<div class="grid grid-cols-[6.5rem_1fr] gap-2">
        <span class="text-xs text-slate-500 leading-5">Indexerad</span>
        <span class="text-xs text-slate-200">${formatDateTime(sys.indexedAt)}</span>
      </div>` : ''}
      ${sys.checksum ? `<div class="mt-2">
        <div class="text-xs text-slate-500 mb-1">SHA-256</div>
        <div class="text-xs text-slate-400 font-mono break-all bg-slate-800 rounded px-2 py-1">${sys.checksum}</div>
      </div>` : ''}
      ${dupWarning}
    </div>`;
}

// ── Accordion + interaktioner ─────────────────────────────────────────────────

function initAccordions(container) {
  container.querySelectorAll('[data-accordion]').forEach(section => {
    const body    = section.querySelector('.accordion-body');
    const chevron = section.querySelector('.accordion-chevron');
    const toggle  = () => {
      if (!body || !chevron) return;
      const isOpen = !body.classList.contains('hidden');
      body.classList.toggle('hidden', isOpen);
      chevron.classList.toggle('rotate-180', !isOpen);
    };
    section.querySelector('.accordion-trigger')?.addEventListener('click', toggle);
    section.querySelector('.accordion-trigger-chevron')?.addEventListener('click', toggle);
  });
}

function initDrawerInteractions(container, assetId, m) {
  // ── Album-navigering ─────────────────────────────────────────────────────────
  container.querySelectorAll('[data-album-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      const albumId = /** @type {HTMLElement} */ (btn).dataset.albumNav;
      closeLightbox();
      location.hash = `#/albums/${albumId}`;
    });
  });

  // ── Kopiera till urklipp ─────────────────────────────────────────────────────
  container.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(/** @type {HTMLElement} */ (btn).dataset.copy ?? '');
        toast('Kopierat!', 'success');
      } catch { toast('Kunde inte kopiera', 'error'); }
    });
  });

  // ── Rubrik & Kommentar (spara vid blur/Enter) ────────────────────────────────
  const titleEl = /** @type {HTMLInputElement|null} */ (container.querySelector('#org-title'));
  const descEl  = /** @type {HTMLTextAreaElement|null} */ (container.querySelector('#org-description'));
  let saveTimer;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await api.patchMeta(assetId, {
          title:       titleEl?.value.trim() || null,
          description: descEl?.value.trim()  || null,
        });
      } catch { toast('Kunde inte spara', 'error'); }
    }, 800);
  };
  titleEl?.addEventListener('input', scheduleSave);
  descEl?.addEventListener('input', scheduleSave);
  titleEl?.addEventListener('keydown', e => { if (/** @type {KeyboardEvent} */ (e).key === 'Enter') { e.preventDefault(); titleEl.blur(); } });

  // ── Stjärnbetyg ──────────────────────────────────────────────────────────────
  let currentRating = m.organization.rating ?? 0;
  const stars = container.querySelectorAll('.star-btn');
  stars.forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      const n = parseInt(/** @type {HTMLElement} */ (btn).dataset.star ?? '0');
      stars.forEach(s => s.classList.toggle('text-yellow-400', parseInt(/** @type {HTMLElement} */ (s).dataset.star ?? '0') <= n));
      stars.forEach(s => s.classList.toggle('text-slate-600',  parseInt(/** @type {HTMLElement} */ (s).dataset.star ?? '0') >  n));
    });
    btn.addEventListener('mouseleave', () => {
      stars.forEach(s => {
        const active = parseInt(/** @type {HTMLElement} */ (s).dataset.star ?? '0') <= currentRating;
        s.classList.toggle('text-yellow-400', active);
        s.classList.toggle('text-slate-600',  !active);
      });
    });
    btn.addEventListener('click', async () => {
      const n = parseInt(/** @type {HTMLElement} */ (btn).dataset.star ?? '0');
      const newRating = n === currentRating ? null : n;
      try {
        await api.patchMeta(assetId, { rating: newRating });
        currentRating = newRating ?? 0;
        stars.forEach(s => {
          const active = parseInt(/** @type {HTMLElement} */ (s).dataset.star ?? '0') <= currentRating;
          s.classList.toggle('text-yellow-400', active);
          s.classList.toggle('text-slate-600',  !active);
        });
        toast(newRating ? `${newRating} stjärna${newRating > 1 ? 'r' : ''}` : 'Betyg borttaget', 'success');
      } catch { toast('Kunde inte spara betyg', 'error'); }
    });
  });

  // ── Ansiktsoverlay-toggle ────────────────────────────────────────────────────
  let facesVisible = true;
  const faceToggleBtn = /** @type {HTMLElement|null} */ (container.querySelector('.face-overlay-toggle'));
  if (faceToggleBtn) {
    faceToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      facesVisible = !facesVisible;
      faceToggleBtn.style.opacity = facesVisible ? '1' : '0.4';
      lbFaces.querySelectorAll('.face-box').forEach(box => {
        if (!box.classList.contains('face-highlight')) {
          box.classList.toggle('hidden', !facesVisible);
        }
      });
    });
  }

  // ── + Lägg till ansikt (rita ruta på bilden) ─────────────────────────────────
  const faceAddBtn = container.querySelector('.face-add-btn');
  if (faceAddBtn) {
    faceAddBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startFaceDrawMode(assetId, () => loadInfoDrawer(assetId));
    });
  }

  // ── 🔄 Kör om AI-ansiktsanalys för denna bild ────────────────────────────────
  const faceReindexBtn = /** @type {HTMLElement|null} */ (container.querySelector('.face-reindex-btn'));
  if (faceReindexBtn) {
    // Kontrollera om AI är aktiv — grå ut och inaktivera om inte
    api.aiStatus().then(({ data }) => {
      if (!data.available) {
        faceReindexBtn.style.opacity = '0.3';
        faceReindexBtn.style.cursor  = 'not-allowed';
        faceReindexBtn.title = 'AI-ansiktsigenkänning är inte aktiv (InsightFace körs inte)';
        faceReindexBtn.dataset.disabled = 'true';
      }
    }).catch(() => {
      faceReindexBtn.style.opacity = '0.3';
      faceReindexBtn.dataset.disabled = 'true';
    });

    faceReindexBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (faceReindexBtn.dataset.running === 'true') return;
      if (faceReindexBtn.dataset.disabled === 'true') {
        toast('AI-ansiktsigenkänning är inte aktiv — starta InsightFace-tjänsten', 'error');
        return;
      }
      faceReindexBtn.dataset.running = 'true';
      const orig = faceReindexBtn.textContent;
      faceReindexBtn.textContent = '⏳';
      faceReindexBtn.title = 'Analyserar…';
      try {
        await api.aiReindex(assetId);
        toast('AI-analys startad — ansikten uppdateras inom kort', 'success');
        // Vänta 4 s så InsightFace hinner bearbeta, ladda sedan om drawer + overlays
        setTimeout(() => loadInfoDrawer(assetId), 4000);
      } catch (err) {
        toast(`Kunde inte starta re-analys: ${err.message}`, 'error');
      } finally {
        faceReindexBtn.textContent = orig;
        faceReindexBtn.title = 'Kör om AI-ansiktsanalys för denna bild';
        faceReindexBtn.dataset.running = 'false';
      }
    });
  }

  // ── Person-klick + hover → highlight ansiktsbox ──────────────────────────────
  container.querySelectorAll('[data-person-id]').forEach(btn => {
    const faceIdx = /** @type {HTMLElement} */ (btn).dataset.faceIndex;
    btn.addEventListener('mouseenter', () => {
      const box = lbFaces.querySelector(`[data-face-index="${faceIdx}"]`);
      if (box) { box.classList.remove('hidden'); box.classList.add('face-highlight'); }
    });
    btn.addEventListener('mouseleave', () => {
      const box = lbFaces.querySelector(`[data-face-index="${faceIdx}"]`);
      if (box) {
        box.classList.remove('face-highlight');
        if (!facesVisible) box.classList.add('hidden');
      }
    });
    btn.addEventListener('click', () => {
      const personId = /** @type {HTMLElement} */ (btn).dataset.personId;
      if (!personId || personId === 'undefined' || personId === 'null') return;
      closeLightbox();
      location.hash = `#/faces/${personId}`;
    });
  });

  // ── Datum-klick ──────────────────────────────────────────────────────────────
  container.querySelectorAll('[data-filter-date]').forEach(btn => {
    btn.addEventListener('click', () => {
      const dateFrom = /** @type {HTMLElement} */ (btn).dataset.filterDate;
      if (!dateFrom) return;
      closeLightbox();
      window.dispatchEvent(new CustomEvent('pm:timeline-filter', {
        detail: { dateFrom: `${dateFrom}T00:00:00`, dateTo: `${dateFrom}T23:59:59` },
      }));
    });
  });

  // ── Stad-klick ───────────────────────────────────────────────────────────────
  container.querySelectorAll('[data-filter-location]').forEach(btn => {
    btn.addEventListener('click', () => {
      const gps = m.temporalSpatial?.gps;
      if (gps?.latitude != null) {
        /** @type {any} */ (window)._pmMapGoto = { lat: gps.latitude, lon: gps.longitude, zoom: 15 };
      }
      closeLightbox();
      location.hash = '#/map';
    });
  });
}

// ── Face overlay: hover-edit (ta bort / byt person) ──────────────────────────

function initFaceOverlayInteractions(assetId, onChanged) {
  lbFaces.querySelectorAll('.face-box').forEach(box => {
    const hBox = /** @type {HTMLElement} */ (box);
    const faceId = hBox.dataset.faceId;
    if (!faceId) return;

    box.addEventListener('mouseenter', () => box.classList.add('face-hovered'));
    box.addEventListener('mouseleave', () => box.classList.remove('face-hovered'));

    box.querySelector('.face-rename-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const currentName = hBox.dataset.personName || '';
      showPersonSearchDialog(hBox, async (personId, personName) => {
        try {
          const oldPersonId = hBox.dataset.personId || null;
          await api.patchFace(faceId, { personId, personName });
          window.dispatchEvent(new CustomEvent('pm:face-reassigned', {
            detail: { faceId, assetId, oldPersonId, newPersonId: personId },
          }));
          onChanged();
        } catch { toast('Kunde inte byta person', 'error'); }
      }, currentName);
    });

    box.querySelector('.face-delete-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const snapshot = {
        faceId, assetId,
        personId:   hBox.dataset.personId   || null,
        personName: hBox.dataset.personName || null,
        regionX: parseFloat(hBox.style.left) / 100,
        regionY: parseFloat(hBox.style.top)  / 100,
        regionW: parseFloat(hBox.style.width) / 100,
        regionH: parseFloat(hBox.style.height) / 100,
      };
      try {
        await api.deleteFace(faceId);
        box.remove();
        showUndoToast(`Ansikt borttaget${snapshot.personName ? ` (${snapshot.personName})` : ''}`, async () => {
          try {
            await api.createFace({
              assetId:  snapshot.assetId,
              personId: snapshot.personId ?? undefined,
              personName: snapshot.personId ? undefined : snapshot.personName ?? undefined,
              regionX: snapshot.regionX,
              regionY: snapshot.regionY,
              regionW: snapshot.regionW,
              regionH: snapshot.regionH,
            });
            onChanged();
          } catch { toast('Kunde inte ångra', 'error'); }
        });
      } catch { toast('Kunde inte ta bort ansikt', 'error'); }
    });
  });
}

export function showUndoToast(message, onUndo) {
  const el = document.createElement('div');
  el.className = 'toast flex items-center gap-3 bg-slate-700 border border-slate-600 text-slate-200 text-sm px-4 py-2.5 rounded-lg shadow-lg';
  el.innerHTML = `<span class="flex-1">${message}</span>
    <button class="undo-btn text-blue-400 hover:text-blue-300 font-medium text-xs uppercase tracking-wide">Ångra</button>`;
  const container = document.getElementById('toast-container');
  container?.appendChild(el);
  let cancelled = false;
  el.querySelector('.undo-btn')?.addEventListener('click', () => {
    cancelled = true;
    el.remove();
    onUndo();
  });
  setTimeout(() => { if (!cancelled) el.remove(); }, 3000);
}

// ── Face-ritning ─────────────────────────────────────────────────────────────

const lbMediaContainer = /** @type {HTMLElement} */ (document.getElementById('lb-media-container'));
let _drawCleanup = null;

function startFaceDrawMode(assetId, onCreated) {
  if (_drawCleanup) { _drawCleanup(); _drawCleanup = null; }

  // Overlay läggs direkt på media-containern (INTE inuti lbFaces som har pointer-events:none)
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:0;cursor:crosshair;z-index:30;user-select:none;';
  lbMediaContainer.appendChild(overlay);

  // Förhindra att bilden dras av webbläsaren
  lbImg.setAttribute('draggable', 'false');

  toast('Dra en ruta runt ansiktet — Esc för att avbryta', 'info', 3000);

  let startX = null, startY = null, dragging = false, rect = null;

  // Koordinater relativt till overlay (= bildens synliga area)
  const getRelPos = (e) => {
    const r = overlay.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height)),
    };
  };

  const onDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    dragging = true;
    const p = getRelPos(e);
    startX = p.x; startY = p.y;
    if (rect) rect.remove();
    rect = document.createElement('div');
    rect.style.cssText = 'position:absolute;border:2px dashed #f59e0b;background:rgba(245,158,11,.08);pointer-events:none;z-index:31;box-sizing:border-box;';
    overlay.appendChild(rect);
  };

  // Mousemove och mouseup på document för att fånga drag utanför overlay
  const onMove = (e) => {
    if (!dragging || !rect || startX == null) return;
    e.preventDefault();
    const p = getRelPos(e);
    const x = Math.min(startX, p.x), y = Math.min(startY, p.y);
    const w = Math.abs(p.x - startX),  h = Math.abs(p.y - startY);
    rect.style.left   = `${x * 100}%`;
    rect.style.top    = `${y * 100}%`;
    rect.style.width  = `${w * 100}%`;
    rect.style.height = `${h * 100}%`;
  };

  const onUp = (e) => {
    if (!dragging || startX == null) return;
    dragging = false;
    const p = getRelPos(e);
    const rx = Math.min(startX, p.x), ry = Math.min(startY, p.y);
    const rw = Math.abs(p.x - startX),  rh = Math.abs(p.y - startY);
    startX = null;
    if (rw < 0.02 || rh < 0.02) { rect?.remove(); rect = null; return; }
    cleanup();
    showPersonSearchDialog(null, async (personId, personName) => {
      rect?.remove(); rect = null;
      try {
        await api.createFace({
          assetId,
          personId:   personId  || undefined,
          personName: personId  ? undefined : (personName || undefined),
          regionX: rx, regionY: ry, regionW: rw, regionH: rh,
        });
        onCreated();
      } catch { toast('Kunde inte spara ansikt', 'error'); }
    }, '', { x: rx, y: ry, w: rw, h: rh });
  };

  overlay.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);

  const cleanup = () => {
    overlay.removeEventListener('mousedown', onDown);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    overlay.remove();
    lbImg.removeAttribute('draggable');
    _drawCleanup = null;
  };
  _drawCleanup = cleanup;

  const onEsc = (e) => {
    if (e.key === 'Escape') {
      cleanup(); rect?.remove(); rect = null;
      window.removeEventListener('keydown', onEsc);
    }
  };
  window.addEventListener('keydown', onEsc);
}

// ── Person-sökdialog ─────────────────────────────────────────────────────────

/**
 * @param {HTMLElement|null} anchorOrBox
 * @param {function} onSelect
 * @param {string} [initialQuery]
 * @param {{ x: number, y: number, w: number, h: number }|null} [rectCoords]
 */
function showPersonSearchDialog(anchorOrBox, onSelect, initialQuery = '', rectCoords = null) {
  document.querySelector('#pm-person-dialog')?.remove();

  const dialog = document.createElement('div');
  dialog.id = 'pm-person-dialog';
  dialog.className = 'fixed z-[9500] bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-72 p-3';

  // Positionera dialogen
  if (rectCoords) {
    const cr = lbMediaContainer.getBoundingClientRect();
    const cx = cr.left + (rectCoords.x + rectCoords.w / 2) * cr.width;
    const cy = cr.top  + (rectCoords.y + rectCoords.h)     * cr.height + 8;
    dialog.style.left = `${Math.max(8, Math.min(cx - 144, window.innerWidth - 300))}px`;
    dialog.style.top  = `${Math.min(cy, window.innerHeight - 280)}px`;
  } else if (anchorOrBox) {
    const r = anchorOrBox.getBoundingClientRect();
    dialog.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 300))}px`;
    dialog.style.top  = `${r.bottom + 6}px`;
  } else {
    dialog.style.left = '50%';
    dialog.style.top  = '30%';
    dialog.style.transform = 'translateX(-50%)';
  }

  dialog.innerHTML = `
    <div class="text-xs text-slate-400 mb-2 font-medium">Vem är det?</div>
    <input id="pm-person-search" type="text" value="${initialQuery}"
      placeholder="Sök eller skriv nytt namn…"
      class="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500 mb-2">
    <div id="pm-person-results" class="space-y-1 max-h-44 overflow-y-auto"></div>
    <button id="pm-person-cancel" class="mt-2 w-full text-xs text-slate-500 hover:text-slate-300 text-center py-1">Avbryt</button>`;

  document.body.appendChild(dialog);

  const input   = /** @type {HTMLInputElement|null} */ (dialog.querySelector('#pm-person-search'));
  const results = dialog.querySelector('#pm-person-results');
  input?.focus();
  input?.select();

  let allPersons = [];
  api.persons().then(({ data }) => { allPersons = data; renderResults(input?.value ?? ''); }).catch(() => {});

  const renderResults = (q) => {
    const filtered = q.trim()
      ? allPersons.filter(p => p.name.toLowerCase().includes(q.toLowerCase()))
      : allPersons.slice(0, 8);
    if (results) results.innerHTML = '';
    filtered.forEach(p => {
      const el = document.createElement('button');
      el.className = 'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-700 text-left transition-colors';
      el.innerHTML = `
        ${p.cover_thumb
          ? `<img src="/thumbs/${p.cover_thumb}" class="w-8 h-8 rounded-full object-cover flex-shrink-0">`
          : `<div class="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center flex-shrink-0 text-base">👤</div>`}
        <span class="text-sm text-slate-200 truncate">${p.name}</span>
        <span class="ml-auto text-xs text-slate-500">${p.photo_count} bilder</span>`;
      el.addEventListener('click', () => { dialog.remove(); onSelect(p.id, p.name); });
      results?.appendChild(el);
    });
    // "Skapa ny"-knapp om ingen matchning
    if (q.trim() && !filtered.some(p => p.name.toLowerCase() === q.trim().toLowerCase())) {
      const newBtn = document.createElement('button');
      newBtn.className = 'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-700 text-left transition-colors border border-dashed border-slate-600 mt-1';
      newBtn.innerHTML = `<span class="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center flex-shrink-0 text-base">+</span>
        <span class="text-sm text-slate-200">Skapa "<strong>${q.trim()}</strong>"</span>`;
      newBtn.addEventListener('click', () => { dialog.remove(); onSelect(null, q.trim()); });
      results?.appendChild(newBtn);
    }
  };

  input?.addEventListener('input', () => renderResults(input.value));
  input?.addEventListener('keydown', (e) => {
    if (/** @type {KeyboardEvent} */ (e).key === 'Enter') {
      const q = input.value.trim();
      if (!q) return;
      const match = allPersons.find(p => p.name.toLowerCase() === q.toLowerCase());
      dialog.remove();
      onSelect(match?.id ?? null, q);
    }
    if (/** @type {KeyboardEvent} */ (e).key === 'Escape') dialog.remove();
  });
  dialog.querySelector('#pm-person-cancel')?.addEventListener('click', () => dialog.remove());
  setTimeout(() => {
    const outside = (e) => { if (!dialog.contains(/** @type {Node} */ (e.target))) { dialog.remove(); document.removeEventListener('mousedown', outside); } };
    document.addEventListener('mousedown', outside);
  }, 100);
}

// ── Favorit-hjälp ────────────────────────────────────────────────────────────
function updateFavBtn() {
  const btn = document.getElementById('lb-favorite');
  if (!btn) return;
  btn.title = isFav ? 'Ta bort från favoriter' : 'Lägg till som favorit';
  btn.querySelector('svg')?.setAttribute('fill', isFav ? 'currentColor' : 'none');
  btn.classList.toggle('text-yellow-400', isFav);
  btn.classList.toggle('text-slate-400', !isFav);
}

// ── Övriga lightbox-kontroller ────────────────────────────────────────────────

document.getElementById('lb-back')?.addEventListener('click', closeLightbox);

document.getElementById('lb-add-album')?.addEventListener('click', () => {
  const asset = items[currentIndex];
  if (!asset) return;
  openAddToAlbumModal([asset.id]);
});

document.getElementById('lb-favorite')?.addEventListener('click', async () => {
  const asset = items[currentIndex];
  if (!asset) return;
  try {
    if (isFav) {
      await api.removeFav(asset.id);
      isFav = false;
      toast('Borttagen från favoriter', 'success');
    } else {
      await api.addFav(asset.id);
      isFav = true;
      toast('Tillagd som favorit', 'success');
    }
    updateFavBtn();
  } catch { toast('Kunde inte uppdatera favorit', 'error'); }
});

document.getElementById('lb-edit')?.addEventListener('click', () => {
  const asset = items[currentIndex];
  if (!asset) return;
  openImageEditor(asset, (updated) => {
    // Uppdatera thumbnails i lightbox efter redigering
    if (updated && updated.thumb_large_path) {
      const cacheBust = `?t=${Date.now()}`;
      lbImg.src = `/thumbs/${updated.thumb_large_path}${cacheBust}`;
      items[currentIndex] = { ...items[currentIndex], ...updated };
    }
  });
});

document.getElementById('lb-share')?.addEventListener('click', () => {
  const asset = items[currentIndex];
  if (!asset) return;
  openShareModal({ assetId: asset.id, name: asset.file_name });
});

document.getElementById('lb-prev')?.addEventListener('click', () => {
  if (currentIndex > 0) showItem(currentIndex - 1);
});
document.getElementById('lb-next')?.addEventListener('click', () => {
  if (currentIndex < items.length - 1) showItem(currentIndex + 1);
});

// ── Zoom-kontroller ───────────────────────────────────────────────────────────
document.getElementById('lb-zoom-in')?.addEventListener('click', () => {
  const container = document.getElementById('lb-media-container');
  const rect = container?.getBoundingClientRect();
  const cx = rect ? rect.width / 2 : 0;
  const cy = rect ? rect.height / 2 : 0;
  zoomBy(ZOOM_STEP, cx, cy);
});
document.getElementById('lb-zoom-out')?.addEventListener('click', () => {
  const container = document.getElementById('lb-media-container');
  const rect = container?.getBoundingClientRect();
  const cx = rect ? rect.width / 2 : 0;
  const cy = rect ? rect.height / 2 : 0;
  zoomBy(-ZOOM_STEP, cx, cy);
});
document.getElementById('lb-zoom-reset')?.addEventListener('click', resetZoom);

// Drag-to-pan
if (lbMediaArea) {
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;
  let panStartX = 0, panStartY = 0;

  lbMediaArea.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || zoomLevel <= 1) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    panStartX  = panX;
    panStartY  = panY;
    lbMediaArea.style.cursor = 'grabbing';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panX = panStartX + (e.clientX - dragStartX);
    panY = panStartY + (e.clientY - dragStartY);
    applyZoom();
  });

  window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    lbMediaArea.style.cursor = zoomLevel > 1 ? 'grab' : '';
  });
}

// Scroll-zoom mot muspekaren
if (lbMediaArea) {
  lbMediaArea.addEventListener('wheel', (e) => {
    if (!lb.classList.contains('open')) return;
    e.preventDefault();
    const container = document.getElementById('lb-media-container');
    const rect = container?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    // Normalisera deltaY (pixlar/rad/sida → enhetsoberoende), cap vid 0.3 per event
    const normalized = Math.min(Math.abs(e.deltaY) / 300, 0.3);
    const delta = e.deltaY < 0 ? normalized : -normalized;
    zoomBy(delta, mouseX, mouseY);
  }, { passive: false });
}

window.addEventListener('keydown', (e) => {
  if (!lb.classList.contains('open')) return;
  if (e.key === 'Escape')     { closeLightbox(); return; }
  if (e.key === 'Delete')     { trashCurrentInLightbox(); return; }
  if (e.key === 'ArrowLeft')  { if (currentIndex > 0) showItem(currentIndex - 1); }
  if (e.key === 'ArrowRight') { if (currentIndex < items.length - 1) showItem(currentIndex + 1); }
  if (e.key === '+' || e.key === '=') zoomBy(ZOOM_STEP, 0, 0);
  if (e.key === '-') zoomBy(-ZOOM_STEP, 0, 0);
  if (e.key === '0') resetZoom();
});

async function trashCurrentInLightbox() {
  const asset = items[currentIndex];
  if (!asset) return;

  // Optimistisk UI: ta bort ur listan och navigera direkt
  const removedIndex = currentIndex;
  const removedAsset = asset;
  items.splice(removedIndex, 1);

  if (items.length === 0) {
    closeLightbox();
  } else {
    showItem(Math.min(removedIndex, items.length - 1));
  }

  try {
    await api.trash(removedAsset.id);
  } catch (err) {
    // Återställ vid fel
    items.splice(removedIndex, 0, removedAsset);
    if (!lb.classList.contains('open')) {
      lb.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    showItem(removedIndex);
    toast('Kunde inte radera: ' + err.message, 'error');
    return;
  }

  // Meddela gridvyer att ta bort bilden ur listan
  window.dispatchEvent(new CustomEvent('pm:asset-trashed', { detail: { id: removedAsset.id } }));

  showUndoToast(
    `"${removedAsset.file_name}" raderad`,
    async () => {
      try {
        await api.restore(removedAsset.id);
        // Sätt tillbaka i lightbox-listan
        items.splice(removedIndex, 0, removedAsset);
        if (!lb.classList.contains('open')) {
          lb.classList.add('open');
          document.body.style.overflow = 'hidden';
        }
        showItem(removedIndex);
        // Meddela gridvyer att lägga tillbaka bilden
        window.dispatchEvent(new CustomEvent('pm:asset-restored', { detail: { asset: removedAsset, index: removedIndex } }));
      } catch (err) {
        toast('Kunde inte ångra: ' + err.message, 'error');
      }
    },
  );
}

lb?.addEventListener('click', (e) => { if (e.target === lb) closeLightbox(); });
document.getElementById('lb-close')?.addEventListener('click', closeLightbox);
