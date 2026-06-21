import { join, resolve } from 'path';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { extractMetadata } from '../services/metadataService.js';
import { upsertAssetLocation, reverseGeocode } from '../services/geoService.js';

export async function backfillMotionPhotos() {
  const { rows } = await query(
    `SELECT id, file_path FROM assets
     WHERE status = 'active' AND mime_type LIKE 'image/%'
       AND (is_motion_photo = false OR location IS NULL)`
  );

  if (rows.length === 0) return { scanned: 0, updated: 0, errors: 0 };

  let updated = 0;
  let errors  = 0;

  for (const row of rows) {
    try {
      const absPath = resolve(config.media.photosPath,row.file_path);
      const meta = await extractMetadata(absPath);

      if (meta.isMotionPhoto) {
        await query('UPDATE assets SET is_motion_photo = true WHERE id = $1', [row.id]);
        updated++;
      }

      // Fyll i GPS om det saknas
      if (meta.gps) {
        const { rows: locRows } = await query(
          'SELECT location FROM assets WHERE id = $1', [row.id]
        );
        if (!locRows[0]?.location) {
          await upsertAssetLocation(row.id, meta.gps.lat, meta.gps.lon);
          reverseGeocode(meta.gps.lat, meta.gps.lon).then(label => {
            if (label) query('UPDATE assets SET location_label = $1 WHERE id = $2', [label, row.id]).catch(() => {});
          }).catch(() => {});
        }
      }
    } catch {
      errors++;
    }
  }

  console.log(`Motion Photo-backfill klar: ${rows.length} skannade, ${updated} uppdaterade.`);
  return { scanned: rows.length, updated, errors };
}
