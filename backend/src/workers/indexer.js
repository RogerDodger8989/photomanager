import { relative, join, dirname, basename, extname } from 'path';
import { existsSync } from 'fs';
import { stat } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { computeFileHash } from '../services/hashService.js';
import { extractMetadata, isImage, isVideo, getMimeType } from '../services/metadataService.js';
import { upsertAssetLocation, reverseGeocode, reverseGeocodeDetailed } from '../services/geoService.js';
import { ensurePlaceTagsForAsset } from '../services/placeTagService.js';
import { generateThumbnails } from './thumbnailer.js';
import { createJob } from '../services/jobService.js';
import { broadcast } from '../services/sseService.js';
import { processAssetFaces, isAiAvailable } from '../services/aiService.js';
import { computeAndStorePHash } from '../services/pHashService.js';
import { recordResult } from '../services/importSessionService.js';

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
export async function indexFile(absolutePath, sourceFolderPath = null, sessionId = null) {
  const mimeType = getMimeType(absolutePath);

  // Filtrera bort icke-mediafiler (t.ex. .DS_Store, .tmp)
  if (!isImage(mimeType) && !isVideo(mimeType)) return { status: 'skipped' };

  const relPath = relative(config.media.photosPath, absolutePath).replace(/\\/g, '/');
  const fileName = absolutePath.split(/[\\/]/).pop();

  // Hoppa över filer som är länkade som live_video_path av en annan asset (extraherad Motion Photo-video, Apple Live Photo .mov)
  if (isVideo(mimeType)) {
    const { rows: linked } = await query(
      `SELECT id FROM assets WHERE live_video_path = $1 LIMIT 1`, [relPath]
    );
    if (linked.length > 0) {
      await recordResult(sessionId, 'skipped');
      return { status: 'skipped' };
    }
  }

  // 1. Kolla om filen redan är indexerad (t.ex. server-restart)
  // Inkluderar även 'deleted' — annars blockerar UNIQUE-constrainten på file_path en ny INSERT.
  const existing = await query(
    `SELECT a.id, a.status, a.source_folder, a.thumb_small_path, a.location, a.file_size,
            (SELECT COUNT(*) FROM faces f WHERE f.asset_id = a.id)::int AS face_count,
            (SELECT COUNT(*) FROM faces f WHERE f.asset_id = a.id AND f.person_id IS NULL AND f.source != 'ai')::int AS unassigned_faces
     FROM assets a WHERE a.file_path = $1`,
    [relPath]
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];

    // Filen låg i papperskorgen eller var permanent raderad men har lagts tillbaka på disk — återställ den.
    if (row.status === 'trashed' || row.status === 'deleted') {
      await query(
        `UPDATE assets SET status = 'active', trashed_at = NULL, trash_path = NULL,
                           source_folder = COALESCE($1, source_folder)
         WHERE id = $2`,
        [sourceFolderPath, row.id]
      );
      // Generera om thumbnail om den raderades tillsammans med filen
      if (isImage(mimeType)) {
        try {
          await generateThumbnails(row.id, absolutePath, mimeType);
        } catch (err) {
          console.warn(`Thumbnail misslyckades (återställd) för ${relPath}:`, err.message);
        }
      }
      broadcast('asset.indexed', { assetId: row.id, fileName, mimeType });
      console.log(`Återställd (${row.status}): ${relPath}`);
      await recordResult(sessionId, 'imported');
      return { status: 'restored', assetId: row.id };
    }
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
    // Om filen på disk har annan storlek än i DB: filen ersattes — uppdatera is_motion_photo, live_video_path m.m.
    let _fileStat = null;
    try { _fileStat = await stat(absolutePath); } catch {}
    if (_fileStat && _fileStat.size !== Number(row.file_size)) {
      try {
        const changedMeta = await extractMetadata(absolutePath);
        let updatedLiveVideo = null;
        if (isImage(mimeType)) {
          const dir = dirname(absolutePath);
          const base = basename(absolutePath, extname(absolutePath));
          for (const ext of ['.mov', '.MOV', '.mp4', '.MP4']) {
            const candidate = join(dir, base + ext);
            if (existsSync(candidate)) {
              updatedLiveVideo = relative(config.media.photosPath, candidate).replace(/\\/g, '/');
              break;
            }
          }
        }
        await query(
          `UPDATE assets SET file_size = $1, is_motion_photo = $2, live_video_path = $3,
                             width = COALESCE($4, width), height = COALESCE($5, height)
           WHERE id = $6`,
          [changedMeta.fileSize, changedMeta.isMotionPhoto ?? false, updatedLiveVideo,
           changedMeta.width, changedMeta.height, row.id]
        );
        console.log(`Fil ändrad (${row.file_size}→${_fileStat.size} B), uppdaterade metadata: ${relPath}`);
      } catch (err) {
        console.warn(`Metadata-uppdatering vid filbyte misslyckades för ${relPath}:`, err.message);
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
    await recordResult(sessionId, 'skipped');
    return { status: 'skipped' };
  }

  // 2. SHA-256 hash + duplikat-kontroll
  let fileHash;
  try {
    fileHash = await computeFileHash(absolutePath);
  } catch {
    console.warn(`Kan inte läsa fil: ${absolutePath}`);
    await recordResult(sessionId, 'error');
    return { status: 'error' };
  }

  // 3. Extrahera metadata
  const meta = await extractMetadata(absolutePath);

  // 4. Skapa asset-rad i DB — alltid 'active', dublikathantering sker i Dublikat-vyn
  const assetId = uuidv4();
  const initialStatus = 'active';

  // Sök efter sidenvideo (Apple Live Photo: .jpg + .mov / .mp4 med samma basename)
  let liveVideoRelPath = null;
  if (isImage(mimeType)) {
    const dir = dirname(absolutePath);
    const base = basename(absolutePath, extname(absolutePath));
    for (const ext of ['.mov', '.MOV', '.mp4', '.MP4']) {
      const videoAbs = join(dir, base + ext);
      if (existsSync(videoAbs)) {
        liveVideoRelPath = relative(config.media.photosPath, videoAbs).replace(/\\/g, '/');
        break;
      }
    }
  }

  await query(
    `INSERT INTO assets
       (id, file_path, file_name, file_hash, mime_type, file_size,
        width, height, taken_at, file_created_at,
        transcode_status, rating, title, description, source_folder, is_motion_photo, status,
        iso, aperture, shutter_speed, focal_length_mm, lens_model, live_video_path)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
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
      meta.isMotionPhoto ?? false,
      initialStatus,
      meta.iso ?? null,
      meta.aperture ?? null,
      meta.shutterSpeed ?? null,
      meta.focalLengthMm ?? null,
      meta.lensModel ?? null,
      liveVideoRelPath,
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

  // 6. Taggar — hierarkiska sökvägar (DigiKam/Lightroom) har prioritet
  const hierPaths = meta.hierarchicalTags ?? [];
  const flatTags  = meta.tags ?? [];

  // Alla noder (inte bara löv) som täcks av hierarkiska paths — undviker dubbletter med platta taggar
  const coveredByHierarchy = new Set();
  for (const parts of hierPaths) {
    for (const part of parts) coveredByHierarchy.add(part.toLowerCase());
  }

  // Bygg parent-child-kedja för varje hierarkisk sökväg
  for (const parts of hierPaths) {
    let parentId   = null;
    let parentPath = null;
    for (const part of parts) {
      const fullPath = parentPath ? `${parentPath}/${part}` : part;
      const underPersoner = fullPath === 'Personer' || fullPath.toLowerCase().startsWith('personer/');
      const { rows } = await query(
        `INSERT INTO tags (name, path, parent_id, is_face_tag, export_only_leaf, show_lifespan, export_synonyms)
         VALUES ($1, $2, $3, $4, $4, $4, NOT $4)
         ON CONFLICT (path) DO UPDATE SET
           name             = EXCLUDED.name,
           parent_id        = EXCLUDED.parent_id,
           is_face_tag      = CASE WHEN EXCLUDED.is_face_tag THEN TRUE ELSE tags.is_face_tag END,
           export_only_leaf = CASE WHEN EXCLUDED.export_only_leaf THEN TRUE ELSE tags.export_only_leaf END,
           show_lifespan    = CASE WHEN EXCLUDED.show_lifespan THEN TRUE ELSE tags.show_lifespan END,
           export_synonyms  = CASE WHEN NOT EXCLUDED.export_synonyms THEN FALSE ELSE tags.export_synonyms END
         RETURNING id`,
        [part, fullPath, parentId, underPersoner]
      );
      parentId   = rows[0].id;
      parentPath = fullPath;
    }
    // Koppla löv-taggen till bilden
    if (parentId) {
      await query(
        `INSERT INTO asset_tags (asset_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [assetId, parentId]
      );
    }
  }

  // Platta nyckelord som inte redan täcks av hierarkiska paths
  for (const tagName of flatTags) {
    if (coveredByHierarchy.has(tagName.toLowerCase())) continue;
    const { rows: tagRows } = await query(
      `INSERT INTO tags (name, path) VALUES ($1, $1)
       ON CONFLICT (path) DO UPDATE SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id
       RETURNING id`,
      [tagName]
    );
    await query(
      `INSERT INTO asset_tags (asset_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [assetId, tagRows[0].id]
    );
  }

  // 6b. Mapp→tagg-regler
  await applyFolderTagRules(assetId, relPath);

  // 7. GPS + reverse geocoding + ortstagg-hierarki
  if (meta.gps) {
    await upsertAssetLocation(assetId, meta.gps.lat, meta.gps.lon);
    // Geocoding körs asynkront — försök 3 gånger med 5 sek mellanrum
    (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 5000));
        const [label, detailed] = await Promise.all([
          reverseGeocode(meta.gps.lat, meta.gps.lon),
          reverseGeocodeDetailed(meta.gps.lat, meta.gps.lon),
        ]);
        if (label) {
          await query('UPDATE assets SET location_label = $1 WHERE id = $2', [label, assetId]).catch(() => {});
          if (detailed) await ensurePlaceTagsForAsset(assetId, detailed).catch(() => {});
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
      // Beräkna perceptuellt hash asynkront (blockerar inte indexeringen)
      computeAndStorePHash(assetId, absolutePath).catch(console.warn);
      // Köa objektdetektion-jobb (körs av jobRunner i bakgrunden)
      createJob('object_detection', assetId).catch(console.warn);
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

  await recordResult(sessionId, 'imported');
  console.log(`Indexerad: ${relPath}`);
  return { status: 'imported', assetId };
}

/**
 * Matchar en fils sökväg mot alla folder_tag_rules och sätter matchade taggar.
 * Regler cachas per process-körning i minnet för att undvika en DB-query per fil.
 * @param {string} assetId
 * @param {string} relPath - sökväg relativt till photosPath, t.ex. "2024/semester/bild.jpg"
 */
let _folderTagRulesCache = null;
let _folderTagRulesCacheTs = 0;

async function applyFolderTagRules(assetId, relPath) {
  // Cacha reglerna i 60 sekunder
  if (!_folderTagRulesCache || Date.now() - _folderTagRulesCacheTs > 60_000) {
    const { rows } = await query('SELECT pattern, tag_id, match_type FROM folder_tag_rules');
    _folderTagRulesCache = rows;
    _folderTagRulesCacheTs = Date.now();
  }

  const pathParts = relPath.split('/');
  const folderParts = pathParts.slice(0, -1); // alla delar utom filnamnet

  for (const rule of _folderTagRulesCache) {
    let matches = false;
    const { pattern, match_type } = rule;

    if (match_type === 'folder_name') {
      matches = folderParts.some((p) => p.toLowerCase() === pattern.toLowerCase());
    } else if (match_type === 'folder_name_contains') {
      matches = folderParts.some((p) => p.toLowerCase().includes(pattern.toLowerCase()));
    } else if (match_type === 'folder_path_contains') {
      matches = relPath.toLowerCase().includes(pattern.toLowerCase());
    } else if (match_type === 'glob') {
      // Enkel glob: * matchar allt utom /
      const regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
      matches = new RegExp(regexStr, 'i').test(relPath);
    }

    if (matches) {
      await query(
        'INSERT INTO asset_tags (asset_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [assetId, rule.tag_id]
      );
    }
  }
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
