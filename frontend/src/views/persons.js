import { api } from '../api.js';
import { openLightbox } from '../components/lightbox.js';
import { toast } from '../utils.js';

function showRenameModal(currentName, onSave) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm';
  overlay.innerHTML = `
    <div id="rename-modal" class="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-80 p-6">
      <h3 class="text-base font-semibold text-white mb-4">Byt namn</h3>
      <input id="rename-input" type="text" value="${currentName.replace(/"/g, '&quot;')}"
        class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 mb-5">
      <div class="flex gap-2 justify-end">
        <button id="rename-cancel" class="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-700">Avbryt</button>
        <button id="rename-ok" class="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">OK</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  const input = overlay.querySelector('#rename-input');
  input.focus();
  input.select();

  let originalValue = currentName;

  const doCancel = () => {
    const current = input.value.trim();
    if (current !== originalValue && current) {
      if (!confirm('Du har osparade ändringar. Vill du ändå avbryta?')) return;
    }
    overlay.remove();
  };

  const doSave = () => {
    const name = input.value.trim();
    if (!name) return;
    overlay.remove();
    onSave(name);
  };

  overlay.querySelector('#rename-ok').addEventListener('click', doSave);
  overlay.querySelector('#rename-cancel').addEventListener('click', doCancel);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSave();
    if (e.key === 'Escape') doCancel();
  });
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) doCancel();
  });
}

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

    document.getElementById('edit-name-btn').addEventListener('click', () => {
      showRenameModal(person.name, async (newName) => {
        try {
          await api.patchPerson(personId, { name: newName });
          document.getElementById('person-name-display').textContent = newName;
          person.name = newName;
          toast('Namn uppdaterat', 'success');
        } catch (e) { toast(e.message, 'error'); }
      });
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
