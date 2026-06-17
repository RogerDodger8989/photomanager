import { api } from '../api.js';
import { toast, formatDate, isVideo } from '../utils.js';
import { state } from '../state.js';

let currentIndex = 0;
let items = [];

const lb          = document.getElementById('lightbox');
const lbImg       = document.getElementById('lb-img');
const lbVideo     = document.getElementById('lb-video');
const lbFaces     = document.getElementById('lb-faces');
const lbInfo      = document.getElementById('lb-info');
const lbMetaPanel = document.getElementById('lb-meta-panel');
const lbMetaCont  = document.getElementById('lb-meta-content');

export function openLightbox(assetItems, startIndex = 0) {
  items        = assetItems;
  currentIndex = startIndex;
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
  showItem(currentIndex);
}

export function closeLightbox() {
  lb.classList.remove('open');
  document.body.style.overflow = '';
  lbVideo.pause();
  lbVideo.src = '';
  lbMetaPanel.classList.add('hidden');
}

function showItem(idx) {
  const asset = items[idx];
  if (!asset) return;
  currentIndex = idx;

  const isVid = isVideo(asset.mime_type);

  lbImg.classList.toggle('hidden',  isVid);
  lbVideo.classList.toggle('hidden', !isVid);

  if (isVid) {
    lbVideo.src = `/api/assets/${asset.id}/stream`;
    lbVideo.load();
  } else {
    lbImg.src = `/thumbs/${asset.thumb_large_path ?? asset.thumb_small_path}`;
    lbImg.alt = asset.file_name;
  }

  // Info i toppen
  const dateStr = asset.taken_at ? formatDate(asset.taken_at) : '';
  const loc     = asset.location_label ? ` · ${asset.location_label}` : '';
  lbInfo.textContent = `${dateStr}${loc}`;

  // Ansiktsöverlager (asynkront)
  lbFaces.innerHTML = '';
  if (!isVid) loadFaceOverlays(asset.id);

  // Uppdatera favorit-knapp
  document.getElementById('lb-download').onclick = () => {
    window.location = `/api/assets/${asset.id}/original`;
  };

  // Stäng meta-panel
  lbMetaPanel.classList.add('hidden');
}

async function loadFaceOverlays(assetId) {
  try {
    const { data: faces } = await api.faces(assetId);
    if (!faces?.length) return;

    const imgRect = lbImg.getBoundingClientRect();
    for (const f of faces) {
      if (!f.person_name) continue;
      const box = document.createElement('div');
      box.className = 'face-box';
      box.style.left   = `${f.region_x * 100}%`;
      box.style.top    = `${f.region_y * 100}%`;
      box.style.width  = `${f.region_w * 100}%`;
      box.style.height = `${f.region_h * 100}%`;
      const label = document.createElement('div');
      label.className = 'face-label';
      label.textContent = f.person_name;
      box.appendChild(label);
      lbFaces.appendChild(box);
    }
  } catch {}
}

// Metadata-panel
document.getElementById('lb-info-btn').addEventListener('click', async () => {
  const asset = items[currentIndex];
  if (!asset) return;
  const isVisible = !lbMetaPanel.classList.contains('hidden');
  lbMetaPanel.classList.toggle('hidden', isVisible);
  if (!isVisible) return;

  lbMetaCont.innerHTML = '<div class="col-span-3 text-slate-400 text-xs">Laddar…</div>';
  try {
    const { data } = await api.asset(asset.id);
    const rows = [
      ['Filnamn', data.file_name],
      ['Storlek', `${(data.file_size / 1024 / 1024).toFixed(2)} MB`],
      ['Dimensioner', data.width ? `${data.width} × ${data.height}px` : '–'],
      ['Datum', formatDate(data.taken_at)],
      ['Plats', data.location_label ?? '–'],
      ['Format', data.mime_type],
      ['Taggar', (data.tags ?? []).join(', ') || '–'],
      ['Visningar', data.view_count],
    ];
    lbMetaCont.innerHTML = rows.map(([k, v]) => `
      <div><span class="text-slate-400 text-xs">${k}</span><div class="text-sm text-white mt-0.5 truncate">${v ?? '–'}</div></div>
    `).join('');
  } catch {
    lbMetaCont.innerHTML = '<div class="col-span-3 text-red-400 text-xs">Kunde inte hämta metadata</div>';
  }
});

// Favorit-knapp
document.getElementById('lb-favorite').addEventListener('click', async () => {
  const asset = items[currentIndex];
  if (!asset) return;
  try {
    await api.addFav(asset.id);
    toast('Tillagd som favorit', 'success');
  } catch {
    toast('Kunde inte lägga till favorit', 'error');
  }
});

// Dela-knapp
document.getElementById('lb-share').addEventListener('click', async () => {
  const asset = items[currentIndex];
  if (!asset) return;
  try {
    const { data } = await api.createShare({ shareType: 'public_link', assetId: asset.id });
    const url = `${location.origin}${data.publicUrl}`;
    await navigator.clipboard.writeText(url);
    toast('Delningslänk kopierad!', 'success');
  } catch {
    toast('Kunde inte skapa delningslänk', 'error');
  }
});

// Prev/Next
document.getElementById('lb-prev').addEventListener('click', () => {
  if (currentIndex > 0) showItem(currentIndex - 1);
});
document.getElementById('lb-next').addEventListener('click', () => {
  if (currentIndex < items.length - 1) showItem(currentIndex + 1);
});

// Tangentbord
window.addEventListener('keydown', (e) => {
  if (!lb.classList.contains('open')) return;
  if (e.key === 'Escape')      closeLightbox();
  if (e.key === 'ArrowLeft')   { if (currentIndex > 0) showItem(currentIndex - 1); }
  if (e.key === 'ArrowRight')  { if (currentIndex < items.length - 1) showItem(currentIndex + 1); }
});

// Klick utanför stänger
lb.addEventListener('click', (e) => {
  if (e.target === lb) closeLightbox();
});

document.getElementById('lb-close').addEventListener('click', closeLightbox);
