import { api } from '../api.js';
import { toast } from '../utils.js';

/**
 * Öppna dela-modal för en bild eller ett album.
 * @param {{ assetId?: string, albumId?: string, name?: string }} opts
 */
export async function openShareModal({ assetId, albumId, name = '' } = {}) {
  let allUsers = [];
  try {
    const { data } = await api.adminUsers();
    const me = (await api.me()).data;
    allUsers = (data ?? []).filter((u) => u.id !== me.id);
  } catch {}

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[9000] flex items-center justify-center bg-black/70 p-4';
  document.body.appendChild(overlay);

  let createdShare = null;

  const render = () => {
    overlay.innerHTML = `
      <div class="bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl border border-slate-700">
        <div class="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <div>
            <h2 class="text-lg font-semibold text-white">🔗 Dela</h2>
            ${name ? `<p class="text-xs text-slate-400 mt-0.5 truncate">${escHtml(name)}</p>` : ''}
          </div>
          <button id="sm-close" class="text-slate-400 hover:text-white transition-colors text-xl leading-none">✕</button>
        </div>

        ${createdShare ? renderSuccess(createdShare) : renderForm(allUsers)}
      </div>`;

    overlay.querySelector('#sm-close')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    if (!createdShare) {
      setupFormListeners();
    } else {
      setupSuccessListeners();
    }
  };

  function renderForm(users) {
    return `
      <div class="p-6 space-y-4">
        <!-- Typ -->
        <div>
          <p class="text-xs font-medium text-slate-400 mb-2">Typ av delning</p>
          <div class="flex gap-2">
            <button id="sm-type-public" class="sm-type-btn flex-1 py-2 rounded-lg text-sm font-medium transition-colors bg-blue-600 text-white border border-blue-600">
              🔗 Publik länk
            </button>
            ${users.length ? `<button id="sm-type-internal" class="sm-type-btn flex-1 py-2 rounded-lg text-sm font-medium transition-colors text-slate-300 border border-slate-600 hover:bg-slate-700">
              👤 Intern
            </button>` : ''}
          </div>
        </div>

        <!-- Publik inställningar -->
        <div id="sm-public-opts" class="space-y-3">
          <div class="flex gap-3">
            <div class="flex-1">
              <label class="block text-xs text-slate-400 mb-1">Utgångsdatum (valfritt)</label>
              <input id="sm-expires" type="date"
                class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
            </div>
            <div class="w-28">
              <label class="block text-xs text-slate-400 mb-1">Max visningar</label>
              <input id="sm-max-views" type="number" min="1" placeholder="∞"
                class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
            </div>
          </div>
        </div>

        <!-- Intern inställningar -->
        <div id="sm-internal-opts" class="hidden space-y-3">
          <div>
            <label class="block text-xs text-slate-400 mb-1">Dela med</label>
            <select id="sm-user-select"
              class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
              <option value="">Välj användare…</option>
              ${users.map((u) => `<option value="${u.id}">${escHtml(u.username)}</option>`).join('')}
            </select>
          </div>
        </div>

        <button id="sm-create" class="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-colors">
          Skapa delning
        </button>
      </div>`;
  }

  function renderSuccess(share) {
    const url = share.token ? `${location.origin}/share/${share.token}` : null;
    return `
      <div class="p-6 space-y-4">
        <div class="flex items-center gap-2 text-green-400 text-sm font-medium">
          <span>✓</span><span>Delning skapad!</span>
        </div>
        ${url ? `
          <div>
            <label class="block text-xs text-slate-400 mb-1">Delningslänk</label>
            <div class="flex gap-2">
              <input id="sm-link-input" readonly value="${url}"
                class="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white cursor-pointer min-w-0"
                onclick="this.select()">
              <button id="sm-copy-btn" class="flex-shrink-0 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
                📋 Kopiera
              </button>
            </div>
          </div>
          <div id="sm-qr" class="flex justify-center"></div>
        ` : `<p class="text-sm text-slate-300">Delning skickad till användaren.</p>`}
        <button id="sm-new-share" class="w-full py-2 border border-slate-600 hover:bg-slate-700 text-slate-300 text-sm rounded-xl transition-colors">
          + Skapa en till delning
        </button>
      </div>`;
  }

  let shareType = 'public_link';

  function setupFormListeners() {
    overlay.querySelector('#sm-type-public')?.addEventListener('click', () => {
      shareType = 'public_link';
      overlay.querySelectorAll('.sm-type-btn').forEach((b) => {
        b.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
        b.classList.add('text-slate-300', 'border-slate-600');
      });
      const pb = overlay.querySelector('#sm-type-public');
      pb?.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
      pb?.classList.remove('text-slate-300', 'border-slate-600');
      overlay.querySelector('#sm-public-opts')?.classList.remove('hidden');
      overlay.querySelector('#sm-internal-opts')?.classList.add('hidden');
    });

    overlay.querySelector('#sm-type-internal')?.addEventListener('click', () => {
      shareType = 'internal';
      overlay.querySelectorAll('.sm-type-btn').forEach((b) => {
        b.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
        b.classList.add('text-slate-300', 'border-slate-600');
      });
      const ib = overlay.querySelector('#sm-type-internal');
      ib?.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
      ib?.classList.remove('text-slate-300', 'border-slate-600');
      overlay.querySelector('#sm-public-opts')?.classList.add('hidden');
      overlay.querySelector('#sm-internal-opts')?.classList.remove('hidden');
    });

    overlay.querySelector('#sm-create')?.addEventListener('click', async () => {
      const createBtn = /** @type {HTMLButtonElement} */ (overlay.querySelector('#sm-create'));
      if (createBtn) createBtn.disabled = true;

      try {
        const expiresInput = /** @type {HTMLInputElement} */ (overlay.querySelector('#sm-expires'));
        const maxViewsInput = /** @type {HTMLInputElement} */ (overlay.querySelector('#sm-max-views'));
        const userSelect = /** @type {HTMLSelectElement} */ (overlay.querySelector('#sm-user-select'));

        const body = {
          shareType,
          ...(assetId ? { assetId } : {}),
          ...(albumId ? { albumId } : {}),
        };

        if (shareType === 'public_link') {
          if (expiresInput?.value) body.expiresAt = expiresInput.value;
          if (maxViewsInput?.value) body.maxViews = parseInt(maxViewsInput.value, 10);
        } else {
          const uid = userSelect?.value;
          if (!uid) { toast('Välj en användare', 'error'); if (createBtn) createBtn.disabled = false; return; }
          body.sharedWith = uid;
        }

        const { data } = await api.createShare(body);
        createdShare = data;
        render();
      } catch (e) {
        toast(e.message, 'error');
        if (createBtn) createBtn.disabled = false;
      }
    });
  }

  function setupSuccessListeners() {
    const copyBtn = overlay.querySelector('#sm-copy-btn');
    const linkInput = /** @type {HTMLInputElement} */ (overlay.querySelector('#sm-link-input'));

    copyBtn?.addEventListener('click', async () => {
      const url = linkInput?.value;
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        copyBtn.textContent = '✓ Kopierat!';
        setTimeout(() => { copyBtn.textContent = '📋 Kopiera'; }, 2000);
      } catch {
        linkInput?.select();
        toast('Markera och kopiera länken manuellt', 'info');
      }
    });

    linkInput?.addEventListener('click', () => linkInput.select());

    overlay.querySelector('#sm-new-share')?.addEventListener('click', () => {
      createdShare = null;
      render();
    });

    // QR-kod via enkelt API (om vi vill)
    const qrEl = overlay.querySelector('#sm-qr');
    const url = linkInput?.value;
    if (qrEl && url && typeof /** @type {any} */ (window).QRCode !== 'undefined') {
      const QRCode = /** @type {any} */ (window).QRCode;
      new QRCode(qrEl, { text: url, width: 120, height: 120, colorLight: '#1e293b', colorDark: '#60a5fa' });
    }
  }

  render();
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
