// Formatera bytes till läsbart format
export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

// Formatera datum
export function formatDate(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString('sv-SE', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

export function formatDateTime(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('sv-SE', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// Toast-notiser
export function toast(msg, type = 'info', duration = 3500) {
  const colors = { info: 'bg-slate-700', success: 'bg-green-800', error: 'bg-red-800', warn: 'bg-yellow-800' };
  const el = document.createElement('div');
  el.className = `toast ${colors[type] ?? colors.info} text-white text-sm px-4 py-3 rounded-lg shadow-lg max-w-xs`;
  el.textContent = msg;
  document.getElementById('toast-container').prepend(el);
  setTimeout(() => el.remove(), duration);
}

// Bekräftelsedialog (ersätter window.confirm)
export function confirm(msg) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 flex items-center justify-center z-[9999]';
    overlay.innerHTML = `
      <div class="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <p class="text-white mb-5">${msg}</p>
        <div class="flex gap-3 justify-end">
          <button id="conf-no"  class="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-700 text-sm">Avbryt</button>
          <button id="conf-yes" class="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm">Bekräfta</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#conf-yes').onclick = () => { overlay.remove(); resolve(true); };
    overlay.querySelector('#conf-no').onclick  = () => { overlay.remove(); resolve(false); };
  });
}

// Enkel modal
export function modal(titleText, contentHtml, footerHtml = '') {
  const el = document.createElement('div');
  el.className = 'fixed inset-0 bg-black/60 flex items-center justify-center z-[9998] p-4';
  el.innerHTML = `
    <div class="bg-slate-800 border border-slate-700 rounded-xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl">
      <div class="flex items-center justify-between px-5 py-4 border-b border-slate-700">
        <h2 class="font-semibold text-white">${titleText}</h2>
        <button class="modal-close text-slate-400 hover:text-white">✕</button>
      </div>
      <div class="flex-1 overflow-y-auto p-5">${contentHtml}</div>
      ${footerHtml ? `<div class="px-5 py-4 border-t border-slate-700 flex justify-end gap-3">${footerHtml}</div>` : ''}
    </div>`;
  document.body.appendChild(el);
  el.querySelector('.modal-close').onclick = () => el.remove();
  el.onclick = (e) => { if (e.target === el) el.remove(); };
  return el;
}

// Debounce
export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// Skapa thumbnail-URL
export function thumbUrl(path, size = 'small') {
  if (!path) return '/icons/placeholder.svg';
  return `/thumbs/${path}`;
}

// Är det en video?
export function isVideo(mimeType) {
  return mimeType?.startsWith('video/') ?? false;
}
