import { api } from '../api.js';
import { toast, formatDate, formatDateTime, isVideo } from '../utils.js';
import { state } from '../state.js';

let currentIndex = 0;
let items = [];

const lb          = document.getElementById('lightbox');
const lbImg       = document.getElementById('lb-img');
const lbVideo     = document.getElementById('lb-video');
const lbFaces     = document.getElementById('lb-faces');
const lbInfo      = document.getElementById('lb-info');
const lbMetaPanel = document.getElementById('lb-meta-panel');
const lbMetaCont  = document.getElementById('lb-meta-content');

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
  if (!isVid) loadFaceOverlays(asset.id);

  document.getElementById('lb-download').onclick = () => {
    window.location = `/api/assets/${asset.id}/original`;
  };

  if (!lbMetaPanel.classList.contains('hidden')) {
    loadInfoDrawer(asset.id);
  }
}

async function loadFaceOverlays(assetId) {
  try {
    const { data: faces } = await api.faces(assetId);
    if (!faces?.length) return;
    const _reloadFaces = () => loadFaceOverlays(assetId);
    faces.forEach((f, idx) => {
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
          <span class="face-name-label">${f.person_name ?? 'Okänd'}</span>
          <button class="face-delete-btn" title="Ta bort">✕</button>
        </div>`;
      lbFaces.appendChild(box);
    });
    initFaceOverlayInteractions(assetId, _reloadFaces);
  } catch {}
}

// ── Info Drawer ──────────────────────────────────────────────────────────────

document.getElementById('lb-info-btn').addEventListener('click', () => {
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

document.getElementById('lb-meta-close').addEventListener('click', () => {
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
      custom: buildFileSection(m.fileInfo),
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
        title="Lägg till ansiktstaggar" style="font-size:15px;line-height:1;font-weight:600">+</button>
        <button class="face-overlay-toggle flex-shrink-0 text-slate-400 hover:text-white transition-colors p-1 rounded"
        title="Visa/dölj ansiktsmarkeringar" style="font-size:14px;line-height:1">👁</button>`,
      custom: buildFacesSection(m.faces, m.fileInfo.thumbLargePath),
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

function buildAccordion({ id, icon, title, open, rows, custom, headerExtra }) {
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

function buildFileSection(fi) {
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

function buildFacesSection(faces, thumbPath) {
  if (!faces.length) {
    return `<p class="px-4 pb-2 text-xs text-slate-500 italic">Inga taggade personer</p>`;
  }

  return `<div class="px-4 pb-2 space-y-2">
    ${faces.map((f, idx) => {
      const thumbStyle = thumbPath ? faceThumbStyle(f.boundingBox, thumbPath) : '';
      return `
        <button data-person-id="${f.personId ?? ''}" data-person-name="${f.personName ?? ''}"
          data-face-index="${idx}"
          class="w-full flex items-center gap-3 bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-2 transition-colors text-left">
          <div class="w-12 h-12 rounded-lg flex-shrink-0 overflow-hidden bg-slate-700"
            ${thumbStyle ? `style="${thumbStyle}"` : ''}>
            ${!thumbStyle ? '<span class="flex items-center justify-center w-full h-full text-2xl">👤</span>' : ''}
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-sm text-white font-medium truncate">${f.personName ?? 'Okänd person'}</div>
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
      const isOpen = !body.classList.contains('hidden');
      body.classList.toggle('hidden', isOpen);
      chevron.classList.toggle('rotate-180', !isOpen);
    };
    section.querySelector('.accordion-trigger')?.addEventListener('click', toggle);
    section.querySelector('.accordion-trigger-chevron')?.addEventListener('click', toggle);
  });
}

function initDrawerInteractions(container, assetId, m) {
  // ── Kopiera till urklipp ─────────────────────────────────────────────────────
  container.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        toast('Kopierat!', 'success');
      } catch { toast('Kunde inte kopiera', 'error'); }
    });
  });

  // ── Rubrik & Kommentar (spara vid blur/Enter) ────────────────────────────────
  const titleEl = container.querySelector('#org-title');
  const descEl  = container.querySelector('#org-description');
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
  titleEl?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } });

  // ── Stjärnbetyg ──────────────────────────────────────────────────────────────
  let currentRating = m.organization.rating ?? 0;
  const stars = container.querySelectorAll('.star-btn');
  stars.forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      const n = parseInt(btn.dataset.star);
      stars.forEach(s => s.classList.toggle('text-yellow-400', parseInt(s.dataset.star) <= n));
      stars.forEach(s => s.classList.toggle('text-slate-600',  parseInt(s.dataset.star) >  n));
    });
    btn.addEventListener('mouseleave', () => {
      stars.forEach(s => {
        const active = parseInt(s.dataset.star) <= currentRating;
        s.classList.toggle('text-yellow-400', active);
        s.classList.toggle('text-slate-600',  !active);
      });
    });
    btn.addEventListener('click', async () => {
      const n = parseInt(btn.dataset.star);
      const newRating = n === currentRating ? null : n;
      try {
        await api.patchMeta(assetId, { rating: newRating });
        currentRating = newRating ?? 0;
        stars.forEach(s => {
          const active = parseInt(s.dataset.star) <= currentRating;
          s.classList.toggle('text-yellow-400', active);
          s.classList.toggle('text-slate-600',  !active);
        });
        toast(newRating ? `${newRating} stjärna${newRating > 1 ? 'r' : ''}` : 'Betyg borttaget', 'success');
      } catch { toast('Kunde inte spara betyg', 'error'); }
    });
  });

  // ── Ansiktsoverlay-toggle ────────────────────────────────────────────────────
  let facesVisible = true;
  const faceToggleBtn = container.querySelector('.face-overlay-toggle');
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

  // ── Person-klick + hover → highlight ansiktsbox ──────────────────────────────
  container.querySelectorAll('[data-person-id]').forEach(btn => {
    const faceIdx = btn.dataset.faceIndex;
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
      const personId = btn.dataset.personId;
      if (!personId || personId === 'undefined' || personId === 'null') return;
      closeLightbox();
      location.hash = `#/faces/${personId}`;
    });
  });

  // ── Datum-klick ──────────────────────────────────────────────────────────────
  container.querySelectorAll('[data-filter-date]').forEach(btn => {
    btn.addEventListener('click', () => {
      const dateFrom = btn.dataset.filterDate;
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
        window._pmMapGoto = { lat: gps.latitude, lon: gps.longitude, zoom: 15 };
      }
      closeLightbox();
      location.hash = '#/map';
    });
  });
}

// ── Face overlay: hover-edit (ta bort / byt person) ──────────────────────────

function initFaceOverlayInteractions(assetId, onChanged) {
  lbFaces.querySelectorAll('.face-box').forEach(box => {
    const faceId = box.dataset.faceId;
    if (!faceId) return;

    box.addEventListener('mouseenter', () => box.classList.add('face-hovered'));
    box.addEventListener('mouseleave', () => box.classList.remove('face-hovered'));

    box.querySelector('.face-rename-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const currentName = box.dataset.personName || '';
      showPersonSearchDialog(box, async (personId, personName) => {
        try {
          await api.patchFace(faceId, { personId, personName });
          onChanged();
        } catch { toast('Kunde inte byta person', 'error'); }
      }, currentName);
    });

    box.querySelector('.face-delete-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const snapshot = {
        faceId, assetId,
        personId:   box.dataset.personId   || null,
        personName: box.dataset.personName || null,
        regionX: parseFloat(box.style.left) / 100,
        regionY: parseFloat(box.style.top)  / 100,
        regionW: parseFloat(box.style.width) / 100,
        regionH: parseFloat(box.style.height) / 100,
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

function showUndoToast(message, onUndo) {
  const el = document.createElement('div');
  el.className = 'toast flex items-center gap-3 bg-slate-700 border border-slate-600 text-slate-200 text-sm px-4 py-2.5 rounded-lg shadow-lg';
  el.innerHTML = `<span class="flex-1">${message}</span>
    <button class="undo-btn text-blue-400 hover:text-blue-300 font-medium text-xs uppercase tracking-wide">Ångra</button>`;
  const container = document.getElementById('toast-container');
  container.appendChild(el);
  let cancelled = false;
  el.querySelector('.undo-btn').addEventListener('click', () => {
    cancelled = true;
    el.remove();
    onUndo();
  });
  setTimeout(() => { if (!cancelled) el.remove(); }, 3000);
}

// ── Face-ritning ─────────────────────────────────────────────────────────────

const lbMediaContainer = document.getElementById('lb-media-container');
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

function showPersonSearchDialog(anchorOrBox, onSelect, initialQuery = '', rectCoords = null) {
  document.querySelector('#pm-person-dialog')?.remove();

  const dialog = document.createElement('div');
  dialog.id = 'pm-person-dialog';
  dialog.className = 'fixed z-[200] bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-72 p-3';

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

  const input   = dialog.querySelector('#pm-person-search');
  const results = dialog.querySelector('#pm-person-results');
  input.focus();
  input.select();

  let allPersons = [];
  api.persons().then(({ data }) => { allPersons = data; renderResults(input.value); }).catch(() => {});

  const renderResults = (q) => {
    const filtered = q.trim()
      ? allPersons.filter(p => p.name.toLowerCase().includes(q.toLowerCase()))
      : allPersons.slice(0, 8);
    results.innerHTML = '';
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
      results.appendChild(el);
    });
    // "Skapa ny"-knapp om ingen matchning
    if (q.trim() && !filtered.some(p => p.name.toLowerCase() === q.trim().toLowerCase())) {
      const newBtn = document.createElement('button');
      newBtn.className = 'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-700 text-left transition-colors border border-dashed border-slate-600 mt-1';
      newBtn.innerHTML = `<span class="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center flex-shrink-0 text-base">+</span>
        <span class="text-sm text-slate-200">Skapa "<strong>${q.trim()}</strong>"</span>`;
      newBtn.addEventListener('click', () => { dialog.remove(); onSelect(null, q.trim()); });
      results.appendChild(newBtn);
    }
  };

  input.addEventListener('input', () => renderResults(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = input.value.trim();
      if (!q) return;
      const match = allPersons.find(p => p.name.toLowerCase() === q.toLowerCase());
      dialog.remove();
      onSelect(match?.id ?? null, q);
    }
    if (e.key === 'Escape') dialog.remove();
  });
  dialog.querySelector('#pm-person-cancel').addEventListener('click', () => dialog.remove());
  setTimeout(() => {
    const outside = (e) => { if (!dialog.contains(e.target)) { dialog.remove(); document.removeEventListener('mousedown', outside); } };
    document.addEventListener('mousedown', outside);
  }, 100);
}

// ── Övriga lightbox-kontroller ────────────────────────────────────────────────

document.getElementById('lb-favorite').addEventListener('click', async () => {
  const asset = items[currentIndex];
  if (!asset) return;
  try {
    await api.addFav(asset.id);
    toast('Tillagd som favorit', 'success');
  } catch { toast('Kunde inte lägga till favorit', 'error'); }
});

document.getElementById('lb-share').addEventListener('click', async () => {
  const asset = items[currentIndex];
  if (!asset) return;
  try {
    const { data } = await api.createShare({ shareType: 'public_link', assetId: asset.id });
    const url = `${location.origin}${data.publicUrl}`;
    await navigator.clipboard.writeText(url);
    toast('Delningslänk kopierad!', 'success');
  } catch { toast('Kunde inte skapa delningslänk', 'error'); }
});

document.getElementById('lb-prev').addEventListener('click', () => {
  if (currentIndex > 0) showItem(currentIndex - 1);
});
document.getElementById('lb-next').addEventListener('click', () => {
  if (currentIndex < items.length - 1) showItem(currentIndex + 1);
});

window.addEventListener('keydown', (e) => {
  if (!lb.classList.contains('open')) return;
  if (e.key === 'Escape')     closeLightbox();
  if (e.key === 'ArrowLeft')  { if (currentIndex > 0) showItem(currentIndex - 1); }
  if (e.key === 'ArrowRight') { if (currentIndex < items.length - 1) showItem(currentIndex + 1); }
});

lb.addEventListener('click', (e) => { if (e.target === lb) closeLightbox(); });
document.getElementById('lb-close').addEventListener('click', closeLightbox);
