import chokidar from 'chokidar';
import { config } from '../config.js';
import { indexFile, removeFileFromIndex } from './indexer.js';

// Mediafiltyper som ska indexeras
const MEDIA_EXTENSIONS = /\.(jpg|jpeg|png|webp|heic|heif|tiff|tif|gif|avif|bmp|mp4|mov|avi|mkv|webm|mpg|mpeg|3gp|wmv|m4v)$/i;

// Kö för att undvika att flera processer kör på samma fil samtidigt
const processingQueue = new Set();

async function handleAdd(filePath) {
  if (!MEDIA_EXTENSIONS.test(filePath)) return;
  if (processingQueue.has(filePath)) return;

  processingQueue.add(filePath);
  try {
    // Liten fördröjning: vänta till filen är färdigskriven (PhotoSync kan skriva långsamt)
    await new Promise((r) => setTimeout(r, 2000));
    await indexFile(filePath);
  } catch (err) {
    console.error(`Indexeringsfel för ${filePath}:`, err.message);
  } finally {
    processingQueue.delete(filePath);
  }
}

async function handleUnlink(filePath) {
  if (!MEDIA_EXTENSIONS.test(filePath)) return;
  try {
    await removeFileFromIndex(filePath);
  } catch (err) {
    console.error(`Borttagningsfel för ${filePath}:`, err.message);
  }
}

export function startFileWatcher() {
  const watchPath = config.media.photosPath;

  const watcher = chokidar.watch(watchPath, {
    persistent: true,
    ignoreInitial: false,          // Indexera befintliga filer vid uppstart
    ignored: /(^|[\/\\])\../,     // Ignorera dolda filer (.DS_Store etc.)
    awaitWriteFinish: {
      stabilityThreshold: 3000,    // Vänta 3s efter senaste skrivning
      pollInterval: 500,
    },
    depth: 20,                     // Tillåt djupa mappstrukturer
  });

  watcher
    .on('add', handleAdd)
    .on('unlink', handleUnlink)
    .on('error', (err) => console.error('FileWatcher-fel:', err))
    .on('ready', () => {
      console.log(`FileWatcher: bevakar ${watchPath}`);
    });

  return watcher;
}
