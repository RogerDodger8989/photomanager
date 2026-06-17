import { api } from '../api.js';
import { toast, formatDate, confirm } from '../utils.js';

export async function renderSharing(container) {
  container.innerHTML = `
    <div class="p-4">
      <h1 class="text-xl font-semibold text-white mb-4">Delning</h1>
      <div class="flex gap-2 mb-4 border-b border-slate-700">
        <button id="tab-out" class="tab-btn pb-2 px-1 text-sm font-medium text-white border-b-2 border-blue-500">Mina delningar</button>
        <button id="tab-in"  class="tab-btn pb-2 px-1 text-sm font-medium text-slate-400 border-b-2 border-transparent hover:text-white">Mottagna</button>
      </div>
      <div id="sharing-content"></div>
    </div>`;

  const showOutgoing = () => loadOutgoing(document.getElementById('sharing-content'));
  const showIncoming = () => loadIncoming(document.getElementById('sharing-content'));

  document.getElementById('tab-out').addEventListener('click', () => {
    setActiveTab('tab-out');
    showOutgoing();
  });
  document.getElementById('tab-in').addEventListener('click', () => {
    setActiveTab('tab-in');
    showIncoming();
  });

  showOutgoing();
}

function setActiveTab(activeId) {
  ['tab-out','tab-in'].forEach((id) => {
    const btn = document.getElementById(id);
    const isActive = id === activeId;
    btn.className = `tab-btn pb-2 px-1 text-sm font-medium border-b-2 ${
      isActive ? 'text-white border-blue-500' : 'text-slate-400 border-transparent hover:text-white'
    }`;
  });
}

async function loadOutgoing(content) {
  content.innerHTML = '<div class="text-slate-400 text-sm">Laddar…</div>';
  try {
    const { data } = await api.shares();
    if (!data.length) { content.innerHTML = '<div class="text-slate-400 text-sm">Inga aktiva delningar.</div>'; return; }

    content.innerHTML = `
      <div class="space-y-2">
        ${data.map((s) => `
          <div class="flex items-center gap-3 bg-slate-800 rounded-xl p-3" data-share-id="${s.id}">
            ${s.thumb_small_path
              ? `<img src="/thumbs/${s.thumb_small_path}" class="w-12 h-12 rounded object-cover flex-shrink-0">`
              : `<div class="w-12 h-12 rounded bg-slate-700 flex items-center justify-center text-xl flex-shrink-0">🗂️</div>`}
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-white truncate">
                ${s.asset_name ?? s.album_name ?? 'Okänt'}
              </div>
              <div class="text-xs text-slate-400 mt-0.5">
                ${s.share_type === 'public_link' ? '🔗 Publik länk' : `👤 ${s.shared_with_username ?? '–'}`}
                ${s.expires_at ? ` · Utgår ${formatDate(s.expires_at)}` : ''}
                · ${s.view_count} visningar
              </div>
              ${s.token ? `<input readonly value="${location.origin}/share/${s.token}"
                class="mt-1.5 w-full bg-slate-700 text-xs text-slate-300 px-2 py-1 rounded cursor-pointer"
                onclick="this.select();document.execCommand('copy');app.toast('Kopierat!','success')">` : ''}
            </div>
            <button class="delete-share text-red-400 hover:text-red-300 p-1" data-id="${s.id}">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>`).join('')}
      </div>`;

    content.querySelectorAll('.delete-share').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!await confirm('Ta bort delningen?')) return;
        try {
          await api.deleteShare(btn.dataset.id);
          toast('Delning borttagen', 'success');
          loadOutgoing(content);
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  } catch (e) { toast(e.message, 'error'); }
}

async function loadIncoming(content) {
  content.innerHTML = '<div class="text-slate-400 text-sm">Laddar…</div>';
  try {
    const { data } = await api.received();
    if (!data.length) { content.innerHTML = '<div class="text-slate-400 text-sm">Inga mottagna delningar.</div>'; return; }

    content.innerHTML = `
      <div class="space-y-2">
        ${data.map((s) => `
          <div class="flex items-center gap-3 bg-slate-800 rounded-xl p-3">
            ${s.thumb_small_path
              ? `<img src="/thumbs/${s.thumb_small_path}" class="w-12 h-12 rounded object-cover flex-shrink-0">`
              : `<div class="w-12 h-12 rounded bg-slate-700 flex items-center justify-center text-xl flex-shrink-0">📷</div>`}
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-white truncate">${s.file_name ?? s.album_name ?? 'Delat innehåll'}</div>
              <div class="text-xs text-slate-400 mt-0.5">Från ${s.shared_by_username} · ${formatDate(s.created_at)}</div>
            </div>
          </div>`).join('')}
      </div>`;
  } catch (e) { toast(e.message, 'error'); }
}
