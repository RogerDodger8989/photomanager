import { toast } from '../utils.js';

export function renderUpload(container) {
  container.innerHTML = `
    <div class="p-4 max-w-2xl mx-auto">
      <h1 class="text-xl font-semibold text-white mb-1">Ladda upp foton & videor</h1>
      <p class="text-sm text-slate-400 mb-6">Välj filer eller en hel mapp från din dator.</p>

      <!-- Subfolder -->
      <div class="mb-4">
        <label class="block text-xs text-slate-400 mb-1">Spara i undermapp (valfritt)</label>
        <input id="upload-subfolder" type="text" placeholder="t.ex. Semester/2024"
          class="w-full bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-700 focus:outline-none focus:border-blue-500">
      </div>

      <!-- Välj-knappar -->
      <div class="flex gap-3 mb-4">
        <button id="pick-files-btn"
          class="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-xl transition-colors border border-slate-600">
          🖼️ Välj filer
        </button>
        <button id="pick-folder-btn"
          class="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-xl transition-colors border border-slate-600">
          📁 Välj mapp
        </button>
        <input id="file-input" type="file" multiple accept="image/*,video/*" class="hidden">
        <input id="folder-input" type="file" webkitdirectory multiple accept="image/*,video/*" class="hidden">
      </div>

      <!-- Drop zone -->
      <div id="drop-zone"
        class="border-2 border-dashed border-slate-700 rounded-2xl p-8 text-center transition-colors">
        <div class="text-slate-500 text-sm">eller dra & släpp filer/mappar här</div>
      </div>

      <!-- Filkö -->
      <div id="upload-queue" class="mt-4 space-y-1.5 hidden"></div>

      <!-- Starta uppladdning -->
      <div id="upload-actions" class="mt-4 hidden">
        <button id="start-upload-btn"
          class="w-full py-3 bg-green-600 hover:bg-green-500 text-white font-medium rounded-xl transition-colors">
          Ladda upp
        </button>
      </div>

      <!-- Resultat -->
      <div id="upload-result" class="mt-4 hidden"></div>
    </div>`;

  const fileInput   = container.querySelector('#file-input');
  const folderInput = container.querySelector('#folder-input');
  const dropZone    = container.querySelector('#drop-zone');
  const queueEl     = container.querySelector('#upload-queue');
  const actionsEl   = container.querySelector('#upload-actions');
  const resultEl    = container.querySelector('#upload-result');
  const subfolderEl = container.querySelector('#upload-subfolder');

  let selectedFiles = [];

  // Välj enskilda filer
  container.querySelector('#pick-files-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => addFiles([...fileInput.files]));

  // Välj hel mapp — försök modern API först, fallback till input
  container.querySelector('#pick-folder-btn').addEventListener('click', async () => {
    if ('showDirectoryPicker' in window) {
      try {
        const dirHandle = await window.showDirectoryPicker();
        const files = await readDirHandle(dirHandle);
        addFiles(files);
        return;
      } catch (e) {
        if (e.name === 'AbortError') return; // användaren avbröt
      }
    }
    // Fallback för äldre webbläsare
    folderInput.click();
  });
  folderInput.addEventListener('change', () => addFiles([...folderInput.files]));

  // Drag & drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-blue-500', 'bg-slate-800/50');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-blue-500', 'bg-slate-800/50');
  });
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-blue-500', 'bg-slate-800/50');
    const files = await getDroppedFiles(e.dataTransfer.items);
    addFiles(files);
  });

  function addFiles(files) {
    const allowed = files.filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    const skipped = files.length - allowed.length;
    if (skipped > 0) toast(`${skipped} fil(er) hoppades över (ej bild/video)`, 'warning');
    if (allowed.length === 0) return;
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

    const btn = container.querySelector('#start-upload-btn');
    btn.textContent = `Ladda upp ${selectedFiles.length} fil${selectedFiles.length > 1 ? 'er' : ''}`;

    queueEl.innerHTML = `
      <div class="flex items-center justify-between text-xs text-slate-400 px-1 mb-1">
        <span>${selectedFiles.length} filer valda</span>
        <button id="clear-queue" class="hover:text-red-400">Rensa allt</button>
      </div>
      ${selectedFiles.slice(0, 50).map((f, i) => `
        <div class="flex items-center gap-3 bg-slate-800 rounded-xl px-4 py-2">
          <span>${f.type.startsWith('video/') ? '🎬' : '🖼️'}</span>
          <span class="flex-1 text-sm text-slate-300 truncate">${f.name}</span>
          <span class="text-xs text-slate-500">${formatSize(f.size)}</span>
          <button class="remove-file text-slate-500 hover:text-red-400 text-lg leading-none" data-idx="${i}">×</button>
        </div>`).join('')}
      ${selectedFiles.length > 50 ? `<div class="text-xs text-slate-500 px-1">…och ${selectedFiles.length - 50} till</div>` : ''}`;

    queueEl.querySelector('#clear-queue').addEventListener('click', () => {
      selectedFiles = [];
      renderQueue();
    });
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
      const res = await fetch('/api/upload', {
        method: 'POST',
        credentials: 'include',
        headers: window.__pmToken ? { Authorization: `Bearer ${window.__pmToken}` } : {},
        body: formData,
      });
      if (!res.ok) throw new Error(`Uppladdning misslyckades (${res.status})`);
      const { data } = await res.json();

      resultEl.classList.remove('hidden');
      resultEl.innerHTML = `
        <div class="bg-green-900/40 border border-green-700 rounded-xl p-4">
          <div class="text-green-300 font-medium">✓ ${data.uploaded.length} fil${data.uploaded.length !== 1 ? 'er' : ''} uppladdad${data.uploaded.length !== 1 ? 'e' : ''}</div>
          ${data.errors.length ? `<div class="text-red-400 text-sm mt-2">${data.errors.join('<br>')}</div>` : ''}
          <div class="text-slate-400 text-sm mt-1">Bilderna indexeras automatiskt och syns i biblioteket inom kort.</div>
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

// Läs filer rekursivt från en FileSystemDirectoryHandle (showDirectoryPicker)
async function readDirHandle(handle, files = []) {
  for await (const [, entry] of handle) {
    if (entry.kind === 'file') {
      files.push(await entry.getFile());
    } else if (entry.kind === 'directory') {
      await readDirHandle(entry, files);
    }
  }
  return files;
}

// Hämta filer från drag & drop (inkl. mappar)
async function getDroppedFiles(items) {
  const files = [];
  const promises = [];
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) promises.push(readEntry(entry, files));
    else if (item.kind === 'file') files.push(item.getAsFile());
  }
  await Promise.all(promises);
  return files;
}

async function readEntry(entry, files) {
  if (entry.isFile) {
    await new Promise((res) => entry.file((f) => { files.push(f); res(); }));
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    await new Promise((res) => {
      reader.readEntries(async (entries) => {
        await Promise.all(entries.map((e) => readEntry(e, files)));
        res();
      });
    });
  }
}

function formatSize(bytes) {
  const n = Number(bytes);
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(1)} ${units[i]}`;
}
