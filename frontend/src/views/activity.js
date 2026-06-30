import { api } from '../api.js';
import { openLightbox } from '../components/lightbox.js';

// Beskriver en meta-payload i läsbar text
function describeMetaChanges(meta) {
  if (!meta) return null;
  const parts = [];
  if (meta.rating       !== undefined) parts.push(`betyg → ${meta.rating ?? '–'} ★`);
  if (meta.title        !== undefined) parts.push(`rubrik → "${meta.title ?? '–'}"`);
  if (meta.description  !== undefined) parts.push('beskrivning ändrad');
  if (meta.takenAt      !== undefined) parts.push('datum ändrat');
  if (meta.locationLabel !== undefined) parts.push(`plats → "${meta.locationLabel ?? '–'}"`);
  if (meta.visibility   !== undefined) parts.push(`synlighet → ${meta.visibility}`);
  if (meta.flag         !== undefined) parts.push(`flagga → ${meta.flag ?? '–'}`);
  if (meta.tags         !== undefined) parts.push(`${meta.tags} tagg${meta.tags !== 1 ? 'ar' : ''} uppdaterade`);
  if (meta.operations)                 parts.push(meta.operations.map(describeOp).join(', '));
  if (meta.shareType)                  parts.push(`typ: ${meta.shareType === 'public_link' ? 'publik länk' : meta.shareType}`);
  return parts.length ? parts.join(' · ') : null;
}

function describeOp(op) {
  if (op.type === 'rotate') return `roterad ${op.angle > 0 ? '+' : ''}${op.angle}°`;
  if (op.type === 'crop')   return `beskuren ${op.width}×${op.height}`;
  if (op.type === 'flip')   return `speglad`;
  return op.type;
}

const ACTION_LABELS = {
  upload:           { icon: '⬆️', text: (r) => `laddade upp ${r.meta?.count ?? 1} fil${(r.meta?.count ?? 1) !== 1 ? 'er' : ''}` },
  edit_metadata:    { icon: '✏️', text: (r) => `redigerade metadata${r.file_name ? ` på "${r.file_name}"` : ''}` },
  edit_replace:     { icon: '🔄', text: (r) => `redigerade${r.file_name ? ` "${r.file_name}"` : ' en fil'}` },
  edit_copy:        { icon: '📋', text: (r) => `skapade en kopia${r.file_name ? ` av "${r.file_name}"` : ''}` },
  trash:            { icon: '🗑️', text: (r) => `skickade ${r.file_name ? `"${r.file_name}"` : 'en fil'} till papperskorgen` },
  restore:          { icon: '♻️', text: (r) => `återställde ${r.file_name ? `"${r.file_name}"` : 'en fil'}` },
  permanent_delete: { icon: '❌', text: (r) => `raderade permanent ${r.file_name ? `"${r.file_name}"` : 'en fil'}` },
  share:            { icon: '🔗', text: (r) => `delade ${r.file_name ? `"${r.file_name}"` : 'en fil'}` },
  login:            { icon: '🔐', text: ()  => 'loggade in' },
  comment:          { icon: '💬', text: (r) => `kommenterade${r.file_name ? ` på "${r.file_name}"` : ''}` },
  reaction:         { icon: '❤️', text: (r) => `reagerade${r.file_name ? ` på "${r.file_name}"` : ''}` },
};

function fmtTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.round(diffMs / 60_000);
  const diffH   = Math.round(diffMs / 3_600_000);
  const diffD   = Math.round(diffMs / 86_400_000);
  if (diffMin < 2)  return 'just nu';
  if (diffMin < 60) return `${diffMin} min sedan`;
  if (diffH   < 24) return `${diffH} tim sedan`;
  if (diffD   <  7) return `${diffD} dag${diffD > 1 ? 'ar' : ''} sedan`;
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function groupByDay(rows) {
  const groups = [];
  let current = null;
  for (const r of rows) {
    const day = new Date(r.created_at).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (day !== current) {
      groups.push({ day, items: [] });
      current = day;
    }
    groups[groups.length - 1].items.push(r);
  }
  return groups;
}

export async function renderActivity(container) {
  container.innerHTML = `
    <div class="max-w-2xl mx-auto p-4">
      <div class="flex items-center justify-between mb-5">
        <h1 class="text-xl font-semibold text-white">Aktivitet</h1>
        <span id="act-loading" class="text-xs text-slate-500"></span>
      </div>
      <div id="act-feed" class="space-y-6"></div>
      <div class="mt-6 flex justify-center">
        <button id="act-more"
          class="hidden px-4 py-2 text-sm text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">
          Ladda fler
        </button>
      </div>
    </div>`;

  const feed    = container.querySelector('#act-feed');
  const loading = container.querySelector('#act-loading');
  const moreBtn = container.querySelector('#act-more');

  let offset = 0;
  const LIMIT = 60;
  let allRows = [];

  async function loadMore() {
    loading.textContent = 'Laddar…';
    moreBtn.classList.add('hidden');
    try {
      const { data } = await api.activity({ limit: LIMIT, offset });
      allRows = allRows.concat(data);
      offset += data.length;
      renderFeed(allRows);
      if (data.length === LIMIT) moreBtn.classList.remove('hidden');
    } catch (e) {
      feed.innerHTML = `<p class="text-red-400 text-sm">${e.message}</p>`;
    } finally {
      loading.textContent = '';
    }
  }

  function renderFeed(rows) {
    if (!rows.length) {
      feed.innerHTML = '<p class="text-slate-500 text-sm">Ingen aktivitet ännu.</p>';
      return;
    }
    const groups = groupByDay(rows);
    feed.innerHTML = groups.map((g) => `
      <div>
        <div class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3 capitalize">${g.day}</div>
        <div class="space-y-0.5">
          ${g.items.map((r) => renderItem(r)).join('')}
        </div>
      </div>`).join('');

    // Klickbara thumbnails öppnar lightboxen
    feed.querySelectorAll('[data-asset-id]').forEach((el) => {
      el.addEventListener('click', () => {
        openLightbox([{
          id:               el.dataset.assetId,
          file_name:        el.dataset.fileName,
          mime_type:        el.dataset.mime ?? 'image/jpeg',
          thumb_small_path: el.dataset.thumb ?? null,
        }], 0);
      });
    });
  }

  function renderItem(r) {
    const def    = ACTION_LABELS[r.action] ?? { icon: '📌', text: () => r.action };
    const label  = def.text(r);
    const detail = describeMetaChanges(r.meta);
    const actor  = r.username ?? 'Okänd';
    const initial = actor[0].toUpperCase();
    const hasThumb = r.target_type === 'asset' && r.target_id && r.thumb_small_path;

    return `
      <div class="flex items-start gap-3 px-2 py-2.5 rounded-xl hover:bg-slate-800/50 transition-colors group">
        <!-- Avatar -->
        <div class="flex-shrink-0 w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center
                    text-xs font-semibold text-white mt-0.5">
          ${initial}
        </div>

        <!-- Text -->
        <div class="flex-1 min-w-0">
          <p class="text-sm text-slate-200 leading-snug">
            <span class="font-medium">${escHtml(actor)}</span>
            <span class="text-slate-400"> ${escHtml(label)}</span>
          </p>
          ${detail ? `<p class="text-xs text-slate-500 mt-0.5">${escHtml(detail)}</p>` : ''}
          <p class="text-xs text-slate-600 mt-0.5">${fmtTime(r.created_at)}</p>
        </div>

        <!-- Thumbnail -->
        ${hasThumb ? `
          <div class="flex-shrink-0 cursor-pointer rounded-lg overflow-hidden ring-1 ring-slate-700
                      hover:ring-blue-500/60 transition-all"
               data-asset-id="${r.target_id}"
               data-file-name="${escAttr(r.file_name ?? '')}"
               data-thumb="${escAttr(r.thumb_small_path ?? '')}">
            <img src="/thumbs/${escAttr(r.thumb_small_path)}"
                 class="w-12 h-12 object-cover"
                 loading="lazy" alt="${escAttr(r.file_name ?? '')}"/>
          </div>` : `
          <div class="flex-shrink-0 w-10 h-10 rounded-lg bg-slate-800/80 flex items-center justify-center text-lg">
            ${def.icon}
          </div>`}
      </div>`;
  }

  moreBtn.addEventListener('click', loadMore);
  await loadMore();
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escAttr(s) {
  return String(s ?? '').replace(/"/g,'&quot;');
}
