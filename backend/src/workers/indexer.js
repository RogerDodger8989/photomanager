import { relative } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { computeFileHash, findDuplicateByHash } from '../services/hashService.js';
import { extractMetadata, isImage, isVideo, getMimeType } from '../services/metadataService.js';
import { upsertAssetLocation, reverseGeocode } from '../services/geoService.js';
import { generateThumbnails } from './thumbnailer.js';
import { createJob } from '../services/jobService.js';
import { broadcast } from '../services/sseService.js';
import { processAssetFaces, isAiAvailable } from '../services/aiService.js';

// Hämtar om ansiktsigenkänning är aktiverad för ägaren av given bevakad mapp
async function getFaceSettings(sourceFolderPath) {
  if (!sourceFolderPath) return { enabled: true, qualityThreshold: 0.5 };
  const { rows } = await query(
    `SELECT us.settings
     FROM watched_folders wf
     LEFT JOIN user_settings us ON us.user_id = wf.added_by
     WHERE wf.path = $1
     LIMIT 1`,
    [sourceFolderPath]
  );
  const settings = rows[0]?.settings ?? {};
  return {
    enabled: settings.face_detection_enabled !== false,
    qualityThreshold: settings.face_quality_threshold ?? 0.5,
  };
}

// Kallas från fileWatcher när en ny fil detekteras
export async function indexFile(absolutePath, sourceFolderPath = null) {
  const mimeType = getMimeType(absolutePath);

  // Filtrera bort icke-mediafiler (t.ex. .DS_Store, .tmp)
  if (!isImage(mimeType) && !isVideo(mimeType)) return;

  const relPath = relative(config.media.photosPath, absolutePath).replace(/\\/g, '/');
  const fileName = absolutePath.split(/[\\/]/).pop();

  // 1. Kolla om filen redan är indexerad (t.ex. server-restart)
  const existing = await query(
    `SELECT a.id, a.source_folder, a.thumb_small_path, a.location,
            (SELECT COUNT(*) FROM faces f WHERE f.asset_id = a.id)::int AS face_count,
            (SELECT COUNT(*) FROM faces f WHERE f.asset_id = a.id AND f.person_id IS NULL AND f.source != 'ai')::int AS unassigned_faces
     FROM assets a WHERE a.file_path = $1 AND a.status != 'deleted'`,
    [relPath]
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    // Koppla till den mapp som nu bevakar filen (om den saknas eller skiljer sig)
    if (sourceFolderPath && row.source_folder !== sourceFolderPath) {
      await query('UPDATE assets SET source_folder = $1 WHERE id = $2', [sourceFolderPath, row.id]);
    }
    // Generera thumbnail om den saknas
    if (!row.thumb_small_path && isImage(mimeType)) {
      try {
        await generateThumbnails(row.id, absolutePath, mimeType);
      } catch (err) {
        console.warn(`Thumbnail misslyckades (befintlig) för ${relPath}:`, err.message);
      }
    }
    // Fyll i GPS och ansikten om de saknas eller saknar orientationskorrigering
    const needsGps   = !row.location && isImage(mimeType);
    // Uppdatera ansikten om: saknas helt ELLER om befintliga ansikten saknar person (XMP-faces som kan ha fel koordinater)
    const needsFaces = isImage(mimeType) && (row.face_count === 0 || row.unassigned_faces > 0);
    if (needsGps || needsFaces) {
      try {
        const meta = await extractMetadata(absolutePath);
        if (needsGps && meta.gps) {
          await upsertAssetLocation(row.id, meta.gps.lat, meta.gps.lon);
          (async () => {
            for (let attempt = 0; attempt < 3; attempt++) {
              if (attempt > 0) await new Promise((r) => setTimeout(r, 5000));
              const label = await reverseGeocode(meta.gps.lat, meta.gps.lon);
              if (label) {
                await query('UPDATE assets SET location_label = $1 WHERE id = $2', [label, row.id]).catch(() => {});
                break;
              }
            }
          })().catch(() => {});
        }
        if (needsFaces && meta.faces.length > 0) {
          // Ta bort gamla XMP-faces utan person-tilldelning (dessa kan ha felaktiga koordinater)
          if (row.unassigned_faces > 0) {
            await query(
              `DELETE FROM faces WHERE asset_id = $1 AND person_id IS NULL AND source != 'ai'`,
              [row.id]
            );
          }
          for (const face of meta.faces) {
            let personId = null;
            if (face.name) {
              const { rows: pRows } = await query(
                `INSERT INTO persons (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id`,
                [face.name]
              );
              if (pRows.length > 0) {
                personId = pRows[0].id;
              } else {
                const { rows: existRows } = await query('SELECT id FROM persons WHERE name = $1 LIMIT 1', [face.name]);
                personId = existRows[0]?.id ?? null;
              }
            }
            await query(
              `INSERT INTO faces (asset_id, person_id, source, region_x, region_y, region_w, region_h)
               VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
              [row.id, personId, face.source, face.regionX, face.regionY, face.regionW, face.regionH]
            );
          }
        }
      } catch (err) {
        console.warn(`Backfill GPS/faces misslyckades för ${relPath}:`, err.message);
      }
    }
    return;
  }

  // 2. SHA-256 hash + duplikat-kontroll
  let fileHash;
  try {
    fileHash = await computeFileHash(absolutePath);
  } catch {
    console.warn(`Kan inte läsa fil: ${absolutePath}`);
    return;
  }

  const duplicate = await findDuplicateByHash(fileHash);
  if (duplicate) {
    console.log(`Duplikat hoppas över: ${relPath} (samma som ${duplicate.file_path})`);
    return;
  }

  // 3. Extrahera metadata
  const meta = await extractMetadata(absolutePath);

  // 4. Skapa asset-rad i DB
  const assetId = uuidv4();
  await query(
    `INSERT INTO assets
       (id, file_path, file_name, file_hash, mime_type, file_size,
        width, height, taken_at, file_created_at,
        transcode_status, rating, title, description, source_folder)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      assetId,
      relPath,
      fileName,
      fileHash,
      meta.mimeType,
      meta.fileSize,
      meta.width,
      meta.height,
      meta.takenAt,
      meta.fileCreatedAt,
      isVideo(mimeType) ? 'pending' : 'not_needed',
      meta.rating ?? null,
      meta.title ?? null,
      meta.description ?? null,
      sourceFolderPath,
    ]
  );

  // 5. Spara råa metadata-par
  const metaRows = [
    ...Object.entries(meta.exif).map(([k, v]) => ({ source: 'exif', key: k, value: v })),
    ...Object.entries(meta.iptc).map(([k, v]) => ({ source: 'iptc', key: k, value: v })),
    ...Object.entries(meta.xmp).map(([k, v]) => ({ source: 'xmp',  key: k, value: v })),
  ];

  for (const row of metaRows) {
    try {
      await query(
        `INSERT INTO asset_metadata (asset_id, source, key, value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (asset_id, source, key) DO UPDATE SET value = EXCLUDED.value`,
        [assetId, row.source, row.key, String(row.value).slice(0, 4096)]
      );
    } catch { /* hoppa över ogiltiga metadata-värden */ }
  }

  // 6. Taggar (nyckelord)
  for (const tagName of meta.tags) {
    const { rows: tagRows } = await query(
      `INSERT INTO tags (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [tagName]
    );
    await query(
      `INSERT INTO asset_tags (asset_id, tag_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [assetId, tagRows[0].id]
    );
  }

  // 7. GPS + reverse geocoding
  if (meta.gps) {
    await upsertAssetLocation(assetId, meta.gps.lat, meta.gps.lon);
    // Geocoding körs asynkront — försök 3 gånger med 5 sek mellanrum
    (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 5000));
        const label = await reverseGeocode(meta.gps.lat, meta.gps.lon);
        if (label) {
          await query('UPDATE assets SET location_label = $1 WHERE id = $2', [label, assetId]).catch(() => {});
          break;
        }
      }
    })().catch(() => {});
  }

  // 8. Face regions (från DigiKam/Lightroom XMP)
  for (const face of meta.faces) {
    // Hitta eller skapa person om namn är känt
    let personId = null;
    if (face.name) {
      const { rows: pRows } = await query(
        `INSERT INTO persons (name) VALUES ($1)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [face.name]
      );
      if (pRows.length > 0) {
        personId = pRows[0].id;
      } else {
        const { rows: existRows } = await query(
          'SELECT id FROM persons WHERE name = $1 LIMIT 1',
          [face.name]
        );
        personId = existRows[0]?.id ?? null;
      }
    }

    await query(
      `INSERT INTO faces (asset_id, person_id, source, region_x, region_y, region_w, region_h)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [assetId, personId, face.source, face.regionX, face.regionY, face.regionW, face.regionH]
    );
  }

  // 9. Thumbnail (bilder direkt, videor via separat transcoder-jobb)
  if (isImage(mimeType)) {
    try {
      await generateThumbnails(assetId, absolutePath, mimeType);
    } catch (err) {
      console.warn(`Thumbnail misslyckades för ${relPath}:`, err.message);
      await createJob('thumbnail', assetId);  // Köa för retry
    }
  } else if (isVideo(mimeType)) {
    await createJob('transcode', assetId);
  }

  // AI-ansiktsanalys (körs asynkront i bakgrunden, blockerar inte indexeringen)
  if (isImage(mimeType) && isAiAvailable()) {
    getFaceSettings(sourceFolderPath).then(({ enabled, qualityThreshold }) => {
      if (enabled) processAssetFaces(assetId, absolutePath, qualityThreshold).catch(console.error);
    }).catch(console.error);
  }

  // Notifiera alla inloggade klienter om ny fil
  broadcast('asset.indexed', { assetId, fileName, mimeType: meta.mimeType });

  console.log(`Indexerad: ${relPath}`);
  return assetId;
}

// Kallas vid fil-borttagning från disk
export async function removeFileFromIndex(absolutePath) {
  const relPath = relative(config.media.photosPath, absolutePath).replace(/\\/g, '/');
  // Flytta till papperskorg, radera inte
  await query(
    "UPDATE assets SET status = 'trashed', trashed_at = NOW() WHERE file_path = $1",
    [relPath]
  );
  console.log(`Fil borttagen från disk, flyttad till papperskorg: ${relPath}`);
}
