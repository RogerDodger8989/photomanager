import { query } from '../db/pool.js';
import { logAudit } from '../services/authService.js';
import { writeMetaToFile } from '../services/xmpService.js';
import { join, resolve, dirname, basename, relative, extname } from 'path';
import { rename, mkdir, copyFile, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { config } from '../config.js';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { generateThumbnails } from '../workers/thumbnailer.js';
import { extractMetadata } from '../services/metadataService.js';
import { upsertAssetLocation, reverseGeocode, forwardGeocode } from '../services/geoService.js';
import { writeExif } from '../services/exiftoolService.js';

// Transforms display-space crop fractions (lp/tp/wp/hp) into raw-image pixel extract coords,
// accounting for EXIF orientation. Returns { left, top, width, height, rotateDeg } where
// rotateDeg is the explicit angle to apply AFTER the extract so the output is upright.
function exifAdjustedExtract(lp, tp, wp, hp, orientation, rW, rH) {
  let left, top, width, height, rotateDeg;
  switch (orientation) {
    case 3: // 180°
      left  = Math.round((1 - lp - wp) * rW);
      top   = Math.round((1 - tp - hp) * rH);
      width  = Math.round(wp * rW);
      height = Math.round(hp * rH);
      rotateDeg = 180;
      break;
    case 6: // 90°CW stored (most common portrait phone photo), display: dW=rH dH=rW
      left  = Math.round(tp * rW);
      top   = Math.round((1 - lp - wp) * rH);
      width  = Math.round(hp * rW);
      height = Math.round(wp * rH);
      rotateDeg = 90;
      break;
    case 8: // 90°CCW stored, display: dW=rH dH=rW
      left  = Math.round((1 - tp - hp) * rW);
      top   = Math.round(lp * rH);
      width  = Math.round(hp * rW);
      height = Math.round(wp * rH);
      rotateDeg = 270;
      break;
    default: // 1 (normal) and rare flip orientations – treat as no rotation
      left   = Math.round(lp * rW);
      top    = Math.round(tp * rH);
      width  = Math.round(wp * rW);
      height = Math.round(hp * rH);
      rotateDeg = 0;
  }
  const safeW = Math.min(Math.max(0, width),  rW - Math.max(0, left));
  const safeH = Math.min(Math.max(0, height), rH - Math.max(0, top));
  return { left: Math.max(0, left), top: Math.max(0, top), width: Math.max(0, safeW), height: Math.max(0, safeH), rotateDeg };
}

export default async function assetsRoutes(fastify) {

  // GET /api/assets — tidslinje med cursor-paginering
  fastify.get('/api/assets', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          cursor:       { type: 'string' },
          limit:        { type: 'integer', default: 50, maximum: 200 },
          sort:         { type: 'string', enum: ['taken_at', 'file_name', 'file_size', 'view_count', 'indexed_at', 'rating'], default: 'taken_at' },
          order:        { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
          ownOnly:      { type: 'boolean', default: false },
          sourceFolder: { type: 'string' },
          subpath:      { type: 'string' },
          recursive:    { type: 'boolean', default: true },
          folderPath:   { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { cursor, limit = 50, sort = 'taken_at', order = 'desc', ownOnly, sourceFolder, subpath, recursive = true, folderPath } = request.query;
    const userId = request.user.id;
    const isAdmin = request.user.role === 'admin';

    const params = [limit + 1];
    const userRole = request.user.role;
    let conditions = ["a.status = 'active'"];

    // Synlighetsfilter baserat på roll
    if (!isAdmin) {
      if (ownOnly) {
        // Explicit eget filter — visa bara egna bilder
        conditions.push(`a.owner_id = $${params.push(userId)}`);
      } else {
        // Visa bilder som användaren har rätt att se baserat på visibility + roll
        conditions.push(
          `(a.owner_id = $${params.push(userId)} OR a.visibility = 'shared'` +
          (userRole === 'family' ? ` OR a.visibility = 'family'` : '') +
          `)`
        );
      }
    }

    // Mappfiltrering — folderPath tar företräde över sourceFolder+subpath
    // file_path i DB är relativ till photosPath; konvertera absolut folderPath till relativ
    if (folderPath) {
      const photosRoot = config.media.photosPath.replace(/\\/g, '/').replace(/\/$/, '');
      const fpAbs      = folderPath.replace(/\\/g, '/').replace(/\/$/, '');
      let   fp;
      if (fpAbs.startsWith(photosRoot + '/') || fpAbs === photosRoot) {
        fp = fpAbs.slice(photosRoot.length + 1) || '.';
      } else {
        fp = relative(photosRoot, fpAbs).replace(/\\/g, '/');
      }
      if (recursive) {
        conditions.push(`a.file_path LIKE $${params.push(fp + '/%')}`);
      } else {
        conditions.push(`regexp_replace(a.file_path, '/[^/]+$', '') = $${params.push(fp)}`);
      }
    } else if (sourceFolder) {
      // Bakåtkompatibelt stöd via sourceFolder + subpath
      conditions.push(`a.source_folder = $${params.push(sourceFolder)}`);
      if (subpath) {
        const prefix = sourceFolder.replace(/\/$/, '') + '/' + subpath.replace(/\/$/, '') + '/';
        if (recursive) {
          conditions.push(`a.file_path LIKE $${params.push(prefix + '%')}`);
        } else {
          conditions.push(`regexp_replace(a.file_path, '/[^/]+$', '') = $${params.push(prefix.replace(/\/$/, ''))}`);
        }
      } else if (!recursive) {
        conditions.push(`regexp_replace(a.file_path, '/[^/]+$', '') = $${params.push(sourceFolder.replace(/\/$/, ''))}`);
      }
    }

    // Visa bara stack-covers i tidslinjen (inte non-cover members)
    conditions.push(`(a.stack_id IS NULL OR a.id = (SELECT cover_asset_id FROM stacks WHERE id = a.stack_id))`);

    // Cursor-baserad paginering
    // För sorteringar med icke-unika värden (rating, file_size, view_count) används taken_at som cursor
    const cursorField = ['rating', 'file_size', 'view_count', 'indexed_at'].includes(sort) ? 'taken_at' : sort;
    const op = order === 'desc' ? '<' : '>';
    if (cursor) {
      conditions.push(`a.${cursorField} ${op} $${params.push(cursor)}`);
    }

    // Sekundär sortering på taken_at för stabilitet vid icke-unika primärsorteringar
    const secondarySort = sort !== 'taken_at' ? `, a.taken_at ${order} NULLS LAST` : '';

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT a.id, a.file_name, a.mime_type, a.file_size, a.width, a.height,
              a.taken_at, a.indexed_at, a.thumb_small_path, a.thumb_large_path,
              a.location_label, a.view_count, a.duration, a.transcode_status,
              a.is_motion_photo, a.live_video_path, a.flag, a.color_label, a.rating, a.visibility,
              a.stack_id,
              (SELECT COUNT(*)::int FROM assets s WHERE s.stack_id = a.stack_id AND s.status = 'active') AS stack_size,
              ${isAdmin ? 'a.owner_id,' : ''}
              ST_Y(a.location::geometry) AS lat,
              ST_X(a.location::geometry) AS lon,
              (EXISTS (SELECT 1 FROM favorites f WHERE f.asset_id = a.id AND f.user_id = $${params.push(userId)})) AS is_favorite
       FROM assets a
       ${where}
       ORDER BY a.${sort} ${order} NULLS LAST${secondarySort}
       LIMIT $1`,
      params
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1][cursorField] : null;

    return reply.send({ data: items, meta: { hasMore, nextCursor } });
  });

  // GET /api/assets/timeline-summary — dekad/år/månads-grupperingsöversikt
  fastify.get('/api/assets/timeline-summary', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          groupBy: { type: 'string', enum: ['decade', 'year', 'month'] },
          decade:  { type: 'integer' },
          year:    { type: 'integer' },
        },
      },
    },
  }, async (request, reply) => {
    const groupBy = request.query.groupBy ?? 'decade';
    const decade  = request.query.decade  != null ? parseInt(request.query.decade,  10) : null;
    const year    = request.query.year    != null ? parseInt(request.query.year,    10) : null;
    const { isAdmin, id: userId } = request.user;

    const ownerA  = isAdmin ? 'TRUE' : `a.owner_id  = '${userId}'`;
    const ownerA2 = isAdmin ? 'TRUE' : `a2.owner_id = '${userId}'`;

    let groupSql, thumbMatchSql, extraFilter = '';
    const params = [];

    if (groupBy === 'decade') {
      groupSql     = `(FLOOR(EXTRACT(YEAR FROM a.taken_at) / 10) * 10)::int`;
      thumbMatchSql = `(FLOOR(EXTRACT(YEAR FROM a2.taken_at) / 10) * 10)::int = grp.label`;
    } else if (groupBy === 'year') {
      groupSql     = `EXTRACT(YEAR FROM a.taken_at)::int`;
      thumbMatchSql = `EXTRACT(YEAR FROM a2.taken_at)::int = grp.label`;
      if (decade != null) {
        params.push(decade);
        extraFilter = `AND (FLOOR(EXTRACT(YEAR FROM a.taken_at) / 10) * 10)::int = $${params.length}`;
      }
    } else {
      groupSql     = `TO_CHAR(DATE_TRUNC('month', a.taken_at), 'YYYY-MM')`;
      thumbMatchSql = `TO_CHAR(DATE_TRUNC('month', a2.taken_at), 'YYYY-MM') = grp.label`;
      if (year != null) {
        params.push(year);
        extraFilter = `AND EXTRACT(YEAR FROM a.taken_at)::int = $${params.length}`;
      }
    }

    const { rows } = await query(`
      SELECT grp.label, grp.count, thumbs.paths AS thumbs
      FROM (
        SELECT ${groupSql} AS label, COUNT(*)::int AS count
        FROM assets a
        WHERE a.status = 'active' AND a.taken_at IS NOT NULL AND ${ownerA} ${extraFilter}
        GROUP BY label
      ) grp,
      LATERAL (
        SELECT COALESCE(json_agg(t.p), '[]'::json) AS paths
        FROM (
          SELECT a2.thumb_small_path AS p
          FROM assets a2
          WHERE a2.status = 'active' AND a2.thumb_small_path IS NOT NULL AND ${ownerA2}
            AND ${thumbMatchSql}
          ORDER BY a2.taken_at DESC LIMIT 4
        ) t
      ) thumbs
      ORDER BY grp.label DESC
    `, params);

    return reply.send({ data: rows });
  });

  // GET /api/assets/duplicates — grupper av innehållsidentiska filer
  fastify.get('/api/assets/duplicates', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { rows } = await query(`
      SELECT
        a.file_hash,
        COUNT(*)::int AS count,
        json_agg(
          json_build_object(
            'id',              a.id,
            'file_name',       a.file_name,
            'file_path',       a.file_path,
            'file_size',       a.file_size,
            'taken_at',        a.taken_at,
            'indexed_at',      a.indexed_at,
            'thumb_small_path',a.thumb_small_path,
            'mime_type',       a.mime_type,
            'width',           a.width,
            'height',          a.height,
            'location_label',  a.location_label,
            'status',          a.status,
            'face_count',      (SELECT COUNT(*) FROM faces f WHERE f.asset_id = a.id),
            'tag_count',       (SELECT COUNT(*) FROM asset_tags t WHERE t.asset_id = a.id)
          )
          ORDER BY a.indexed_at ASC
        ) AS assets
      FROM assets a
      WHERE a.file_hash IS NOT NULL
        AND a.status IN ('active', 'trashed')
      GROUP BY a.file_hash
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC, MIN(a.indexed_at) DESC
    `);
    return reply.send({ data: rows });
  });

  // POST /api/assets/:id/rescan — re-extrahera GPS/motion-photo direkt från fil (utan restart)
  fastify.post('/api/assets/:id/rescan', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await query(
      "SELECT id, file_path, mime_type FROM assets WHERE id = $1 AND status = 'active'",
      [id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Hittades inte' });

    const absPath = resolve(config.media.photosPath,rows[0].file_path);
    const meta = await extractMetadata(absPath);

    const updates = [];
    const params = [];

    if (meta.isMotionPhoto) {
      updates.push(`is_motion_photo = true`);
    }
    if (meta.gps) {
      await upsertAssetLocation(id, meta.gps.lat, meta.gps.lon);
      const label = await reverseGeocode(meta.gps.lat, meta.gps.lon).catch(() => null);
      if (label) {
        updates.push(`location_label = $${params.push(label)}`);
      }
    }
    if (updates.length) {
      params.push(id);
      await query(`UPDATE assets SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
    }

    return reply.send({
      data: {
        isMotionPhoto: meta.isMotionPhoto,
        gps: meta.gps,
        locationLabel: meta.gps ? (await reverseGeocode(meta.gps.lat, meta.gps.lon).catch(() => null)) : null,
      },
    });
  });

  // GET /api/assets/geocode?q=<text> — sök plats via Nominatim, returnerar kandidater
  fastify.get('/api/assets/geocode', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const q = (request.query.q ?? '').trim();
    if (!q) return reply.send({ data: [] });
    const results = await forwardGeocode(q);
    return reply.send({ data: results });
  });

  // PATCH /api/assets/:id/datetime — ändra fotodatum manuellt
  fastify.patch('/api/assets/:id/datetime', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const { takenAt } = request.body ?? {};
    if (!takenAt) return reply.status(400).send({ error: 'takenAt krävs' });

    const dt = new Date(takenAt);
    if (isNaN(dt.getTime())) return reply.status(400).send({ error: 'Ogiltigt datum' });

    const { rows } = await query(
      `UPDATE assets SET taken_at = $1 WHERE id = $2 AND status IN ('active','trashed') RETURNING id, taken_at, file_path`,
      [dt.toISOString(), id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Hittades inte' });

    // Exiftool writeback (graceful — misslyckas tyst om exiftool saknas)
    if (rows[0].file_path) {
      const absPath = resolve(config.media.photosPath, rows[0].file_path);
      writeExif(absPath, { dateTimeOriginal: dt.toISOString() }).catch(() => {});
    }

    return reply.send({ data: { id: rows[0].id, taken_at: rows[0].taken_at } });
  });

  // PATCH /api/assets/:id/location — sätt eller rensa plats manuellt
  fastify.patch('/api/assets/:id/location', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const { lat, lon, label } = request.body ?? {};

    const { rows: ar } = await query(`SELECT file_path FROM assets WHERE id = $1`, [id]);

    if (lat == null || lon == null) {
      await query(
        `UPDATE assets SET location = NULL, location_label = NULL WHERE id = $1`,
        [id]
      );
      return reply.send({ data: { lat: null, lon: null, label: null } });
    }

    await upsertAssetLocation(id, lat, lon);
    await query(`UPDATE assets SET location_label = $1 WHERE id = $2`, [label ?? null, id]);

    // Exiftool writeback
    if (ar[0]?.file_path) {
      const absPath = resolve(config.media.photosPath, ar[0].file_path);
      writeExif(absPath, { gpsLat: lat, gpsLon: lon }).catch(() => {});
    }

    return reply.send({ data: { lat, lon, label } });
  });

  // PATCH /api/assets/:id/camera-model — ändra kameramodell manuellt
  fastify.patch('/api/assets/:id/camera-model', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const { model } = request.body ?? {};
    if (model === undefined) return reply.status(400).send({ error: 'model krävs' });

    const { rows } = await query(
      `SELECT file_path, owner_id FROM assets WHERE id = $1 AND status = 'active'`, [id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Hittades inte' });
    if (rows[0].owner_id !== request.user.id && request.user.role !== 'admin') {
      return reply.status(403).send({ error: 'Ej tillåtet' });
    }

    if (model) {
      // Upsert XMP-override för kameramodell (tag 272 = Model)
      await query(
        `INSERT INTO asset_metadata (asset_id, source, key, value)
         VALUES ($1, 'xmp', '272', $2)
         ON CONFLICT (asset_id, source, key) DO UPDATE SET value = EXCLUDED.value`,
        [id, model],
      );
    } else {
      await query(
        `DELETE FROM asset_metadata WHERE asset_id = $1 AND source = 'xmp' AND key = '272'`,
        [id],
      );
    }

    // Exiftool writeback (skriver till filen om exiftool är installerat)
    if (rows[0].file_path) {
      const absPath = resolve(config.media.photosPath, rows[0].file_path);
      writeExif(absPath, { model: model || '' }).catch(() => {});
    }

    return reply.send({ data: { model } });
  });

  // GET /api/assets/:id — enskild asset
  fastify.get('/api/assets/:id', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await query(
      `SELECT a.*,
              ST_Y(a.location::geometry) AS lat,
              ST_X(a.location::geometry) AS lon,
              COALESCE(
                json_agg(DISTINCT jsonb_build_object(
                  'id', f.id, 'personId', f.person_id, 'personName', p.name,
                  'source', f.source,
                  'x', f.region_x, 'y', f.region_y, 'w', f.region_w, 'h', f.region_h
                )) FILTER (WHERE f.id IS NOT NULL),
                '[]'
              ) AS faces,
              COALESCE(
                json_agg(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL),
                '[]'
              ) AS tags
       FROM assets a
       LEFT JOIN faces f ON f.asset_id = a.id
       LEFT JOIN persons p ON p.id = f.person_id
       LEFT JOIN asset_tags at2 ON at2.asset_id = a.id
       LEFT JOIN tags t ON t.id = at2.tag_id
       WHERE a.id = $1 AND a.status != 'deleted'
       GROUP BY a.id`,
      [id]
    );

    if (!rows[0]) return reply.status(404).send({ error: 'Hittades inte' });

    // Öka vy-räknaren
    await query('UPDATE assets SET view_count = view_count + 1 WHERE id = $1', [id]);
    await logAudit(request.user.id, 'view', id, 'asset', null, request.ip);

    return reply.send({ data: rows[0] });
  });

  // PATCH /api/assets/:id/metadata — uppdatera metadata (kräver skrivrätt)
  fastify.patch('/api/assets/:id/metadata', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          takenAt:       { type: 'string', format: 'date-time' },
          tags:          { type: 'array', items: { type: 'string' } },
          locationLabel: { type: 'string' },
          rating:        { type: ['integer', 'null'], minimum: 1, maximum: 5 },
          flag:          { type: 'integer', enum: [-1, 0, 1] },
          colorLabel:    { type: 'integer', minimum: 0, maximum: 5 },
          title:         { type: ['string', 'null'] },
          description:   { type: ['string', 'null'] },
          visibility:    { type: 'string', enum: ['private', 'family', 'shared'] },
        },
      },
    },
  }, async (request, reply) => {
    // Kontrollera skrivrätt
    const perm = await query(
      "SELECT value FROM user_permissions WHERE user_id = $1 AND permission_key = 'write.metadata'",
      [request.user.id]
    );
    const canWrite = request.user.role === 'admin' || (perm.rows[0]?.value ?? true);
    if (!canWrite) return reply.status(403).send({ error: 'Saknar skrivrätt' });

    const { id } = request.params;
    const { takenAt, tags, locationLabel, rating, flag, colorLabel, title, description, visibility } = request.body;

    if (takenAt) {
      await query('UPDATE assets SET taken_at = $1 WHERE id = $2', [takenAt, id]);
    }
    if (locationLabel !== undefined) {
      await query('UPDATE assets SET location_label = $1 WHERE id = $2', [locationLabel, id]);
    }
    if (rating !== undefined) {
      await query('UPDATE assets SET rating = $1 WHERE id = $2', [rating ?? null, id]);
    }
    if (flag !== undefined) {
      await query('UPDATE assets SET flag = $1 WHERE id = $2', [flag, id]);
    }
    if (colorLabel !== undefined) {
      await query('UPDATE assets SET color_label = $1 WHERE id = $2', [colorLabel, id]);
    }
    if (title !== undefined) {
      await query('UPDATE assets SET title = $1 WHERE id = $2', [title ?? null, id]);
    }
    if (description !== undefined) {
      await query('UPDATE assets SET description = $1 WHERE id = $2', [description ?? null, id]);
    }
    if (visibility !== undefined) {
      // Bara ägaren eller admin får ändra synlighet
      const { rows: own } = await query('SELECT owner_id FROM assets WHERE id = $1', [id]);
      if (own[0] && (own[0].owner_id === request.user.id || request.user.role === 'admin')) {
        await query('UPDATE assets SET visibility = $1 WHERE id = $2', [visibility, id]);
      }
    }
    if (rating !== undefined || title !== undefined || description !== undefined) {
      const { rows: ar } = await query('SELECT file_path FROM assets WHERE id = $1', [id]);
      if (ar[0]?.file_path) {
        try {
          const absPath = resolve(config.media.photosPath,ar[0].file_path);
          const xmpFields = {};
          if (rating !== undefined) xmpFields.rating = rating;
          if (title !== undefined)  xmpFields.title  = title;
          if (description !== undefined) xmpFields.description = description;
          await writeMetaToFile(absPath, xmpFields);
        } catch (err) {
          fastify.log.warn(`Kunde inte skriva XMP till fil: ${err.message}`);
        }
      }
    }

    // Ersätt taggar
    if (tags) {
      await query('DELETE FROM asset_tags WHERE asset_id = $1', [id]);
      for (const tagName of tags) {
        const normalized = tagName.trim();
        if (!normalized) continue;
        // name-kolumnen har inte längre UNIQUE — leta upp befintlig tagg först
        const { rows: found } = await query(
          'SELECT id FROM tags WHERE lower(name) = lower($1) LIMIT 1',
          [normalized]
        );
        let tagId;
        if (found.length) {
          tagId = found[0].id;
        } else {
          const lc = normalized.toLowerCase();
          const { rows: ins } = await query(
            'INSERT INTO tags (name, path) VALUES ($1, $2) ON CONFLICT (path) DO UPDATE SET name = EXCLUDED.name RETURNING id',
            [lc, lc]
          );
          tagId = ins[0].id;
        }
        await query(
          'INSERT INTO asset_tags (asset_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [id, tagId]
        );
      }
    }

    const changed = Object.fromEntries(
      Object.entries({ takenAt, locationLabel, rating, flag, colorLabel, title, description, visibility, tags: tags?.length })
        .filter(([, v]) => v !== undefined)
    );
    await logAudit(request.user.id, 'edit_metadata', id, 'asset', changed, request.ip);
    return reply.send({ data: { ok: true } });
  });

  // GET /api/assets/:id/metadata — fullständig metadata för Info Drawer
  fastify.get('/api/assets/:id/metadata', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;

    const { rows } = await query(`
      SELECT
        a.id, a.file_name, a.file_size, a.mime_type, a.file_path,
        a.width, a.height, a.taken_at, a.indexed_at, a.view_count,
        a.file_hash, a.location_label, a.rating, a.title, a.description,
        a.thumb_large_path, a.visibility, a.owner_id,
        ST_Y(a.location::geometry) AS lat,
        ST_X(a.location::geometry) AS lon,
        u.username AS owner_name,
        (SELECT COALESCE(json_agg(json_build_object(
           'faceId', f.id, 'personId', p.id, 'personName', p.name, 'birthYear', p.birth_year,
           'x', f.region_x, 'y', f.region_y, 'w', f.region_w, 'h', f.region_h
         )), '[]'::json)
         FROM faces f LEFT JOIN persons p ON p.id = f.person_id
         WHERE f.asset_id = a.id) AS faces,
        (SELECT COALESCE(json_agg(t.name ORDER BY t.name), '[]'::json)
         FROM asset_tags at2 JOIN tags t ON t.id = at2.tag_id
         WHERE at2.asset_id = a.id) AS tags,
        (SELECT COALESCE(json_agg(t.name ORDER BY t.name), '[]'::json)
         FROM asset_tags at2 JOIN tags t ON t.id = at2.tag_id
         WHERE at2.asset_id = a.id AND at2.source = 'ai') AS ai_tags,
        (SELECT COALESCE(json_agg(json_build_object(
           'shareType', s.share_type, 'sharedWith', su.username, 'expiresAt', s.expires_at
         )), '[]'::json)
         FROM shares s LEFT JOIN users su ON su.id = s.shared_with
         WHERE s.asset_id = a.id) AS shared_with,
        (SELECT COUNT(*) FROM assets
         WHERE file_hash = a.file_hash AND status != 'deleted' AND id != a.id) AS duplicates_count,
        (SELECT COALESCE(json_agg(json_build_object('id', al.id, 'name', al.name) ORDER BY al.name), '[]'::json)
         FROM album_assets aa JOIN albums al ON al.id = aa.album_id
         WHERE aa.asset_id = a.id) AS albums
      FROM assets a
      LEFT JOIN users u ON u.id = a.owner_id
      WHERE a.id = $1 AND a.status != 'deleted'
    `, [id]);

    if (!rows[0]) return reply.status(404).send({ error: 'Hittades inte' });
    const a = rows[0];

    // Hämta EXIF + XMP-data (XMP-overrides har högre prioritet — t.ex. manuellt redigerad kameramodell)
    const { rows: metaRows } = await query(
      `SELECT source, key, value FROM asset_metadata WHERE asset_id = $1 AND source IN ('exif', 'xmp')`, [id]
    );
    const exif = {};
    for (const r of metaRows) {
      if (r.source === 'exif' && exif[r.key] === undefined) exif[r.key] = r.value;
      if (r.source === 'xmp') exif[r.key] = r.value; // XMP override
    }

    const exifStr = (k) => exif[k] != null ? String(exif[k]).replace(/^"|"$/g, '') : null;
    const exifNum = (k) => exif[k] != null ? parseFloat(exif[k]) : null;

    const shutterSec = exifNum('33434');
    const fNumber    = exifNum('33437');
    const iso        = exifNum('34855');
    const focalMm    = exifNum('37386');
    const fl35mm     = exifNum('41989');
    const flashVal   = exifNum('37385');

    const filePath  = a.file_path ?? '';
    const slashIdx  = filePath.lastIndexOf('/');
    const folderPath = slashIdx > 0 ? filePath.substring(0, slashIdx) : '/';
    const mp = (a.width && a.height) ? ((a.width * a.height) / 1_000_000).toFixed(1) : null;

    return reply.send({ data: {
      assetId: a.id,
      fileInfo: {
        fileName:      a.file_name,
        fileSize:      mbytes(a.file_size),
        mimeType:      a.mime_type,
        folderPath,
        dimensions:    (a.width && a.height) ? `${a.width} × ${a.height}` : null,
        megaPixels:    mp ? `${mp} MP` : null,
        uploadedBy:    request.user.role === 'admin' ? (a.owner_name ?? 'Okänd') : null,
        thumbLargePath: a.thumb_large_path ?? null,
      },
      organization: {
        title:       a.title ?? null,
        description: a.description ?? null,
        rating:      a.rating ?? null,
        label:       null,
        keywords:    a.tags ?? [],
        aiKeywords:  a.ai_tags ?? [],
      },
      faces: (a.faces ?? []).map(f => ({
        faceId:      f.faceId,
        personId:    f.personId,
        personName:  f.personName,
        birthYear:   f.birthYear ?? null,
        boundingBox: { x: f.x, y: f.y, width: f.w, height: f.h },
      })),
      temporalSpatial: {
        capturedAt: a.taken_at ?? null,
        gps: (a.lat != null && a.lon != null) ? { latitude: a.lat, longitude: a.lon } : null,
        location: a.location_label ? parseLocationLabel(a.location_label) : null,
      },
      camera: {
        make:         exifStr('271'),
        model:        exifStr('272'),
        lens:         exifStr('42036'),
        shutterSpeed: shutterSec ? (shutterSec < 1 ? `1/${Math.round(1/shutterSec)}s` : `${shutterSec}s`) : null,
        aperture:     fNumber    ? `f/${fNumber}`  : null,
        iso:          iso        ? Math.round(iso) : null,
        focalLength:  focalMm   ? `${focalMm} mm${fl35mm ? ` (${Math.round(fl35mm)} mm)` : ''}` : null,
        flash:        flashVal != null ? ((flashVal & 1) ? 'Utlöstes' : 'Utlöstes inte') : null,
      },
      albums: a.albums ?? [],
      system: {
        checksum:        a.file_hash,
        duplicatesCount: parseInt(a.duplicates_count ?? 0),
        viewCount:       a.view_count ?? 0,
        sharedWith:      a.shared_with ?? [],
        indexedAt:       a.indexed_at,
        visibility:      a.visibility ?? 'family',
        isOwner:         a.owner_id === request.user.id || request.user.role === 'admin',
      },
    }});
  });

  // POST /api/assets/:id/edit — icke-destruktiv bildredigering med Sharp
  fastify.post('/api/assets/:id/edit', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['operations'],
        properties: {
          operations: { type: 'array' },
          saveAs: { type: 'string', enum: ['replace', 'copy'], default: 'replace' },
        },
      },
    },
  }, async (request, reply) => {
    try {
    const { id } = request.params;
    const { operations = [], saveAs = 'replace' } = request.body;

    const { rows } = await query(
      `SELECT id, file_path, file_name, mime_type, owner_id,
              taken_at, location_label, rating, title, description
       FROM assets WHERE id = $1 AND status = 'active'`,
      [id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Hittades inte' });

    const asset = rows[0];
    if (asset.owner_id !== request.user.id && request.user.role !== 'admin') {
      return reply.status(403).send({ error: 'Åtkomst nekad' });
    }

    // Endast bilder (inte video)
    if (!asset.mime_type?.startsWith('image/')) {
      return reply.status(400).send({ error: 'Videoredigering stöds inte' });
    }

    const absOriginal = resolve(config.media.photosPath,asset.file_path);
    if (!existsSync(absOriginal)) return reply.status(404).send({ error: 'Originalfil saknas' });

    // Bygg Sharp-pipeline
    const origMeta = await sharp(absOriginal).metadata();
    const rawW = origMeta.width  ?? 0;
    const rawH = origMeta.height ?? 0;
    const orientation = origMeta.orientation ?? 1;

    let pipeline = sharp(absOriginal);

    // Crop hanteras separat och först: konvertera display-procent till råa pixelkoordinater
    // med hänsyn till EXIF-orientering, och applicera sedan explicit rotation.
    // Detta undviker det tvetydiga .rotate()-utan-argument + .extract()-kombinationen.
    const cropOp = operations.find(op => op.type === 'crop');
    if (cropOp) {
      const lp = Math.max(0, Math.min(1, Number(cropOp.lp ?? 0)));
      const tp = Math.max(0, Math.min(1, Number(cropOp.tp ?? 0)));
      const wp = Math.max(0, Math.min(1, Number(cropOp.wp ?? 0)));
      const hp = Math.max(0, Math.min(1, Number(cropOp.hp ?? 0)));
      const ex = exifAdjustedExtract(lp, tp, wp, hp, orientation, rawW, rawH);
      if (ex.width > 0 && ex.height > 0) pipeline = pipeline.extract({ left: ex.left, top: ex.top, width: ex.width, height: ex.height });
      if (ex.rotateDeg !== 0) pipeline = pipeline.rotate(ex.rotateDeg);
    } else {
      // Ingen beskärning: EXIF auto-rotation är säker utan .extract()
      pipeline = pipeline.rotate();
    }

    for (const op of operations) {
      switch (op.type) {
        case 'crop':
          break; // already handled above
        case 'rotate':
          pipeline = pipeline.rotate(Number(op.angle) || 0);
          break;
        case 'flip':
          pipeline = pipeline.flip();
          break;
        case 'flop':
          pipeline = pipeline.flop();
          break;
        case 'modulate': {
          const mods = {};
          if (op.brightness != null) mods.brightness = Number(op.brightness);
          if (op.saturation != null) mods.saturation = Number(op.saturation);
          if (op.hue       != null) mods.hue         = Number(op.hue);
          if (Object.keys(mods).length) pipeline = pipeline.modulate(mods);
          break;
        }
        case 'linear': {
          const a = Number(op.a ?? 1);
          const b = Number(op.b ?? 0);
          if (a !== 1 || b !== 0) pipeline = pipeline.linear(a, b);
          break;
        }
        case 'sharpen':
          pipeline = pipeline.sharpen();
          break;
        case 'normalize':
          pipeline = pipeline.normalize();
          break;
      }
    }

    // Bevara EXIF-metadata (datum, GPS m.m.) men sätt orientation=1 (rotationen är inbakad)
    pipeline = pipeline.withMetadata({ orientation: 1 });

    // Bevara originalformat (eller konvertera till JPEG om okänt)
    const ext = extname(asset.file_name).toLowerCase();
    const outFormat = ['.jpg', '.jpeg'].includes(ext) ? 'jpeg'
      : ext === '.png' ? 'png'
      : ext === '.webp' ? 'webp'
      : 'jpeg';

    if (saveAs === 'copy') {
      // Spara som ny fil bredvid originalet
      const newId    = uuidv4();
      const baseName = basename(asset.file_name, extname(asset.file_name));
      const origDir  = dirname(asset.file_path);
      const dirPart  = origDir && origDir !== '.' ? origDir + '/' : '';

      // Generera unikt filnamn — kontrollera både filsystem och DB (UNIQUE-constraint på file_path)
      let newFileName = `${baseName}_edit${ext || '.jpg'}`;
      let newRelPath  = dirPart + newFileName;
      let absNewPath  = resolve(config.media.photosPath, newRelPath);
      let counter = 2;
      while (
        existsSync(absNewPath) ||
        (await query('SELECT 1 FROM assets WHERE file_path = $1', [newRelPath])).rows.length > 0
      ) {
        newFileName = `${baseName}_edit_${counter++}${ext || '.jpg'}`;
        newRelPath  = dirPart + newFileName;
        absNewPath  = resolve(config.media.photosPath, newRelPath);
      }

      try {
        const { data: buf, info: outInfo } = await pipeline.toFormat(outFormat).toBuffer({ resolveWithObject: true });
        await writeFile(absNewPath, buf);

        await query(
          `INSERT INTO assets
             (id, file_name, file_path, mime_type, owner_id, source_folder, status, indexed_at,
              taken_at, location, location_label, rating, title, description,
              file_size, width, height)
           VALUES ($1,$2,$3,$4,$5,$6,'active',NOW(),$7,
                   (SELECT location FROM assets WHERE id = $8),
                   $9,$10,$11,$12,$13,$14,$15)`,
          [newId, newFileName, newRelPath, `image/${outFormat}`, asset.owner_id, dirname(absNewPath),
           asset.taken_at ?? null, id,
           asset.location_label ?? null, asset.rating ?? null,
           asset.title ?? null, asset.description ?? null,
           outInfo.size, outInfo.width, outInfo.height]
        );
        // Kopiera taggar från originalet
        await query(
          `INSERT INTO asset_tags (asset_id, tag_id)
           SELECT $1, tag_id FROM asset_tags WHERE asset_id = $2
           ON CONFLICT DO NOTHING`,
          [newId, id]
        );
        await generateThumbnails(newId, absNewPath, `image/${outFormat}`);

        await logAudit(request.user.id, 'edit_copy', id, 'asset', { operations }, request.ip);
        const { rows: newRows } = await query('SELECT * FROM assets WHERE id = $1', [newId]);
        return reply.status(201).send({ data: newRows[0] });
      } catch (err) {
        fastify.log.error(err, 'edit-copy failed');
        return reply.status(500).send({ error: err.message ?? 'Intern serverfel vid sparning av kopia' });
      }

    } else {
      // Ersätt originalet (spara backup först)
      const backupPath = absOriginal + '.bak';
      await copyFile(absOriginal, backupPath);

      let replaceInfo;
      try {
        const { data: buf, info } = await pipeline.toFormat(outFormat).toBuffer({ resolveWithObject: true });
        replaceInfo = info;
        await writeFile(absOriginal, buf);
        await unlink(backupPath).catch(() => {});
      } catch (err) {
        await copyFile(backupPath, absOriginal).catch(() => {});
        await unlink(backupPath).catch(() => {});
        throw err;
      }

      if (replaceInfo) {
        await query(
          'UPDATE assets SET file_size=$1, width=$2, height=$3 WHERE id=$4',
          [replaceInfo.size, replaceInfo.width, replaceInfo.height, id]
        );
      }
      await generateThumbnails(id, absOriginal, asset.mime_type);
      await logAudit(request.user.id, 'edit_replace', id, 'asset', { operations }, request.ip);

      const { rows: updRows } = await query('SELECT * FROM assets WHERE id = $1', [id]);
      return reply.send({ data: updRows[0] });
    }
    } catch (err) {
      fastify.log.error(err, 'asset-edit failed');
      return reply.status(500).send({ error: err.message ?? 'Intern serverfel' });
    }
  });

  // DELETE /api/assets/:id — flytta fil till .trash/ och markera som trashed i DB
  fastify.delete('/api/assets/:id', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const perm = await query(
      "SELECT value FROM user_permissions WHERE user_id = $1 AND permission_key = 'write.delete'",
      [request.user.id]
    );
    const canDelete = request.user.role === 'admin' || (perm.rows[0]?.value ?? true);
    if (!canDelete) return reply.status(403).send({ error: 'Saknar raderingsrätt' });

    const { id } = request.params;
    const { rows } = await query(
      "SELECT id, file_path, source_folder FROM assets WHERE id = $1 AND status IN ('active', 'duplicate')",
      [id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Hittades inte eller redan i papperskorgen' });

    const relPath      = rows[0].file_path;
    const sourceFolder = rows[0].source_folder;                    // absolut: /media/Bilder
    const absPath      = resolve(config.media.photosPath,relPath);   // absolut sökväg till filen
    let trashPath = null;

    if (existsSync(absPath)) {
      // .trash ligger inuti den bevakade mappen: <sourceFolder>/.trash/<subPath>
      const subPath   = relative(sourceFolder, absPath).replace(/\\/g, '/');
      const trashDir  = join(sourceFolder, '.trash', dirname(subPath));
      const trashFile = basename(subPath);
      trashPath = join(sourceFolder, '.trash', subPath);

      await mkdir(trashDir, { recursive: true });

      // Namnkollision — lägg till tidsstämpel
      if (existsSync(trashPath)) {
        const ts  = Date.now();
        const dot = trashFile.lastIndexOf('.');
        const name = dot >= 0 ? trashFile.slice(0, dot) + `_${ts}` + trashFile.slice(dot) : trashFile + `_${ts}`;
        trashPath = join(trashDir, name);
      }

      try {
        await rename(absPath, trashPath);
      } catch (mvErr) {
        if (mvErr.code !== 'EXDEV') throw mvErr;
        await copyFile(absPath, trashPath);
        await unlink(absPath);
      }
    }

    await query(
      "UPDATE assets SET status = 'trashed', trashed_at = NOW(), trash_path = $2 WHERE id = $1",
      [id, trashPath]
    );
    await logAudit(request.user.id, 'trash', id, 'asset', null, request.ip);
    return reply.send({ data: { ok: true } });
  });

  // GET /api/trash — visa papperskorgen
  fastify.get('/api/trash', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const userId = request.user.id;
    const isAdmin = request.user.role === 'admin';

    const ownerFilter = isAdmin ? '' : `AND a.owner_id = '${userId}'`;
    const { rows } = await query(
      `SELECT id, file_name, mime_type, thumb_small_path, trashed_at, file_size
       FROM assets a
       WHERE a.status = 'trashed' ${ownerFilter}
       ORDER BY a.trashed_at DESC`
    );
    return reply.send({ data: rows });
  });

  // POST /api/trash/:id/restore — flytta fil tillbaka och återställ i DB
  fastify.post('/api/trash/:id/restore', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await query(
      "SELECT id, file_path, trash_path FROM assets WHERE id = $1 AND status = 'trashed'",
      [id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Hittades inte i papperskorgen' });

    const { file_path, trash_path } = rows[0];
    const absOriginal = resolve(config.media.photosPath,file_path);

    // Flytta tillbaka filen om den finns i .trash
    if (trash_path && existsSync(trash_path)) {
      await mkdir(dirname(absOriginal), { recursive: true });
      await rename(trash_path, absOriginal);
    }

    await query(
      "UPDATE assets SET status = 'active', trashed_at = NULL, trash_path = NULL WHERE id = $1",
      [id]
    );
    await logAudit(request.user.id, 'restore', id, 'asset', null, request.ip);
    return reply.send({ data: { ok: true } });
  });

  // DELETE /api/trash/:id/permanent — permanent radering (admin only)
  fastify.delete('/api/trash/:id/permanent', {
    onRequest: [fastify.requireAdmin],
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await query(
      "SELECT id, trash_path FROM assets WHERE id = $1 AND status = 'trashed'",
      [id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Hittades inte i papperskorgen' });

    const { trash_path } = rows[0];

    // Radera fysisk fil från .trash
    if (trash_path && existsSync(trash_path)) {
      await unlink(trash_path).catch(() => {});
    }

    // Rensa all kopplad data i rätt ordning (FK-beroenden)
    await query('DELETE FROM ai_suggestions WHERE face_id IN (SELECT id FROM faces WHERE asset_id = $1)', [id]);
    await query('DELETE FROM faces WHERE asset_id = $1', [id]);
    await query('DELETE FROM asset_tags WHERE asset_id = $1', [id]);
    await query('DELETE FROM asset_metadata WHERE asset_id = $1', [id]);
    await query('DELETE FROM album_assets WHERE asset_id = $1', [id]);
    await query('DELETE FROM event_assets WHERE asset_id = $1', [id]);
    await query('DELETE FROM assets WHERE id = $1', [id]);

    await logAudit(request.user.id, 'permanent_delete', id, 'asset', null, request.ip);
    return reply.send({ data: { ok: true } });
  });

  // GET /api/folders?path= — visa mappstruktur (hjälpfunktioner definieras efter routern)
  fastify.get('/api/folders', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: { path: { type: 'string', default: '' } },
      },
    },
  }, async (request, reply) => {
    const folderPath = request.query.path ?? '';

    // Hitta unika undermappar och filer på angiven nivå
    const prefix = folderPath ? `${folderPath}/` : '';
    const depth = prefix.split('/').filter(Boolean).length + 1;

    const { rows } = await query(
      `SELECT DISTINCT
         split_part(file_path, '/', $1) AS segment,
         COUNT(*) OVER (PARTITION BY split_part(file_path, '/', $1)) AS asset_count
       FROM assets
       WHERE status = 'active'
         AND file_path LIKE $2
         AND array_length(string_to_array(file_path, '/'), 1) >= $1
       ORDER BY segment`,
      [depth, `${prefix}%`]
    );

    return reply.send({ data: rows });
  });

  // ── PATCH /api/assets/bulk-tags — lägg till/ta bort taggar på flera assets (C) ──
  fastify.patch('/api/assets/bulk-tags', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['assetIds'],
        properties: {
          assetIds:    { type: 'array', items: { type: 'string' }, minItems: 1 },
          addTags:     { type: 'array', items: { type: 'string' } },
          removeTags:  { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const { assetIds, addTags = [], removeTags = [] } = request.body;
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';

    // Kontrollera att användaren äger alla assets
    if (!isAdmin) {
      const { rows: owned } = await query(
        `SELECT id FROM assets WHERE id = ANY($1::uuid[]) AND owner_id = $2`,
        [assetIds, userId]
      );
      if (owned.length !== assetIds.length) {
        return reply.code(403).send({ error: 'Du äger inte alla valda filer' });
      }
    }

    // Lägg till taggar
    for (const tagName of addTags) {
      const normalized = tagName.toLowerCase().trim();
      const { rows: foundTag } = await query('SELECT id FROM tags WHERE lower(name) = $1 LIMIT 1', [normalized]);
      let tagId;
      if (foundTag.length) {
        tagId = foundTag[0].id;
      } else {
        const { rows: tagRows } = await query(
          `INSERT INTO tags (name, path) VALUES ($1, $1) ON CONFLICT (path) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
          [normalized]
        );
        tagId = tagRows[0].id;
      }
      await query(
        `INSERT INTO asset_tags (asset_id, tag_id)
         SELECT unnest($1::uuid[]), $2
         ON CONFLICT DO NOTHING`,
        [assetIds, tagId]
      );
    }

    // Ta bort taggar
    for (const tagName of removeTags) {
      const normalized = tagName.toLowerCase().trim();
      const { rows: tagRows } = await query('SELECT id FROM tags WHERE name = $1', [normalized]);
      if (tagRows.length) {
        await query(
          `DELETE FROM asset_tags WHERE asset_id = ANY($1::uuid[]) AND tag_id = $2`,
          [assetIds, tagRows[0].id]
        );
      }
    }

    return reply.send({ data: { updated: assetIds.length, addedTags: addTags, removedTags: removeTags } });
  });

  // PATCH /api/assets/bulk-datetime — sätt datum på flera assets
  fastify.patch('/api/assets/bulk-datetime', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['assetIds', 'takenAt'],
        properties: {
          assetIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
          takenAt:  { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { assetIds, takenAt } = request.body;
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';
    const ts = new Date(takenAt);
    if (isNaN(ts.getTime())) return reply.status(400).send({ error: 'Ogiltigt datum' });

    const { rowCount } = await query(
      `UPDATE assets SET taken_at = $1
       WHERE id = ANY($2::uuid[]) AND status = 'active' AND ($3 OR owner_id = $4)`,
      [ts, assetIds, isAdmin, userId],
    );
    return reply.send({ data: { updated: rowCount } });
  });

  // PATCH /api/assets/bulk-location — sätt plats på flera assets
  fastify.patch('/api/assets/bulk-location', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['assetIds'],
        properties: {
          assetIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
          lat:      { type: ['number', 'null'] },
          lon:      { type: ['number', 'null'] },
          label:    { type: ['string', 'null'] },
        },
      },
    },
  }, async (request, reply) => {
    const { assetIds, lat, lon, label } = request.body;
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';

    const { rows: assets } = await query(
      `SELECT id FROM assets WHERE id = ANY($1::uuid[]) AND status = 'active' AND ($2 OR owner_id = $3)`,
      [assetIds, isAdmin, userId],
    );

    for (const a of assets) {
      if (lat != null && lon != null) {
        await upsertAssetLocation(a.id, lat, lon);
        if (label != null) {
          await query(`UPDATE assets SET location_label = $1 WHERE id = $2`, [label, a.id]);
        }
      } else {
        await query(
          `UPDATE assets SET location = NULL, location_label = NULL WHERE id = $1`,
          [a.id],
        );
      }
    }
    return reply.send({ data: { updated: assets.length } });
  });

  // POST /api/assets/batch-metadata — hämtar kamera, taggar och personnamn för batch-rename
  fastify.post('/api/assets/batch-metadata', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['assetIds'],
        properties: { assetIds: { type: 'array', items: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { assetIds } = request.body;
    if (!assetIds.length) return reply.send({ data: {} });

    const { rows } = await query(
      `SELECT a.id,
         (SELECT value FROM asset_metadata WHERE asset_id = a.id AND key = '271' LIMIT 1) AS camera_make,
         (SELECT value FROM asset_metadata WHERE asset_id = a.id AND key = '272' LIMIT 1) AS camera_model,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT tg.name), NULL)  AS tag_names,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT p.name),  NULL)  AS person_names
       FROM assets a
       LEFT JOIN asset_tags at2 ON at2.asset_id = a.id
       LEFT JOIN tags tg ON tg.id = at2.tag_id
       LEFT JOIN faces f ON f.asset_id = a.id AND f.person_id IS NOT NULL
       LEFT JOIN persons p ON p.id = f.person_id
       WHERE a.id = ANY($1::uuid[])
       GROUP BY a.id`,
      [assetIds],
    );

    const map = Object.fromEntries(rows.map((r) => [r.id, {
      camera_make:   r.camera_make  ?? null,
      camera_model:  r.camera_model ?? null,
      tag_names:     r.tag_names    ?? [],
      person_names:  r.person_names ?? [],
    }]));
    return reply.send({ data: map });
  });
}

function mbytes(bytes) {
  const n = Number(bytes);
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(2)} ${units[i]}`;
}

function parseLocationLabel(label) {
  const parts = label.split(',').map(s => s.trim());
  if (parts.length >= 3) return { city: parts[0], region: parts[1], country: parts[parts.length - 1] };
  if (parts.length === 2) return { city: parts[0], region: null, country: parts[1] };
  return { city: parts[0] ?? null, region: null, country: null };
}
