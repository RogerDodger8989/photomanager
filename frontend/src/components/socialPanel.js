import { api } from '../api.js';
import { toast } from '../utils.js';

const EMOJIS = ['❤️', '😂', '😮', '👍', '😢', '🔥'];

/**
 * Renderar och monterar social-panelen (reaktioner + kommentarer) i ett givet element.
 * @param {HTMLElement} container
 * @param {string} assetId
 * @param {{ id: string, role: string }} currentUser
 */
export async function mountSocialPanel(container, assetId, currentUser) {
  container.innerHTML = `
    <div class="px-4 pt-1 pb-3">

      <!-- Reaktioner -->
      <div id="sp-reactions" class="flex flex-wrap gap-1.5 mb-3"></div>

      <!-- Kommentarer -->
      <div id="sp-comments" class="space-y-2 mb-3 max-h-48 overflow-y-auto"></div>

      <!-- Skriv kommentar -->
      <div class="flex gap-2">
        <input id="sp-input" type="text" maxlength="2000"
          placeholder="Skriv en kommentar…"
          class="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-white
                 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40"/>
        <button id="sp-send"
          class="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg
                 transition-colors disabled:opacity-40">
          Skicka
        </button>
      </div>
    </div>`;

  const reactionsEl = container.querySelector('#sp-reactions');
  const commentsEl  = container.querySelector('#sp-comments');
  const input       = container.querySelector('#sp-input');
  const sendBtn     = container.querySelector('#sp-send');

  let data = { comments: [], reactions: [], myReactions: [] };

  async function reload() {
    try {
      const res = await api.social(assetId);
      data = res.data;
      renderReactions();
      renderComments();
    } catch { /* tyst fel */ }
  }

  function renderReactions() {
    // Bygg en map emoji → count
    const counts = Object.fromEntries(data.reactions.map((r) => [r.emoji, r.count]));

    reactionsEl.innerHTML = EMOJIS.map((e) => {
      const count = counts[e] ?? 0;
      const mine  = data.myReactions.includes(e);
      return `
        <button data-emoji="${e}"
          class="reaction-btn flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors
                 ${mine
                   ? 'bg-blue-600/30 border border-blue-500/60 text-white'
                   : 'bg-slate-700/60 border border-slate-600/60 text-slate-300 hover:bg-slate-600/60'}">
          <span>${e}</span>${count > 0 ? `<span class="font-medium">${count}</span>` : ''}
        </button>`;
    }).join('');

    reactionsEl.querySelectorAll('.reaction-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const emoji = btn.dataset.emoji;
        try {
          await api.toggleReaction(assetId, emoji);
          await reload();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  function renderComments() {
    if (!data.comments.length) {
      commentsEl.innerHTML = '<p class="text-xs text-slate-600 italic">Inga kommentarer än.</p>';
      return;
    }
    commentsEl.innerHTML = data.comments.map((c) => {
      const canDelete = currentUser?.role === 'admin' || currentUser?.id === c.user_id;
      const time = new Date(c.created_at).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
      return `
        <div class="group flex gap-2 items-start" data-comment-id="${c.id}">
          <div class="flex-shrink-0 w-6 h-6 rounded-full bg-slate-600 flex items-center justify-center text-xs font-medium text-white">
            ${(c.user_name ?? '?')[0].toUpperCase()}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-1.5 flex-wrap">
              <span class="text-xs font-medium text-slate-200">${escHtml(c.user_name ?? 'Okänd')}</span>
              <span class="text-[10px] text-slate-500">${time}</span>
            </div>
            <p class="text-xs text-slate-300 mt-0.5 break-words">${escHtml(c.content)}</p>
          </div>
          ${canDelete ? `
            <button data-del="${c.id}"
              class="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-slate-600
                     hover:text-red-400 mt-0.5">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
              </svg>
            </button>` : ''}
        </div>`;
    }).join('');

    commentsEl.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api.deleteComment(btn.dataset.del);
          await reload();
        } catch (err) { toast(err.message, 'error'); }
      });
    });

    // Scrolla till botten
    commentsEl.scrollTop = commentsEl.scrollHeight;
  }

  async function sendComment() {
    const text = input.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    try {
      await api.addComment(assetId, text);
      input.value = '';
      await reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener('click', sendComment);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendComment(); } });

  await reload();
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
