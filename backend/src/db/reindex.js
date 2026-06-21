/**
 * Re-indexerar faces och keywords för alla befintliga assets.
 * Körs manuellt: node src/db/reindex.js
 */
import { query, pool } from './pool.js';
import { extractMetadata } from '../services/metadataService.js';
import { config } from '../config.js';
import { resolve } from 'path';

const { rows: assets } = await pool.query(
  `SELECT id, file_path, file_name FROM assets WHERE status != 'deleted' ORDER BY indexed_at`
);
console.log(`Re-indexerar ${assets.length} assets...`);

let updated = 0;
let errors  = 0;

for (const asset of assets) {
  const absPath = resolve(config.media.photosPath, asset.file_path);

  try {
    const meta = await extractMetadata(absPath);

    // ── Dimensioner, betyg, titel, beskrivning ───────────────────────────
    await query(
      `UPDATE assets SET
         width       = COALESCE($1, width),
         height      = COALESCE($2, height),
         rating      = COALESCE($3, rating),
         title       = COALESCE($4, title),
         description = COALESCE($5, description)
       WHERE id = $6`,
      [meta.width, meta.height, meta.rating, meta.title, meta.description, asset.id]
    );

    // ── Taggar ───────────────────────────────────────────────────────────
    if (meta.tags.length > 0) {
      await query('DELETE FROM asset_tags WHERE asset_id = $1', [asset.id]);
      for (const tagName of meta.tags) {
        const { rows } = await query(
          `INSERT INTO tags (name) VALUES ($1)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [tagName]
        );
        await query(
          `INSERT INTO asset_tags (asset_id, tag_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [asset.id, rows[0].id]
        );
      }
    }

    // ── Faces ────────────────────────────────────────────────────────────
    if (meta.faces.length > 0) {
      await query('DELETE FROM faces WHERE asset_id = $1 AND source != \'ai\'', [asset.id]);
      for (const face of meta.faces) {
        let personId = null;
        if (face.name) {
          const existing = await query(`SELECT id FROM persons WHERE name = $1`, [face.name]);
          let pRows;
          if (existing.rows.length > 0) {
            pRows = existing.rows;
          } else {
            const ins = await query(`INSERT INTO persons (name) VALUES ($1) RETURNING id`, [face.name]);
            pRows = ins.rows;
          }
          personId = pRows[0].id;
        }
        await query(
          `INSERT INTO faces (asset_id, person_id, source, region_x, region_y, region_w, region_h)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [asset.id, personId, face.source ?? 'manual',
           face.regionX, face.regionY, face.regionW, face.regionH]
        );
      }
    }

    if (meta.tags.length > 0 || meta.faces.length > 0) {
      console.log(`✓ ${asset.file_name}: ${meta.tags.length} taggar, ${meta.faces.length} faces`);
      updated++;
    }

  } catch (err) {
    console.error(`✗ ${asset.file_name}: ${err.message}`);
    errors++;
  }
}

console.log(`\nKlart: ${updated} uppdaterade, ${errors} fel.`);
await pool.end();
