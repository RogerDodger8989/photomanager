import { unlink } from 'fs/promises';
import { join, resolve } from 'path';
import { config } from '../config.js';
import { query } from '../db/pool.js';

// Körs som cron — rensar assets i papperskorgen äldre än TRASH_AUTO_CLEAN_DAYS
export async function cleanTrash() {
  const { rows } = await query(
    `SELECT id, file_path, thumb_small_path, thumb_large_path, transcoded_path
     FROM assets
     WHERE status = 'trashed'
       AND trashed_at < NOW() - INTERVAL '${config.trash.autoCleanDays} days'`
  );

  for (const asset of rows) {
    try {
      // Ta bort originalfil
      await unlink(resolve(config.media.photosPath,asset.file_path)).catch(() => {});

      // Ta bort thumbnails
      if (asset.thumb_small_path) {
        await unlink(join(config.media.thumbsPath, asset.thumb_small_path)).catch(() => {});
      }
      if (asset.thumb_large_path) {
        await unlink(join(config.media.thumbsPath, asset.thumb_large_path)).catch(() => {});
      }

      // Ta bort transkodad video
      if (asset.transcoded_path) {
        await unlink(join(config.media.transcodePath, asset.transcoded_path)).catch(() => {});
      }

      // Markera som deleted i DB (cascade tar hand om relaterade rader)
      await query(
        "UPDATE assets SET status = 'deleted' WHERE id = $1",
        [asset.id]
      );

      console.log(`Papperskorg: permanent raderat ${asset.file_path}`);
    } catch (err) {
      console.error(`Papperskorg: fel vid radering av ${asset.file_path}:`, err.message);
    }
  }

  if (rows.length > 0) {
    console.log(`Papperskorg: rensade ${rows.length} filer.`);
  }
}

// Enkel cron via setInterval — körs var 24:e timme
export function startTrashCleanerCron() {
  const INTERVAL_MS = 24 * 60 * 60 * 1000;
  cleanTrash().catch(console.error); // Kör direkt vid uppstart
  setInterval(() => cleanTrash().catch(console.error), INTERVAL_MS);
  console.log(`TrashCleaner: auto-rensning var 24h (${config.trash.autoCleanDays} dagars gräns)`);
}
