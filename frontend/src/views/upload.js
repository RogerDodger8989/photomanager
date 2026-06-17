import { toast } from '../utils.js';

export function renderUpload(container) {
  container.innerHTML = `
    <div class="p-4 max-w-2xl mx-auto">
      <h1 class="text-xl font-semibold text-white mb-1">Ladda upp foton & videor</h1>
      <p class="text-sm text-slate-400 mb-6">Filerna placeras i ditt fotobibliotek och indexeras automatiskt.</p>

      <!-- Subfolder -->
      <div class="mb-4">
        <label class="block text-xs text-slate-400 mb-1">Spara i mapp (valfritt)</label>
        <input id="upload-subfolder" type="text" placeholder="t.ex. Semester/2024"
          class="w-full bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-700 focus:outline-none focus:border-blue-500">
      </div>

      <!-- Drop zone -->
      <div id="drop-zone"
        class="border-2 border-dashed border-slate-600 rounded-2xl p-10 text-center cursor-pointer transition-colors hover:border-blue-500 hover:bg-slate-800/50">
        <div class="text-4xl mb-3">📁</div>
        <div class="text-slate-300 font-medium mb-1">Dra & släpp filer här</div>
        <div class="text-slate-500 text-sm mb-4">eller klicka för att välja</div>
        <button id="pick-files-btn"
          class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
          Välj filer
        </button>
        <input id="file-input" type="file" multiple accept="image/*,video/*" class="hidden">
      </div>

      <!-- Filkö -->
      <div id="upload-queue" class="mt-4 space-y-2 hidden"></div>

      <!-- Starta uppladdning -->
      <div id="upload-actions" class="mt-4 hidden">
        <button id="start-upload-btn"
          class="w-full py-2.5 bg-green-600 hover:bg-green-500 text-white font-medium rounded-xl transition-colors">
          Ladda upp
        </button>
      </div>

      <!-- Resultat -->
      <div id="upload-result" class="mt-4 hidden"></div>
    </div>`;

  const dropZone    = container.querySelector('#drop-zone');
  const fileInput   = container.querySelector('#file-input');
  const pickBtn     = container.querySelector('#pick-files-btn');
  const queueEl     = container.querySelector('#upload-queue');
  const actionsEl   = container.querySelector('#upload-actions');
  const resultEl    = container.querySelector('#upload-result');
  const subfolderEl = container.querySelector('#upload-subfolder');

  let selectedFiles = [];

  // Klick → öppna filväljare
  pickBtn.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('click', (e) => {
    if (e.target === dropZone) fileInput.click();
  });

  fileInput.addEventListener('change', () => addFiles([...fileInput.files]));

  // Drag & drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-blue-400', 'bg-slate-800/70');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-blue-400', 'bg-slate-800/70');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-blue-400', 'bg-slate-800/70');
    addFiles([...e.dataTransfer.files]);
  });

  function addFiles(files) {
    const allowed = files.filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    const skipped = files.length - allowed.length;
    if (skipped > 0) toast(`${skipped} fil(er) hoppades över (ej bild/video)`, 'warning');

    selectedFiles = [...selectedFiles, ...allowed];
    renderQueue();
  }

  function renderQueue() {
    if (selectedFiles.length === 0) {
      queueEl.classList.add('hidden');
      actionsEl.classList.add('hidden');
      return;
    }
    queueEl.classList.remove('hidden');
    actionsEl.classList.remove('hidden');

    queueEl.innerHTML = selectedFiles.map((f, i) => `
      <div class="flex items-center gap-3 bg-slate-800 rounded-xl px-4 py-2.5" data-idx="${i}">
        <span class="text-lg">${f.type.startsWith('video/') ? '🎬' : '🖼️'}</span>
        <span class="flex-1 text-sm text-slate-300 truncate">${f.name}</span>
        <span class="text-xs text-slate-500">${formatSize(f.size)}</span>
        <button class="remove-file text-slate-500 hover:text-red-400 text-lg leading-none" data-idx="${i}">×</button>
        <div class="progress-bar w-0 h-1 bg-blue-500 rounded-full absolute bottom-0 left-0 transition-all" style="display:none"></div>
      </div>`).join('');

    queueEl.querySelectorAll('.remove-file').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedFiles.splice(Number(btn.dataset.idx), 1);
        renderQueue();
      });
    });
  }

  container.querySelector('#start-upload-btn').addEventListener('click', startUpload);

  async function startUpload() {
    if (selectedFiles.length === 0) return;

    const btn = container.querySelector('#start-upload-btn');
    btn.disabled = true;
    btn.textContent = 'Laddar upp…';

    const formData = new FormData();
    const subfolder = subfolderEl.value.trim();
    if (subfolder) formData.append('subfolder', subfolder);
    selectedFiles.forEach((f) => formData.append('files', f));

    try {
      // Hämta token från localStorage/memory via cookie — fetch med credentials
      const res = await fetch('/api/upload', {
        method: 'POST',
        credentials: 'include',
        headers: {
          // accessToken hämtas från api-modulens internstate via window
          ...(window.__pmToken ? { Authorization: `Bearer ${window.__pmToken}` } : {}),
        },
        body: formData,
      });

      if (!res.ok) throw new Error(`Uppladdning misslyckades (${res.status})`);
      const { data } = await res.json();

      resultEl.classList.remove('hidden');
      resultEl.innerHTML = `
        <div class="bg-green-900/40 border border-green-700 rounded-xl p-4">
          <div class="text-green-300 font-medium mb-1">✓ ${data.uploaded.length} fil(er) uppladdade</div>
          ${data.errors.length ? `<div class="text-red-400 text-sm mt-2">${data.errors.join('<br>')}</div>` : ''}
          <div class="text-slate-400 text-sm mt-2">Bilderna indexeras automatiskt och syns i biblioteket inom kort.</div>
        </div>`;

      selectedFiles = [];
      renderQueue();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ladda upp';
    }
  }
}

function formatSize(bytes) {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
