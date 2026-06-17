import { api } from '../api.js';
import { openLightbox } from '../components/lightbox.js';

let leafletMap  = null;
let markerGroup = null;

export function renderMap(container) {
  container.innerHTML = `<div id="leaflet-map" class="w-full h-full"></div>`;

  // Liten fördröjning så att container får sin storlek
  requestAnimationFrame(() => {
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
        const marker = L.circleMarker([cluster.lat, cluster.lon], {
          radius: Math.min(8 + Math.log2(cluster.count) * 3, 28),
          fillColor: '#3b82f6',
          color: '#1d4ed8',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.8,
        });

        marker.bindTooltip(`${cluster.count} bilder`, { permanent: false });
        marker.on('click', () => {
          if (cluster.count === 1) {
            openAsset(cluster.sampleAssetId);
          } else {
            leafletMap.flyTo([cluster.lat, cluster.lon], Math.min(zoom + 3, 16), { animate: true });
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
          iconSize: [40, 40],
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

async function openAsset(assetId) {
  try {
    const { data } = await api.asset(assetId);
    openLightbox([data], 0);
  } catch {}
}

export function destroyMap() {
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
  }
}
