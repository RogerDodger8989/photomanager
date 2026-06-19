import { api } from '../api.js';
import { openLightbox } from '../components/lightbox.js';

let leafletMap  = null;
let markerGroup = null;

export function renderMap(container) {
  container.innerHTML = `<div id="leaflet-map" class="w-full h-full" style="position:relative;"></div>`;

  requestAnimationFrame(async () => {
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

    markerGroup = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 60,
    });
    leafletMap.addLayer(markerGroup);

    leafletMap.on('moveend', loadClusters);

    // Stäng panel vid klick på kartan
    leafletMap.on('click', closeClusterPanel);

    if (window._pmMapGoto) {
      const { lat, lon, zoom } = window._pmMapGoto;
      window._pmMapGoto = null;
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

  const mapEl = document.getElementById('leaflet-map');
  if (!mapEl) return;

  const radiusMeters = zoomToRadius(zoom);

  // Skeleton-panel direkt
  const panel = document.createElement('div');
  panel.id = 'cluster-panel';
  panel.style.cssText = `position:absolute;bottom:0;left:0;right:0;z-index:1000;
    background:rgba(15,23,42,0.96);backdrop-filter:blur(8px);
    border-top:1px solid rgba(255,255,255,.1);padding:10px 12px;`;
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <span style="color:#94a3b8;font-size:12px;">Laddar bilder…</span>
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

  panel.querySelector('#cp-close').addEventListener('click', closeClusterPanel);
  panel.querySelector('#cp-zoom').addEventListener('click', () => {
    closeClusterPanel();
    leafletMap.flyTo([cluster.lat, cluster.lon], Math.min(zoom + 3, 16), { animate: true });
  });

  try {
    const { data: photos } = await api.clusterPhotos({
      lat: cluster.lat,
      lon: cluster.lon,
      radiusMeters,
    });

    const strip = panel.querySelector('#cp-strip');
    const info  = panel.querySelector('span');

    if (!photos?.length) {
      info.textContent = 'Inga bilder hittades.';
      return;
    }

    info.textContent = `${photos.length} bilder${photos.length === 30 ? '+' : ''} i detta område`;

    photos.forEach((photo) => {
      const img = document.createElement('img');
      img.src = `/thumbs/${photo.thumb_small_path}`;
      img.style.cssText = `width:72px;height:72px;object-fit:cover;border-radius:6px;
        cursor:pointer;flex-shrink:0;border:2px solid transparent;transition:border-color .15s;`;
      img.addEventListener('mouseenter', () => { img.style.borderColor = '#3b82f6'; });
      img.addEventListener('mouseleave', () => { img.style.borderColor = 'transparent'; });
      img.addEventListener('click', () => {
        openLightbox(photos, photos.indexOf(photo));
      });
      strip.appendChild(img);
    });
  } catch {
    panel.querySelector('span').textContent = 'Kunde inte ladda bilder.';
  }
}

async function openAsset(assetId) {
  try {
    const { data } = await api.asset(assetId);
    openLightbox([data], 0);
  } catch {}
}

function zoomToRadius(zoom) {
  const radii = {
    1: 5_000_000, 2: 2_000_000, 3: 1_000_000, 4: 500_000,
    5: 200_000,   6: 100_000,   7: 50_000,    8: 20_000,
    9: 10_000,    10: 5_000,    11: 2_000,    12: 1_000,
    13: 500,      14: 200,      15: 100,      16: 50,
  };
  return radii[Math.min(Math.max(zoom, 1), 16)] ?? 1000;
}

export function destroyMap() {
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
  }
}
