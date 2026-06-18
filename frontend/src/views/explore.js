import { api } from '../api.js';
import { openLightbox } from '../components/lightbox.js';
import { formatDate } from '../utils.js';

export async function renderExplore(container) {
  container.innerHTML = `
    <div class="p-4 space-y-8">
      <section id="on-this-day-section"></section>
      <section id="collections-section"></section>
    </div>`;

  await Promise.all([loadOnThisDay(), loadCollections()]);
}

async function loadOnThisDay() {
  const section = document.getElementById('on-this-day-section');
  try {
    const { data } = await api.onThisDay();
    if (!data?.length) { section.remove(); return; }

    section.innerHTML = `
      <h2 class="text-lg font-semibold text-white mb-3">📅 Den här dagen tidigare år</h2>
      <div class="space-y-4">
        ${data.map((year) => `
          <div>
            <div class="text-sm text-slate-400 mb-2">
              ${year.yearsAgo} år sedan · ${year.count} bilder
            </div>
            <div class="flex gap-1 overflow-x-auto pb-1">
              ${(year.samples ?? []).map((s) => `
                <div class="w-28 h-28 flex-shrink-0 rounded overflow-hidden cursor-pointer photo-cell"
                     data-asset-id="${s.id}">
                  <img src="/thumbs/${s.thumb_small_path}" class="w-full h-full object-cover">
                </div>`).join('')}
            </div>
          </div>`).join('')}
      </div>`;

    section.querySelectorAll('[data-asset-id]').forEach((el) => {
      el.addEventListener('click', async () => {
        const { data: asset } = await api.asset(el.dataset.assetId);
        openLightbox([asset], 0);
      });
    });
  } catch {}
}

async function loadCollections() {
  const section = document.getElementById('collections-section');
  try {
    const { data } = await api.collections();
    if (!data?.length) { section.remove(); return; }

    section.innerHTML = `
      <h2 class="text-lg font-semibold text-white mb-3">✨ Händelser</h2>
      <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))">
        ${data.map((ev) => `
          <div class="group cursor-pointer rounded-xl overflow-hidden bg-slate-800 hover:bg-slate-700 transition-colors"
               data-event-id="${ev.id}">
            <div class="aspect-video overflow-hidden">
              ${ev.cover_thumb
                ? `<img src="/thumbs/${ev.cover_thumb}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">`
                : `<div class="w-full h-full bg-slate-700 flex items-center justify-center text-4xl">📷</div>`}
            </div>
            <div class="p-3">
              <div class="font-medium text-sm text-white truncate">
                ${ev.location_label ?? formatDate(ev.date_from)}
              </div>
              <div class="text-xs text-slate-400 mt-0.5">
                ${formatDate(ev.date_from)} · ${ev.asset_count} bilder
              </div>
            </div>
          </div>`).join('')}
      </div>`;

    section.querySelectorAll('[data-event-id]').forEach((el) => {
      el.addEventListener('click', async () => {
        const { data } = await api.collection(el.dataset.eventId);
        openLightbox(data.assets, 0);
      });
    });
  } catch {}
}

export async function renderFavorites(container) {
  container.innerHTML = `
    <div class="p-4">
      <h1 class="text-xl font-semibold text-white mb-4">❤️ Favoriter</h1>
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
    grid.innerHTML = data.map((a, i) => `
      <div class="relative cursor-pointer group aspect-square overflow-hidden rounded" data-idx="${i}">
        ${a.mime_type?.startsWith('video/')
          ? `<div class="absolute inset-0 flex items-center justify-center bg-slate-900 text-slate-400 text-3xl">▶</div>`
          : ''}
        <img src="/thumbs/${a.thumb_small_path}" loading="lazy"
             class="w-full h-full object-cover transition-transform group-hover:scale-105"
             alt="${a.file_name ?? ''}">
      </div>`).join('');

    grid.querySelectorAll('[data-idx]').forEach((el) => {
      el.addEventListener('click', () => openLightbox(data, +el.dataset.idx));
    });
  } catch (e) {
    document.getElementById('fav-grid').innerHTML =
      `<div class="col-span-full text-red-400 text-sm">Kunde inte ladda favoriter: ${e.message}</div>`;
  }
}
