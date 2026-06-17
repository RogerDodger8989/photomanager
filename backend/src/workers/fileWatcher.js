import chokidar from 'chokidar';
import { existsSync } from 'fs';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { indexFile, removeFileFromIndex } from './indexer.js';

const MEDIA_EXTENSIONS = /\.(jpg|jpeg|png|webp|heic|heif|tiff|tif|gif|avif|bmp|mp4|mov|avi|mkv|webm|mpg|mpeg|3gp|wmv|m4v)$/i;

const processingQueue = new Set();

// Map: sökväg → chokidar-instans
const watchers = new Map();

async function handleAdd(filePath) {
  if (!MEDIA_EXTENSIONS.test(filePath)) return;
  if (processingQueue.has(filePath)) return;
  processingQueue.add(filePath);
  try {
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

function createWatcher(folderPath) {
  if (watchers.has(folderPath)) return; // redan bevakad

  const watcher = chokidar.watch(folderPath, {
    persistent: true,
    ignoreInitial: false,
    ignored: /(^|[\/\\])\../,
    awaitWriteFinish: { stabilityThreshold: 3000, pollInterval: 500 },
    depth: 20,
  });

  watcher
    .on('add', handleAdd)
    .on('unlink', handleUnlink)
    .on('error', async (err) => {
      console.error(`FileWatcher-fel (${folderPath}):`, err.message);
      await query(
        `UPDATE watched_folders SET status = 'error', error_msg = $1 WHERE path = $2`,
        [err.message, folderPath]
      ).catch(() => {});
    })
    .on('ready', async () => {
      console.log(`FileWatcher: bevakar ${folderPath}`);
      await query(
        `UPDATE watched_folders SET status = 'watching', error_msg = NULL WHERE path = $1`,
        [folderPath]
      ).catch(() => {});
    });

  watchers.set(folderPath, watcher);
}

async function stopWatcher(folderPath) {
  const watcher = watchers.get(folderPath);
  if (!watcher) return;
  await watcher.close();
  watchers.delete(folderPath);
  console.log(`FileWatcher: slutade bevaka ${folderPath}`);
}

export async function startFileWatcher() {
  // Starta alltid med standardmappen
  createWatcher(config.media.photosPath);

  // Ladda extra bevakade mappar från databasen
  try {
    const { rows } = await query(
      `SELECT path FROM watched_folders WHERE enabled = true`
    );
    for (const { path } of rows) {
      if (!existsSync(path)) {
        await query(
          `UPDATE watched_folders SET status = 'error', error_msg = 'Mappen hittades inte' WHERE path = $1`,
          [path]
        ).catch(() => {});
        console.warn(`FileWatcher: mappen finns inte — ${path}`);
        continue;
      }
      createWatcher(path);
    }
  } catch (err) {
    // watched_folders-tabellen kanske inte finns ännu vid första uppstart
    console.warn('FileWatcher: kunde inte läsa watched_folders:', err.message);
  }
}

// Anropas från API när en ny mapp läggs till
export async function addWatchedFolder(folderPath) {
  if (!existsSync(folderPath)) {
    throw new Error(`Mappen finns inte: ${folderPath}`);
  }
  createWatcher(folderPath);
}

// Anropas från API när en mapp tas bort
export async function removeWatchedFolder(folderPath) {
  await stopWatcher(folderPath);
}

export function getWatchedPaths() {
  return [...watchers.keys()];
}
