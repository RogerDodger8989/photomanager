import { api } from '../api.js';
import { openLightbox } from '../components/lightbox.js';
import { toast } from '../utils.js';

export async function renderPersons(container, personId = null) {
  if (personId) {
    await renderPersonDetail(container, personId);
  } else {
    await renderPersonList(container);
  }
}

async function renderPersonList(container) {
  container.innerHTML = `
    <div class="p-4">
      <h1 class="text-xl font-semibold text-white mb-4">Ansikten</h1>
      <div id="ai-suggestion-banner" class="hidden mb-4 bg-blue-900/40 border border-blue-700 rounded-xl p-3 text-sm text-blue-300 flex items-center justify-between">
        <span>🤖 AI har nya personförslag att granska</span>
        <a href="#/admin/ai" class="underline hover:text-white">Granska →</a>
      </div>
      <div id="persons-grid" class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(130px, 1fr))">
        <div class="col-span-full text-slate-400 text-sm">Laddar…</div>
      </div>
    </div>`;

  // Kolla om det finns AI-förslag
  try {
    const { data: aiStatus } = await api.aiStatus();
    if (aiStatus.available) {
      const { meta } = await api.aiSuggestions({ limit: 1 });
      if (meta.total > 0) {
        document.getElementById('ai-suggestion-banner').classList.remove('hidden');
        document.querySelector('#ai-suggestion-banner span').textContent =
          `🤖 AI har ${meta.total} personförslag att granska`;
      }
    }
  } catch {}

  try {
    const { data } = await api.persons();
    const grid = document.getElementById('persons-grid');
    if (!data?.length) {
      grid.innerHTML = '<div class="col-span-full text-slate-400 text-sm">Inga namngivna ansikten ännu.<br>Öppna en bild och tilldela namn till ansikten.</div>';
      return;
    }

    grid.innerHTML = data.map((p) => `
      <div class="cursor-pointer group text-center" data-person-id="${p.id}">
        <div class="w-24 h-24 mx-auto rounded-full overflow-hidden bg-slate-700 mb-2 border-2 border-slate-600 group-hover:border-blue-500 transition-colors">
          ${p.cover_thumb
            ? `<img src="/thumbs/${p.cover_thumb}" class="w-full h-full object-cover">`
            : `<div class="w-full h-full flex items-center justify-center text-3xl">👤</div>`}
        </div>
        <div class="text-sm font-medium text-white truncate">${p.name}</div>
        <div class="text-xs text-slate-400">${p.photo_count} bilder</div>
      </div>`).join('');

    grid.querySelectorAll('[data-person-id]').forEach((el) => {
      el.addEventListener('click', () => {
        location.hash = `#/faces/${el.dataset.personId}`;
      });
    });
  } catch (e) { toast(e.message, 'error'); }
}

async function renderPersonDetail(container, personId) {
  container.innerHTML = `
    <div class="p-4">
      <button onclick="location.hash='#/faces'" class="text-slate-400 hover:text-white text-sm mb-4 flex items-center gap-1">
        ← Tillbaka
      </button>
      <div id="person-header" class="flex items-center gap-4 mb-6"></div>
      <div id="person-grid" class="grid gap-0.5" style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))">
        <div class="text-slate-400 text-sm p-2">Laddar…</div>
      </div>
    </div>`;

  try {
    const { data } = await api.person(personId);
    const { person, assets } = data;

    document.getElementById('person-header').innerHTML = `
      <div class="w-20 h-20 rounded-full overflow-hidden bg-slate-700 flex-shrink-0">
        ${assets[0]?.thumb_small_path
          ? `<img src="/thumbs/${assets[0].thumb_small_path}" class="w-full h-full object-cover">`
          : `<div class="w-full h-full flex items-center justify-center text-4xl">👤</div>`}
      </div>
      <div>
        <div id="person-name-display" class="text-xl font-semibold text-white">${person.name}</div>
        <div class="text-sm text-slate-400">${assets.length} bilder</div>
        <button id="edit-name-btn" class="text-blue-400 hover:text-blue-300 text-sm mt-1">Byt namn</button>
      </div>`;

    document.getElementById('edit-name-btn').addEventListener('click', async () => {
      const name = window.prompt('Nytt namn:', person.name);
      if (!name?.trim()) return;
      try {
        await api.patchPerson(personId, { name: name.trim() });
        document.getElementById('person-name-display').textContent = name.trim();
        toast('Namn uppdaterat', 'success');
      } catch (e) { toast(e.message, 'error'); }
    });

    const grid = document.getElementById('person-grid');
    if (!assets.length) { grid.innerHTML = '<div class="text-slate-400 text-sm p-2">Inga bilder.</div>'; return; }

    grid.innerHTML = '';
    assets.forEach((asset, i) => {
      const cell = document.createElement('div');
      cell.className = 'photo-cell';
      cell.innerHTML = `<img src="/thumbs/${asset.thumb_small_path}" loading="lazy">`;
      cell.addEventListener('click', () => openLightbox(assets, i));
      grid.appendChild(cell);
    });
  } catch (e) { toast(e.message, 'error'); }
}
