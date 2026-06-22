import { api } from '../api.js';
import { openLightbox } from '../components/lightbox.js';

const _w = /** @type {any} */ (window);

let leafletMap  = null;
let markerGroup = null;
let _debTimer   = null;

export function renderMap(container) {
  container.innerHTML = `<div id="leaflet-map" class="w-full h-full" style="position:relative;"></div>`;

  requestAnimationFrame(async () => {
    const L = _w.L;
    if (leafletMap) {
      leafletMap.remove();
      leafletMap = null;
    }

    leafletMap = L.map('leaflet-map', {
      center: [20, 10],
      zoom: 3,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(leafletMap);

    markerGroup = L.layerGroup();
    leafletMap.addLayer(markerGroup);

    leafletMap.on('moveend', () => {
      clearTimeout(_debTimer);
      _debTimer = setTimeout(loadClusters, 250);
    });

    // Stäng panel vid klick på kartan
    leafletMap.on('click', closeClusterPanel);

    if (_w._pmMapGoto) {
      const { lat, lon, zoom } = _w._pmMapGoto;
      _w._pmMapGoto = null;
      leafletMap.setView([lat, lon], zoom ?? 12);
    } else {
      // Auto-centrera till där fotona faktiskt finns
      try {
        const { data: ext } = await api.mapExtent();
        if (ext?.total > 0) {
          leafletMap.fitBounds(
            [[ext.min_lat, ext.min_lon], [ext.max_lat, ext.max_lon]],
            { padding: [40, 40], maxZoom: 8 }
          );
          return; // fitBounds triggar moveend → loadClusters
        }
      } catch {}
    }

    loadClusters();
  });
}

async function loadClusters() {
  if (!leafletMap) return;
  const L = _w.L;
  const bounds = leafletMap.getBounds();
  const zoom   = leafletMap.getZoom();

  try {
    const { data } = await api.clusters({
      minLat: bounds.getSouth(),
      maxLat: bounds.getNorth(),
      minLon: bounds.getWest(),
      maxLon: bounds.getEast(),
      zoom,
    });

    markerGroup.clearLayers();

    updateTruncationBadge(false, 0, 0);

    if (data.type === 'clusters') {
      data.items.forEach((cluster) => {
        const size  = Math.max(32, Math.min(20 + Math.log2(cluster.count) * 5, 60));
        const label = cluster.count >= 1000
          ? Math.round(cluster.count / 1000) + 'k'
          : String(cluster.count);
        const fontSize = size < 40 ? 11 : 13;

        const thumbHtml = cluster.sampleThumb
          ? `<img src="/thumbs/${cluster.sampleThumb}"
                  style="position:absolute;inset:0;width:100%;height:100%;
                         object-fit:cover;opacity:0.45;border-radius:50%;">`
          : '';

        const icon = L.divIcon({
          className: '',
          html: `<div style="width:${size}px;height:${size}px;border-radius:50%;
                   background:rgba(59,130,246,0.85);border:2px solid #93c5fd;
                   display:flex;align-items:center;justify-content:center;
                   color:#fff;font-weight:700;font-size:${fontSize}px;
                   box-shadow:0 2px 8px rgba(0,0,0,.6);position:relative;overflow:hidden;">
                   ${thumbHtml}
                   <span style="position:relative;z-index:1;text-shadow:0 1px 3px rgba(0,0,0,.8);">${label}</span>
                 </div>`,
          iconSize:   [size, size],
          iconAnchor: [size / 2, size / 2],
        });

        const marker = L.marker([cluster.lat, cluster.lon], { icon });
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          if (cluster.count === 1) {
            openAsset(cluster.sampleAssetId);
          } else {
            showClusterPanel(cluster, zoom);
          }
        });
        markerGroup.addLayer(marker);
      });
    } else {
      updateTruncationBadge(data.truncated, data.items.length, data.total);
      // Individuella assets vid hög zoom
      data.items.forEach((asset) => {
        const icon = L.divIcon({
          className: '',
          html: `<div class="w-10 h-10 rounded overflow-hidden border-2 border-blue-400 shadow-lg">
                   <img src="/thumbs/${asset.thumb_small_path}" class="w-full h-full object-cover">
                 </div>`,
          iconSize:   [40, 40],
          iconAnchor: [20, 40],
        });
        const marker = L.marker([asset.lat, asset.lon], { icon });
        marker.on('click', () => openAsset(asset.id));
        markerGroup.addLayer(marker);
      });
    }
  } catch (err) {
    console.error('Kartladdning misslyckades:', err);
  }
}

// ── Kluster-panel ─────────────────────────────────────────────────────────────

function closeClusterPanel() {
  document.getElementById('cluster-panel')?.remove();
}

async function showClusterPanel(cluster, zoom) {
  closeClusterPanel();

  const L = _w.L;
  const mapEl = document.getElementById('leaflet-map');
  if (!mapEl) return;

  const radiusMeters = zoomToRadius(zoom);

  const panel = document.createElement('div');
  panel.id = 'cluster-panel';
  panel.style.cssText = `position:absolute;bottom:0;left:0;right:0;z-index:1000;
    background:rgba(15,23,42,0.96);backdrop-filter:blur(8px);
    border-top:1px solid rgba(255,255,255,.1);padding:10px 12px;`;
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <span id="cp-info" style="color:#94a3b8;font-size:12px;">Laddar bilder…</span>
      <button id="cp-zoom" style="margin-left:auto;padding:4px 10px;border-radius:6px;
        background:#3b82f6;color:#fff;font-size:12px;border:none;cursor:pointer;">
        Zooma in →
      </button>
      <button id="cp-close" style="padding:4px 8px;border-radius:6px;
        background:rgba(255,255,255,.1);color:#fff;font-size:12px;border:none;cursor:pointer;">
        ✕
      </button>
    </div>
    <div id="cp-strip" style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;"></div>`;
  mapEl.appendChild(panel);
  L.DomEvent.disableClickPropagation(panel);

  panel.querySelector('#cp-close')?.addEventListener('click', closeClusterPanel);
  panel.querySelector('#cp-zoom')?.addEventListener('click', () => {
    leafletMap.flyTo([cluster.lat, cluster.lon], Math.min(zoom + 6, 18), { animate: true });
  });

  const strip = /** @type {HTMLElement | null} */ (panel.querySelector('#cp-strip'));
  const info  = /** @type {HTMLElement | null} */ (panel.querySelector('#cp-info'));

  let offset = 0;
  /** @type {Array<any>} */
  const allPhotos = [];

  async function loadPage() {
    try {
      const { data } = await api.clusterPhotos({ lat: cluster.lat, lon: cluster.lon, radiusMeters, offset });
      const { rows, hasMore } = data;

      if (!rows?.length && allPhotos.length === 0) {
        if (info) info.textContent = 'Inga bilder hittades.';
        return;
      }

      rows.forEach((photo) => {
        allPhotos.push(photo);
        const img = document.createElement('img');
        img.src = `/thumbs/${photo.thumb_small_path}`;
        img.style.cssText = `width:72px;height:72px;object-fit:cover;border-radius:6px;
          cursor:pointer;flex-shrink:0;border:2px solid transparent;transition:border-color .15s;`;
        img.addEventListener('mouseenter', () => { img.style.borderColor = '#3b82f6'; });
        img.addEventListener('mouseleave', () => { img.style.borderColor = 'transparent'; });
        img.addEventListener('click', () => openLightbox(allPhotos, allPhotos.indexOf(photo)));
        if (strip) strip.appendChild(img);
      });

      offset += rows.length;
      if (info) info.textContent = `${allPhotos.length}${hasMore ? '+' : ''} bilder i detta område`;

      panel.querySelector('#cp-load-more')?.remove();
      if (hasMore) {
        const btn = document.createElement('button');
        btn.id = 'cp-load-more';
        btn.textContent = 'Ladda fler';
        btn.style.cssText = `display:block;margin-top:8px;padding:4px 14px;border-radius:6px;
          background:rgba(255,255,255,.12);color:#e2e8f0;font-size:12px;border:none;cursor:pointer;`;
        btn.addEventListener('click', loadPage);
        panel.appendChild(btn);
      }
    } catch {
      if (info) info.textContent = 'Kunde inte ladda bilder.';
    }
  }

  await loadPage();
}

function updateTruncationBadge(truncated, shown, total) {
  const mapEl = document.getElementById('leaflet-map');
  if (!mapEl) return;
  let badge = document.getElementById('map-truncation-badge');
  if (truncated) {
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'map-truncation-badge';
      badge.style.cssText = 'position:absolute;bottom:28px;left:50%;transform:translateX(-50%);z-index:1000;background:rgba(0,0,0,0.72);color:#fff;font-size:12px;padding:4px 14px;border-radius:999px;pointer-events:none;white-space:nowrap;';
      mapEl.appendChild(badge);
    }
    badge.textContent = `Visar ${shown} av ${total} bilder i vyn — zooma in för att se fler`;
    badge.style.display = '';
  } else if (badge) {
    badge.style.display = 'none';
  }
}

async function openAsset(assetId) {
  try {
    // api.asset() returnerar ett nested objekt — bygg ett flat asset-objekt för lightboxen
    const { data } = await api.asset(assetId);
    const flat = {
      id:               data.assetId,
      file_name:        data.fileInfo?.fileName,
      mime_type:        data.fileInfo?.mimeType,
      thumb_small_path: null,
      thumb_large_path: data.fileInfo?.thumbLargePath ?? null,
      taken_at:         data.temporalSpatial?.capturedAt ?? null,
      duration:         data.fileInfo?.duration ?? null,
      is_motion_photo:  false,
    };
    openLightbox([flat], 0);
  } catch {}
}

function zoomToRadius(zoom) {
  return Math.round(5_000_000 / Math.pow(2, zoom));
}

export function destroyMap() {
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
  }
}
