import { api } from '../api.js';
import { openLightbox } from '../components/lightbox.js';
import { buildPhotoCell } from '../components/gridCell.js';
import { createSelectionManager } from '../components/selectionManager.js';
import { formatDate } from '../utils.js';

export async function renderExplore(container) {
  container.innerHTML = `
    <div class="p-4 space-y-10">
      <section id="memories-section"></section>
      <section id="trips-section"></section>
      <section id="persons-section"></section>
      <section id="places-section"></section>
    </div>`;

  await Promise.all([
    loadMemories(),
    loadTrips(),
    loadPersonSpotlight(),
    loadPlaces(),
  ]);
}

// ── 1. Minnen ─────────────────────────────────────────────────────────────────

async function loadMemories() {
  const section = document.getElementById('memories-section');
  if (!section) return;
  try {
    const { data } = await api.onThisDay();
    if (!data?.length) { section.remove(); return; }

    // Välj det år med flest bilder
    const best = data.reduce((a, b) => (b.count > a.count ? b : a), data[0]);
    const cover = best.samples?.[0];
    if (!cover) { section.remove(); return; }

    const loc = cover.location_label ? ` · ${cover.location_label}` : '';
    const yearsText = best.yearsAgo === 1 ? '1 år sedan' : `${best.yearsAgo} år sedan`;

    section.innerHTML = `
      <h2 class="text-lg font-semibold text-white mb-3">🎞 Minnen</h2>
      <div id="memory-hero" class="relative rounded-2xl overflow-hidden cursor-pointer group"
           style="height: 320px;">
        <img src="/thumbs/${cover.thumb_small_path}"
             class="absolute inset-0 w-full h-full object-cover scale-105 group-hover:scale-110 transition-transform duration-700">
        <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent"></div>
        <div class="absolute bottom-0 left-0 p-6">
          <div class="text-blue-300 text-sm font-medium mb-1">${yearsText}${loc}</div>
          <div class="text-white text-2xl font-bold mb-1">${best.count} bilder från ${best.year}</div>
          <div class="text-slate-300 text-sm">Klicka för att visa minnet →</div>
        </div>
        <!-- Thumbnail-strip -->
        <div class="absolute top-4 right-4 flex gap-1.5">
          ${best.samples.slice(1, 5).map((s) => `
            <div class="w-14 h-14 rounded-lg overflow-hidden border-2 border-white/30 flex-shrink-0">
              <img src="/thumbs/${s.thumb_small_path}" class="w-full h-full object-cover">
            </div>`).join('')}
        </div>
      </div>`;

    document.getElementById('memory-hero')?.addEventListener('click', () => {
      openLightbox(best.samples, 0);
    });
  } catch {}
}

// ── 2. Resor ──────────────────────────────────────────────────────────────────

async function loadTrips() {
  const section = document.getElementById('trips-section');
  if (!section) return;
  try {
    const { data } = await api.trips();
    if (!data?.length) { section.remove(); return; }

    section.innerHTML = `
      <h2 class="text-lg font-semibold text-white mb-3">✈️ Resor</h2>
      <div id="trips-scroll" class="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory">
        ${data.map((trip) => {
          const days = (trip.duration_days ?? 0) + 1;
          const dateStr = formatDateRange(trip.date_from, trip.date_to);
          return `
            <div class="trip-card flex-shrink-0 snap-start rounded-xl overflow-hidden bg-slate-800
                        hover:bg-slate-700 transition-colors cursor-pointer flex"
                 style="width: 380px; height: 180px;" data-trip-id="${trip.id}">
              <!-- Cover-bild vänster -->
              <div class="relative w-44 flex-shrink-0 overflow-hidden">
                ${trip.cover_thumb
                  ? `<img src="/thumbs/${trip.cover_thumb}" class="absolute inset-0 w-full h-full object-cover">`
                  : `<div class="absolute inset-0 bg-slate-700 flex items-center justify-center text-4xl">✈️</div>`}
              </div>
              <!-- Info + karta höger -->
              <div class="flex-1 flex flex-col p-3 min-w-0">
                <div class="font-semibold text-white text-sm truncate mb-0.5">
                  ${trip.name ?? trip.location_label ?? 'Resa'}
                </div>
                <div class="text-xs text-slate-400 mb-1">${dateStr} · ${days} dag${days > 1 ? 'ar' : ''} · ${trip.asset_count} bilder</div>
                <div id="trip-map-${trip.id}" class="flex-1 rounded overflow-hidden bg-slate-900 min-h-0"></div>
              </div>
            </div>`;
        }).join('')}
      </div>`;

    // Klick → öppna event
    section.querySelectorAll('.trip-card').forEach((card) => {
      card.addEventListener('click', async () => {
        const { data: ev } = await api.collection(card.dataset.tripId);
        openLightbox(ev.assets, 0);
      });
    });

    // Ladda kartor asynkront per resa
    data.forEach((trip) => loadTripMap(trip.id));
  } catch {}
}

async function loadTripMap(tripId) {
  const mapEl = document.getElementById(`trip-map-${tripId}`);
  if (!mapEl || typeof L === 'undefined') return;
  try {
    const { data: pts } = await api.tripTrack(tripId);
    if (!pts?.length) {
      mapEl.innerHTML = '<div class="w-full h-full flex items-center justify-center text-slate-600 text-xs">Ingen GPS-data</div>';
      return;
    }

    const map = L.map(mapEl, {
      zoomControl: false, attributionControl: false,
      dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
      keyboard: false, touchZoom: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    const latlngs = pts.map((p) => [p.lat, p.lon]);
    const line = L.polyline(latlngs, { color: '#60a5fa', weight: 2.5, opacity: 0.9 }).addTo(map);

    // Start- och slutmarkör
    if (latlngs.length >= 1) {
      L.circleMarker(latlngs[0], { radius: 5, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 0 }).addTo(map);
    }
    if (latlngs.length >= 2) {
      L.circleMarker(latlngs[latlngs.length - 1], { radius: 5, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1, weight: 0 }).addTo(map);
    }

    map.fitBounds(line.getBounds(), { padding: [8, 8] });
  } catch {}
}

// ── 3. Ansikten i fokus ───────────────────────────────────────────────────────

async function loadPersonSpotlight() {
  const section = document.getElementById('persons-section');
  if (!section) return;
  try {
    const { data } = await api.persons();
    if (!data?.length) { section.remove(); return; }

    const top = [...data]
      .sort((a, b) => (b.photo_count ?? 0) - (a.photo_count ?? 0))
      .slice(0, 8);

    section.innerHTML = `
      <h2 class="text-lg font-semibold text-white mb-3">👤 Ansikten i fokus</h2>
      <div class="flex gap-5 overflow-x-auto pb-2">
        ${top.map((p) => {
          const effectiveFaceId = p.cover_face_id ?? p.fallback_face_id;
          const imgSrc = effectiveFaceId
            ? `/api/faces/${effectiveFaceId}/thumb`
            : null;
          return `
            <div class="person-card flex-shrink-0 flex flex-col items-center gap-2 cursor-pointer group"
                 data-person-id="${p.id}" style="width: 110px;">
              <div class="w-20 h-20 rounded-full overflow-hidden border-2 border-slate-700 group-hover:border-blue-500 transition-colors flex-shrink-0 bg-slate-800">
                ${imgSrc
                  ? `<img src="${imgSrc}" class="w-full h-full object-cover">`
                  : `<div class="w-full h-full flex items-center justify-center text-3xl">👤</div>`}
              </div>
              <div class="text-center w-full">
                <div class="text-xs font-medium text-white leading-tight w-full px-1"
                     style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${p.name}</div>
                <div class="text-xs text-slate-500 mt-0.5">${p.photo_count ?? 0} bilder</div>
              </div>
            </div>`;
        }).join('')}
      </div>`;

    section.querySelectorAll('.person-card').forEach((card) => {
      card.addEventListener('click', () => {
        location.hash = `#/faces/${card.dataset.personId}`;
      });
    });
  } catch {}
}

// ── 4. Platser ────────────────────────────────────────────────────────────────

async function loadPlaces() {
  const section = document.getElementById('places-section');
  if (!section) return;
  try {
    const { data } = await api.places();
    if (!data?.length) { section.remove(); return; }

    section.innerHTML = `
      <h2 class="text-lg font-semibold text-white mb-3">📍 Platser</h2>
      <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))">
        ${data.map((place) => `
          <div class="place-card group relative rounded-xl overflow-hidden cursor-pointer"
               style="aspect-ratio:1;" data-place="${encodeURIComponent(place.location_label)}">
            ${place.cover_thumb
              ? `<img src="/thumbs/${place.cover_thumb}" class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">`
              : `<div class="absolute inset-0 bg-slate-800 flex items-center justify-center text-4xl">📍</div>`}
            <div class="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent"></div>
            <div class="absolute bottom-0 left-0 p-3">
              <div class="text-white text-sm font-semibold truncate">${place.location_label}</div>
              <div class="text-slate-300 text-xs">${place.photo_count} bilder</div>
            </div>
          </div>`).join('')}
      </div>`;

    section.querySelectorAll('.place-card').forEach((card) => {
      card.addEventListener('click', () => {
        const label = decodeURIComponent(card.dataset.place);
        window.dispatchEvent(new CustomEvent('pm:timeline-filter', {
          detail: { q: label },
        }));
      });
    });
  } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDateRange(from, to) {
  if (!from) return '';
  const f = new Date(from);
  const t = to ? new Date(to) : null;
  const sv = (d) => d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
  if (!t || f.toDateString() === t.toDateString()) return sv(f);
  if (f.getFullYear() === t.getFullYear()) return `${sv(f)} – ${sv(t)} ${f.getFullYear()}`;
  return `${sv(f)} ${f.getFullYear()} – ${sv(t)} ${t.getFullYear()}`;
}

// ── Favoriter (oförändrad) ─────────────────────────────────────────────────────

export async function renderFavorites(container) {
  container.innerHTML = `
    <div class="p-4">
      <div class="flex items-center gap-2 mb-2 flex-wrap">
        <h1 class="text-xl font-semibold text-white">❤️ Favoriter</h1>
      </div>
      <div id="fav-selection-toolbar" class="flex items-center gap-3 mb-3 flex-wrap min-h-[28px]"></div>
      <div id="fav-grid" class="grid gap-1" style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))">
        <div class="col-span-full text-slate-400 text-sm">Laddar…</div>
      </div>
    </div>`;

  try {
    const { data } = await api.favorites();
    const grid = document.getElementById('fav-grid');
    if (!data?.length) {
      grid.innerHTML = '<div class="col-span-full text-slate-400 text-sm">Inga favoriter ännu.</div>';
      return;
    }

    const assets = data.map((a) => ({ ...a, is_favorite: true }));

    const selection = createSelectionManager(
      () => document.getElementById('fav-grid'),
      () => assets,
    );
    selection.mountToolbar(container.querySelector('#fav-selection-toolbar'));

    assets.forEach((asset, i) => {
      const cell = buildPhotoCell(
        asset,
        () => openLightbox(assets, i),
        (assetId, nowFav) => {
          if (!nowFav) {
            const el = grid.querySelector(`[data-id="${assetId}"]`);
            if (el) el.remove();
            if (!grid.querySelector('[data-id]')) {
              grid.innerHTML = '<div class="col-span-full text-slate-400 text-sm">Inga favoriter ännu.</div>';
            }
          } else {
            renderFavorites(container);
          }
        },
      );
      selection.attachToCell(cell, asset, i);
      grid.appendChild(cell);
    });
  } catch (e) {
    document.getElementById('fav-grid').innerHTML =
      `<div class="col-span-full text-red-400 text-sm">Kunde inte ladda favoriter: ${e.message}</div>`;
  }
}
