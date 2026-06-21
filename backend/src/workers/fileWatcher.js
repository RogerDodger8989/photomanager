import chokidar from 'chokidar';
import { existsSync } from 'fs';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { indexFile, removeFileFromIndex } from './indexer.js';
import { mountCifsShare, isMounted } from '../services/mountService.js';

const MEDIA_EXTENSIONS = /\.(jpg|jpeg|png|webp|heic|heif|tiff|tif|gif|avif|bmp|cr2|cr3|nef|arw|dng|orf|rw2|raf|pef|mp4|mov|avi|mkv|webm|mpg|mpeg|3gp|wmv|m4v)$/i;

const processingQueue = new Set();

// Map: sökväg → chokidar-instans
const watchers = new Map();

async function handleAdd(filePath, sourceFolderKey = null) {
  if (!MEDIA_EXTENSIONS.test(filePath)) return;
  if (processingQueue.has(filePath)) return;
  processingQueue.add(filePath);
  try {
    await new Promise((r) => setTimeout(r, 2000));
    await indexFile(filePath, sourceFolderKey);
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

function createWatcher(folderPath, sourceFolderKey = null) {
  if (watchers.has(folderPath)) return; // redan bevakad

  // usePolling krävs när mappen är en Docker-volym monterad från Windows/macOS —
  // inotify-events når aldrig containern vid ändringar från hosten.
  const usePolling = process.env.CHOKIDAR_USEPOLLING !== 'false';
  const pollInterval = parseInt(process.env.CHOKIDAR_INTERVAL ?? '3000');

  const watcher = chokidar.watch(folderPath, {
    persistent: true,
    ignoreInitial: false,
    ignored: (p) => {
      const parts = p.replace(/\\/g, '/').split('/');
      return parts.some((seg) => seg.startsWith('.'));
    },
    usePolling,
    interval: pollInterval,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
    depth: 20,
  });

  watcher
    .on('add',    (fp) => handleAdd(fp, sourceFolderKey))
    .on('unlink', (fp) => handleUnlink(fp))
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
      `SELECT path, mount_type, unc_path, cifs_username, cifs_password
       FROM watched_folders WHERE enabled = true`
    );
    for (const row of rows) {
      const { path, mount_type, unc_path, cifs_username, cifs_password } = row;

      // Återmontera CIFS-resurser som tappades vid omstart
      if (mount_type === 'cifs' && unc_path) {
        if (!isMounted(path)) {
          try {
            await mountCifsShare({
              uncPath: unc_path,
              mountPoint: path,
              username: cifs_username || null,
              password: cifs_password || null,
            });
            console.log(`FileWatcher: återmonterade ${unc_path} → ${path}`);
          } catch (err) {
            await query(
              `UPDATE watched_folders SET status = 'error', error_msg = $1 WHERE path = $2`,
              [`Återmontering misslyckades: ${err.message}`, path]
            ).catch(() => {});
            console.error(`FileWatcher: kunde inte återmontera ${path}:`, err.message);
            continue;
          }
        }
      }

      if (!existsSync(path)) {
        await query(
          `UPDATE watched_folders SET status = 'error', error_msg = 'Mappen hittades inte' WHERE path = $1`,
          [path]
        ).catch(() => {});
        console.warn(`FileWatcher: mappen finns inte — ${path}`);
        continue;
      }
      createWatcher(path, path);
    }
  } catch (err) {
    console.warn('FileWatcher: kunde inte läsa watched_folders:', err.message);
  }
}

// Anropas från API när en ny mapp läggs till
export async function addWatchedFolder(folderPath) {
  if (!existsSync(folderPath)) {
    throw new Error(`Mappen finns inte: ${folderPath}`);
  }
  createWatcher(folderPath, folderPath);
}

// Anropas från API när en mapp tas bort
export async function removeWatchedFolder(folderPath) {
  await stopWatcher(folderPath);
}

export function getWatchedPaths() {
  return [...watchers.keys()];
}
