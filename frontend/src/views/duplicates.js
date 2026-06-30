import { api } from '../api.js';
import { toast } from '../utils.js';
import { openLightbox } from '../components/lightbox.js';

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return (bytes / 1e3).toFixed(0) + ' KB';
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' });
}

function folderOf(filePath) {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '/';
}

function renderCard(asset, isOriginal) {
  const thumb = asset.thumb_small_path
    ? `/media/thumbs/${asset.thumb_small_path}`
    : null;
  const isTrashed = asset.status === 'trashed';

  const ringClass = isTrashed
    ? 'ring-2 ring-slate-500'
    : isOriginal
      ? 'ring-2 ring-blue-500'
      : 'ring-2 ring-yellow-500';

  const badge = isTrashed
    ? `<div class="absolute top-1 left-1 bg-slate-700 text-slate-300 text-[10px] rounded px-1.5 py-0.5">🗑 Papperskorg</div>`
    : isOriginal
      ? `<div class="absolute top-1 left-1 bg-blue-600 text-white text-[10px] rounded px-1.5 py-0.5">⭐ Original</div>`
      : `<div class="absolute top-1 left-1 bg-yellow-600 text-white text-[10px] rounded px-1.5 py-0.5">Kopia</div>`;

  const resolution = (asset.width && asset.height)
    ? `${asset.width} × ${asset.height}`
    : '—';

  const faceBadge = asset.face_count > 0
    ? `<span class="bg-slate-700 text-slate-300 rounded px-1.5 py-0.5">👤 ${asset.face_count}</span>`
    : '';
  const tagBadge = asset.tag_count > 0
    ? `<span class="bg-slate-700 text-slate-300 rounded px-1.5 py-0.5">🏷 ${asset.tag_count}</span>`
    : '';

  return `
    <div class="dup-card flex-shrink-0 w-48 bg-slate-800 rounded-xl overflow-hidden" data-id="${asset.id}" data-trashed="${isTrashed}">
      <div class="relative aspect-square bg-slate-900 ${ringClass} rounded-t-xl overflow-hidden">
        ${thumb
          ? `<img src="${thumb}" class="w-full h-full object-cover" loading="lazy">`
          : `<div class="w-full h-full flex items-center justify-center text-slate-600 text-3xl">🖼</div>`}
        ${badge}
      </div>
      <div class="p-2 space-y-1.5">
        <p class="text-white text-xs font-medium truncate" title="${asset.file_name}">${asset.file_name}</p>
        <p class="text-slate-400 text-[10px] truncate" title="${folderOf(asset.file_path)}">📁 ${folderOf(asset.file_path)}</p>
        <div class="text-slate-400 text-[10px] space-y-0.5">
          <div class="flex justify-between"><span>Storlek</span><span>${formatBytes(asset.file_size)}</span></div>
          <div class="flex justify-between"><span>Upplösning</span><span>${resolution}</span></div>
          <div class="flex justify-between"><span>Taget</span><span>${formatDate(asset.taken_at)}</span></div>
          <div class="flex justify-between"><span>Indexerat</span><span>${formatDate(asset.indexed_at)}</span></div>
        </div>
        ${(faceBadge || tagBadge) ? `<div class="flex gap-1 flex-wrap text-[10px]">${faceBadge}${tagBadge}</div>` : ''}
        <div class="flex gap-1.5 pt-1">
          <button class="dup-view-btn flex-1 py-1 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded-lg transition-colors">Visa</button>
          ${!isTrashed
            ? `<button class="dup-trash-btn py-1 px-2 bg-red-900/50 hover:bg-red-800 text-red-300 text-xs rounded-lg transition-colors">🗑</button>`
            : ''}
        </div>
      </div>
    </div>`;
}

function renderGroup(group, index) {
  const assets = group.assets;
  const copies = assets.slice(1);

  return `
    <div class="dup-group bg-slate-900 rounded-2xl p-4 mb-4" data-hash="${group.file_hash}" data-index="${index}">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-white text-sm font-semibold">${assets.length} kopior av samma fil</h3>
        <button class="dup-keep-oldest-btn py-1 px-3 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors"
          data-original-id="${assets[0].id}">
          Behåll original, radera resten
        </button>
      </div>
      <div class="flex gap-3 overflow-x-auto pb-2">
        ${assets.map((a, i) => renderCard(a, i === 0)).join('')}
      </div>
    </div>`;
}

// ── Perceptuell dublikatvy ────────────────────────────────────────────────────

function renderPercGroup(group, index) {
  return `
    <div class="perc-group bg-slate-900 rounded-2xl p-4 mb-4" data-index="${index}">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-white text-sm font-semibold">${group.length} nästan-identiska bilder</h3>
      </div>
      <div class="flex gap-3 overflow-x-auto pb-2">
        ${group.map((a, i) => renderCard(a, i === 0)).join('')}
      </div>
    </div>`;
}

// ── Huvud-export ─────────────────────────────────────────────────────────────

export async function renderDuplicates(container) {
  container.innerHTML = `
    <div class="p-4 max-w-5xl mx-auto">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-xl font-semibold text-white">🔁 Dublikat</h1>
        <button id="dup-clean-all-btn"
          class="hidden py-2 px-4 bg-red-900/60 hover:bg-red-800 text-red-300 text-sm rounded-xl transition-colors border border-red-800">
          Radera alla kopior (behåll original)
        </button>
      </div>

      <div class="flex gap-2 mb-4">
        <button id="tab-exact"
          class="dup-tab py-1.5 px-4 rounded-lg text-sm font-medium bg-blue-600 text-white">
          Exakta kopior
        </button>
        <button id="tab-similar"
          class="dup-tab py-1.5 px-4 rounded-lg text-sm font-medium bg-slate-700 text-slate-300 hover:bg-slate-600">
          Nästan identiska
        </button>
      </div>

      <p id="dup-subtitle" class="text-sm text-slate-400 mb-4">Laddar…</p>
      <div id="dup-list"></div>
    </div>`;

  let groups = [];
  let percGroups = [];
  let activeTab = 'exact';

  function switchTab(tab) {
    activeTab = tab;
    container.querySelector('#tab-exact').className =
      `dup-tab py-1.5 px-4 rounded-lg text-sm font-medium ${tab === 'exact' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`;
    container.querySelector('#tab-similar').className =
      `dup-tab py-1.5 px-4 rounded-lg text-sm font-medium ${tab === 'similar' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`;
    render();
  }

  async function load() {
    try {
      const { data } = await api.duplicates();
      groups = data ?? [];
    } catch {
      container.querySelector('#dup-subtitle').textContent = 'Kunde inte ladda dublikater.';
    }
    render();
  }

  async function loadPerceptual() {
    const subtitle = container.querySelector('#dup-subtitle');
    subtitle.textContent = 'Analyserar nästan-identiska bilder…';
    try {
      const { data } = await api.perceptualDuplicates(10);
      percGroups = data ?? [];
    } catch {
      subtitle.textContent = 'Kunde inte analysera.';
      return;
    }
    render();
  }

  function render() {
    const list = container.querySelector('#dup-list');
    const subtitle = container.querySelector('#dup-subtitle');
    const cleanBtn = container.querySelector('#dup-clean-all-btn');

    if (activeTab === 'exact') {
      cleanBtn.classList.toggle('hidden', groups.length === 0);
      if (groups.length === 0) {
        subtitle.textContent = 'Inga exakta dublikater hittades.';
        list.innerHTML = `<div class="text-center text-slate-500 py-16 text-4xl">✅</div>
          <p class="text-center text-slate-400 text-sm">Alla filer är unika.</p>`;
        return;
      }
      subtitle.textContent = `${groups.length} grupp${groups.length !== 1 ? 'er' : ''} med exakta kopior`;
      list.innerHTML = groups.map(renderGroup).join('');
    } else {
      cleanBtn.classList.add('hidden');
      if (percGroups.length === 0) {
        subtitle.textContent = 'Inga nästan-identiska bilder hittades (threshold 10 bitar).';
        list.innerHTML = `<div class="text-center text-slate-500 py-16 text-4xl">✅</div>
          <p class="text-center text-slate-400 text-sm">Inga nästan-identiska bilder.</p>`;
        return;
      }
      subtitle.textContent = `${percGroups.length} grupp${percGroups.length !== 1 ? 'er' : ''} med nästan-identiska bilder`;
      list.innerHTML = percGroups.map((g, i) => renderPercGroup(g, i)).join('');
    }
  }

  // Tab-switch
  container.addEventListener('click', async (e) => {
    const tabBtn = e.target.closest('.dup-tab');
    if (tabBtn) {
      const newTab = tabBtn.id === 'tab-exact' ? 'exact' : 'similar';
      if (newTab === activeTab) return;
      switchTab(newTab);
      if (newTab === 'similar' && percGroups.length === 0) await loadPerceptual();
      return;
    }

    // Visa bild i lightbox
    const viewBtn = e.target.closest('.dup-view-btn');
    if (viewBtn) {
      const card = viewBtn.closest('.dup-card');
      const id = card?.dataset.id;
      if (!id) return;
      const allGroups = activeTab === 'exact' ? groups.map(g => g.assets) : percGroups;
      for (const group of allGroups) {
        const assetList = group.assets ?? group;
        const asset = assetList.find(a => a.id === id);
        if (asset) { openLightbox(assetList, assetList.indexOf(asset)); break; }
      }
      return;
    }

    // Radera enskild kopia
    const trashBtn = e.target.closest('.dup-trash-btn');
    if (trashBtn) {
      const card = trashBtn.closest('.dup-card');
      const group = trashBtn.closest('.dup-group, .perc-group');
      if (!card || !group) return;
      const id = card.dataset.id;
      try {
        await api.trash(id);
        card.remove();
        const remaining = group.querySelectorAll('.dup-card');
        if (remaining.length <= 1) {
          if (activeTab === 'exact') {
            const hash = group.dataset.hash;
            groups = groups.filter(g => g.file_hash !== hash);
          } else {
            const idx = parseInt(group.dataset.index);
            percGroups.splice(idx, 1);
          }
          group.remove();
          render();
        } else if (activeTab === 'exact') {
          remaining[0].querySelector('.absolute.top-1').outerHTML =
            `<div class="absolute top-1 left-1 bg-blue-600 text-white text-[10px] rounded px-1.5 py-0.5">⭐ Original</div>`;
          group.querySelector('h3').textContent = `${remaining.length} kopior av samma fil`;
        }
        toast('Flyttad till papperskorgen');
      } catch {
        toast('Kunde inte radera', 'error');
      }
      return;
    }

    // Behåll original, radera resten (per grupp)
    const keepBtn = e.target.closest('.dup-keep-oldest-btn');
    if (keepBtn) {
      const group = keepBtn.closest('.dup-group');
      if (!group) return;
      const cards = [...group.querySelectorAll('.dup-card')];
      const copies = cards.slice(1).filter(c => c.dataset.trashed !== 'true');
      if (copies.length === 0) { toast('Inga kopior att radera'); return; }
      keepBtn.disabled = true;
      keepBtn.textContent = 'Raderar…';
      let failed = 0;
      for (const card of copies) {
        try { await api.trash(card.dataset.id); card.remove(); } catch { failed++; }
      }
      const hash = group.dataset.hash;
      groups = groups.filter(g => g.file_hash !== hash);
      group.remove();
      render();
      toast(failed ? `Klar — ${failed} misslyckades` : 'Kopior raderade');
      return;
    }

    // Radera alla kopior globalt (exakta)
    const cleanAllBtn = e.target.closest('#dup-clean-all-btn');
    if (cleanAllBtn) {
      if (!confirm(`Radera alla kopior i ${groups.length} grupper? Originalet (äldst indexerat) behålls.`)) return;
      cleanAllBtn.disabled = true;
      cleanAllBtn.textContent = 'Arbetar…';
      let deleted = 0, failed = 0;
      for (const group of groups) {
        const copies = group.assets.slice(1).filter(a => a.status !== 'trashed');
        for (const asset of copies) {
          try { await api.trash(asset.id); deleted++; } catch { failed++; }
        }
      }
      groups = [];
      render();
      toast(failed
        ? `${deleted} raderade, ${failed} misslyckades`
        : `${deleted} kopio${deleted !== 1 ? 'r' : 'a'} raderade`
      );
    }
  });

  await load();
}
