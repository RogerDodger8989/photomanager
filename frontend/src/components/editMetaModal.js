import { api } from '../api.js';
import { toast } from '../utils.js';

let _resolve = null;

// opts: { takenAt, locationLabel, gpsLat, gpsLon, cameraModel }
export function openEditMetaModal(assetId, opts = {}) {
  document.getElementById('edit-meta-modal')?.remove();

  const { takenAt: currentTakenAt, locationLabel: currentLocationLabel,
          gpsLat: currentLat, gpsLon: currentLon, cameraModel: currentCameraModel } = opts;

  const dtValue = currentTakenAt
    ? new Date(currentTakenAt).toISOString().slice(0, 16)
    : '';

  const modal = document.createElement('div');
  modal.id = 'edit-meta-modal';
  modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" id="edit-meta-backdrop"></div>
    <div class="relative bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-4 border-b border-slate-700 flex-shrink-0">
        <h2 class="text-sm font-semibold text-white">Redigera metadata</h2>
        <button id="edit-meta-close" class="text-slate-400 hover:text-white transition-colors p-1 rounded">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <div class="px-5 py-4 space-y-5 overflow-y-auto flex-1">

        <!-- Datum & tid -->
        <div>
          <label class="block text-xs font-medium text-slate-400 mb-1.5">📅 Fotodatum</label>
          <input id="edit-meta-date" type="datetime-local" value="${dtValue}"
            class="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                   focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40
                   [color-scheme:dark]"/>
          <p class="text-xs text-slate-500 mt-1">Ändrar DateTimeOriginal i EXIF om ExifTool är installerat</p>
        </div>

        <!-- Kameramodell -->
        <div>
          <label class="block text-xs font-medium text-slate-400 mb-1.5">📷 Kameramodell</label>
          <input id="edit-meta-camera" type="text"
            placeholder="t.ex. Sony α7 IV eller lämna tomt"
            value="${currentCameraModel ?? ''}"
            class="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                   placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40"/>
          <p class="text-xs text-slate-500 mt-1">Sparas som XMP-override • skriver också till fil om ExifTool finns</p>
        </div>

        <!-- Plats — textsök -->
        <div>
          <label class="block text-xs font-medium text-slate-400 mb-1.5">📍 Plats</label>
          <div class="flex gap-2">
            <input id="edit-meta-location-input" type="text"
              placeholder="Sök stad, adress eller ort…"
              value="${currentLocationLabel ?? ''}"
              class="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                     placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40"/>
            <button id="edit-meta-search-btn"
              class="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg
                     transition-colors whitespace-nowrap flex items-center gap-1.5">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0"/>
              </svg>
              Sök
            </button>
          </div>

          <!-- Sökresultat -->
          <div id="edit-meta-results" class="mt-2 space-y-1 hidden"></div>

          <!-- Vald plats -->
          <div id="edit-meta-chosen" class="hidden mt-2 flex items-center gap-2 bg-green-900/30
               border border-green-700/50 rounded-lg px-3 py-2">
            <svg class="w-4 h-4 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
            <span id="edit-meta-chosen-label" class="text-xs text-green-300 flex-1"></span>
            <button id="edit-meta-clear-location" class="text-slate-500 hover:text-white transition-colors ml-auto">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>

          <!-- Karta -->
          <div class="mt-3">
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-xs text-slate-500">Klicka på kartan för att sätta exakt position</span>
              <button id="edit-meta-map-toggle" class="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                Visa karta ▾
              </button>
            </div>
            <div id="edit-meta-map-wrap" class="hidden">
              <div id="edit-meta-map" class="w-full rounded-lg overflow-hidden border border-slate-600"
                style="height: 200px; background: #1e293b;"></div>
              <p id="edit-meta-coords" class="text-xs text-slate-500 mt-1"></p>
            </div>
          </div>
        </div>

      </div>

      <!-- Footer -->
      <div class="flex justify-end gap-2 px-5 py-4 border-t border-slate-700 flex-shrink-0">
        <button id="edit-meta-cancel"
          class="px-4 py-2 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600
                 rounded-lg transition-colors">
          Avbryt
        </button>
        <button id="edit-meta-save"
          class="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500
                 rounded-lg transition-colors">
          Spara
        </button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  // State
  let chosenLat  = currentLat  ?? null;
  let chosenLon  = currentLon  ?? null;
  let chosenLabel = null;
  let searching  = false;
  let _leafletMap = null;
  let _marker    = null;

  const dateInput     = document.getElementById('edit-meta-date');
  const cameraInput   = document.getElementById('edit-meta-camera');
  const locInput      = document.getElementById('edit-meta-location-input');
  const searchBtn     = document.getElementById('edit-meta-search-btn');
  const resultsEl     = document.getElementById('edit-meta-results');
  const chosenEl      = document.getElementById('edit-meta-chosen');
  const chosenLabelEl = document.getElementById('edit-meta-chosen-label');
  const clearBtn      = document.getElementById('edit-meta-clear-location');
  const mapToggle     = document.getElementById('edit-meta-map-toggle');
  const mapWrap       = document.getElementById('edit-meta-map-wrap');
  const coordsEl      = document.getElementById('edit-meta-coords');

  function updateCoordsLabel(lat, lon) {
    if (lat != null && lon != null) {
      coordsEl.textContent = `${parseFloat(lat).toFixed(5)}, ${parseFloat(lon).toFixed(5)}`;
    } else {
      coordsEl.textContent = '';
    }
  }

  function showChosen(label) {
    chosenLabel = label;
    chosenLabelEl.textContent = label;
    chosenEl.classList.remove('hidden');
    resultsEl.classList.add('hidden');
    resultsEl.innerHTML = '';
  }

  function clearChosen() {
    chosenLat = chosenLon = chosenLabel = null;
    chosenEl.classList.add('hidden');
    updateCoordsLabel(null, null);
    if (_marker && _leafletMap) { _leafletMap.removeLayer(_marker); _marker = null; }
  }

  // ── Leaflet map ──────────────────────────────────────────────────────────────

  function loadLeaflet() {
    return new Promise((resolve) => {
      if (window.L) { resolve(); return; }
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = resolve;
      document.head.appendChild(script);
    });
  }

  async function initMap() {
    await loadLeaflet();
    const L = window.L;
    const lat = chosenLat ?? 59.33;
    const lon = chosenLon ?? 18.07;
    _leafletMap = L.map('edit-meta-map').setView([lat, lon], chosenLat != null ? 12 : 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(_leafletMap);

    if (chosenLat != null && chosenLon != null) {
      _marker = L.marker([chosenLat, chosenLon]).addTo(_leafletMap);
      updateCoordsLabel(chosenLat, chosenLon);
    }

    _leafletMap.on('click', (e) => {
      const { lat: mlat, lng: mlon } = e.latlng;
      chosenLat = mlat;
      chosenLon = mlon;
      updateCoordsLabel(mlat, mlon);
      if (_marker) _leafletMap.removeLayer(_marker);
      _marker = L.marker([mlat, mlon]).addTo(_leafletMap);
      // Reverse geocode to get label
      api.geocode(`${mlat},${mlon}`).then((res) => {
        const label = res.data?.[0]?.label ?? `${mlat.toFixed(4)}, ${mlon.toFixed(4)}`;
        chosenLabel = label;
        locInput.value = label;
        showChosen(label);
      }).catch(() => {
        chosenLabel = `${mlat.toFixed(4)}, ${mlon.toFixed(4)}`;
        locInput.value = chosenLabel;
        showChosen(chosenLabel);
      });
    });

    // Invalidate after CSS transition
    setTimeout(() => _leafletMap.invalidateSize(), 100);
  }

  mapToggle.addEventListener('click', () => {
    const hidden = mapWrap.classList.toggle('hidden');
    mapToggle.textContent = hidden ? 'Visa karta ▾' : 'Dölj karta ▴';
    if (!hidden && !_leafletMap) initMap();
  });

  // ── Geocode search ───────────────────────────────────────────────────────────

  async function doSearch() {
    const q = locInput.value.trim();
    if (!q || searching) return;
    searching = true;
    searchBtn.textContent = '…';
    try {
      const { data } = await api.geocode(q);
      resultsEl.innerHTML = '';
      if (!data?.length) {
        resultsEl.innerHTML = '<p class="text-xs text-slate-500 px-1">Inga träffar</p>';
        resultsEl.classList.remove('hidden');
        return;
      }
      resultsEl.classList.remove('hidden');
      data.slice(0, 5).forEach((r) => {
        const btn = document.createElement('button');
        btn.className = 'w-full text-left px-3 py-2 text-xs text-slate-200 bg-slate-700/60 hover:bg-slate-600 rounded-lg transition-colors';
        btn.textContent = r.displayName;
        btn.addEventListener('click', () => {
          chosenLat = r.lat;
          chosenLon = r.lon;
          locInput.value = r.label;
          showChosen(r.label);
          updateCoordsLabel(r.lat, r.lon);
          if (_leafletMap && window.L) {
            _leafletMap.setView([r.lat, r.lon], 13);
            if (_marker) _leafletMap.removeLayer(_marker);
            _marker = window.L.marker([r.lat, r.lon]).addTo(_leafletMap);
          }
        });
        resultsEl.appendChild(btn);
      });
    } finally {
      searching = false;
      searchBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0"/></svg> Sök`;
    }
  }

  searchBtn.addEventListener('click', doSearch);
  locInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  clearBtn.addEventListener('click', () => { clearChosen(); locInput.value = ''; });

  // ── Close / save ─────────────────────────────────────────────────────────────

  function close(result = null) {
    if (_leafletMap) { _leafletMap.remove(); _leafletMap = null; }
    modal.remove();
    if (_resolve) { _resolve(result); _resolve = null; }
  }

  document.getElementById('edit-meta-close').addEventListener('click',    () => close());
  document.getElementById('edit-meta-cancel').addEventListener('click',   () => close());
  document.getElementById('edit-meta-backdrop').addEventListener('click', () => close());

  document.getElementById('edit-meta-save').addEventListener('click', async () => {
    const saveBtn = document.getElementById('edit-meta-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Sparar…';

    try {
      let updatedTakenAt    = null;
      let updatedLabel      = currentLocationLabel;
      let updatedCameraModel = currentCameraModel ?? null;

      // Spara datum
      const newDate = dateInput.value;
      if (newDate && newDate !== dtValue) {
        const res = await api.setDatetime(assetId, new Date(newDate).toISOString());
        updatedTakenAt = res.data?.taken_at ?? null;
      }

      // Spara kameramodell
      const newModel = cameraInput.value.trim();
      if (newModel !== (currentCameraModel ?? '')) {
        await api.setCameraModel(assetId, newModel || null);
        updatedCameraModel = newModel || null;
      }

      // Spara plats
      if (chosenLat != null && chosenLon != null) {
        const label = (chosenLabel ?? locInput.value.trim()) || null;
        await api.setLocation(assetId, chosenLat, chosenLon, label);
        updatedLabel = label;
      } else if (locInput.value.trim() === '' && currentLocationLabel) {
        await api.setLocation(assetId, null, null, null);
        updatedLabel = null;
      }

      toast('Sparad!', 'success');
      close({
        takenAt:      updatedTakenAt,
        locationLabel: updatedLabel,
        lat:          chosenLat,
        lon:          chosenLon,
        cameraModel:  updatedCameraModel,
      });
    } catch (err) {
      toast('Kunde inte spara: ' + (err.message ?? 'Okänt fel'), 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Spara';
    }
  });

  return new Promise((resolve) => { _resolve = resolve; });
}
