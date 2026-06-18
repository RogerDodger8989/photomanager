import { query } from '../db/pool.js';
import { logAudit } from '../services/authService.js';
import { writeMetaToFile } from '../services/xmpService.js';
import { join } from 'path';
import { config } from '../config.js';

export default async function assetsRoutes(fastify) {

  // GET /api/assets — tidslinje med cursor-paginering
  fastify.get('/api/assets', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          cursor:  { type: 'string' },         // ISO-datum för cursor
          limit:   { type: 'integer', default: 50, maximum: 200 },
          sort:    { type: 'string', enum: ['taken_at', 'file_size', 'view_count', 'indexed_at'], default: 'taken_at' },
          order:   { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
          ownOnly: { type: 'boolean', default: false },
        },
      },
    },
  }, async (request, reply) => {
    const { cursor, limit = 50, sort = 'taken_at', order = 'desc', ownOnly } = request.query;
    const userId = request.user.id;
    const isAdmin = request.user.role === 'admin';

    const params = [limit + 1];
    let conditions = ["a.status = 'active'"];

    // Gäster och icke-admins ser bara sina egna bilder om ownOnly är satt
    if (ownOnly || (!isAdmin && request.user.role !== 'user')) {
      conditions.push(`a.owner_id = $${params.push(userId)}`);
    }

    // Cursor-baserad paginering
    const op = order === 'desc' ? '<' : '>';
    if (cursor) {
      conditions.push(`a.${sort} ${op} $${params.push(cursor)}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT a.id, a.file_name, a.mime_type, a.file_size, a.width, a.height,
              a.taken_at, a.indexed_at, a.thumb_small_path, a.thumb_large_path,
              a.location_label, a.view_count, a.duration, a.transcode_status,
              a.owner_id,
              ST_Y(a.location::geometry) AS lat,
              ST_X(a.location::geometry) AS lon
       FROM assets a
       ${where}
       ORDER BY a.${sort} ${order} NULLS LAST
       LIMIT $1`,
      params
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1][sort] : null;

    return reply.send({ data: items, meta: { hasMore, nextCursor } });
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
          title:         { type: ['string', 'null'] },
          description:   { type: ['string', 'null'] },
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
    const { takenAt, tags, locationLabel, rating, title, description } = request.body;

    if (takenAt) {
      await query('UPDATE assets SET taken_at = $1 WHERE id = $2', [takenAt, id]);
    }
    if (locationLabel !== undefined) {
      await query('UPDATE assets SET location_label = $1 WHERE id = $2', [locationLabel, id]);
    }
    if (rating !== undefined) {
      await query('UPDATE assets SET rating = $1 WHERE id = $2', [rating ?? null, id]);
    }
    if (title !== undefined) {
      await query('UPDATE assets SET title = $1 WHERE id = $2', [title ?? null, id]);
    }
    if (description !== undefined) {
      await query('UPDATE assets SET description = $1 WHERE id = $2', [description ?? null, id]);
    }
    if (rating !== undefined || title !== undefined || description !== undefined) {
      const { rows: ar } = await query('SELECT file_path FROM assets WHERE id = $1', [id]);
      if (ar[0]?.file_path) {
        try {
          const absPath = join(config.media.photosPath, ar[0].file_path);
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
        const normalized = tagName.toLowerCase().trim();
        if (!normalized) continue;
        const { rows } = await query(
          `INSERT INTO tags (name) VALUES ($1)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [normalized]
        );
        await query(
          'INSERT INTO asset_tags (asset_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [id, rows[0].id]
        );
      }
    }

    await logAudit(request.user.id, 'edit_metadata', id, 'asset', null, request.ip);
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
        a.thumb_large_path,
        ST_Y(a.location::geometry) AS lat,
        ST_X(a.location::geometry) AS lon,
        u.username AS owner_name,
        (SELECT COALESCE(json_agg(json_build_object(
           'faceId', f.id, 'personId', p.id, 'personName', p.name,
           'x', f.region_x, 'y', f.region_y, 'w', f.region_w, 'h', f.region_h
         )), '[]'::json)
         FROM faces f LEFT JOIN persons p ON p.id = f.person_id
         WHERE f.asset_id = a.id) AS faces,
        (SELECT COALESCE(json_agg(t.name), '[]'::json)
         FROM asset_tags at2 JOIN tags t ON t.id = at2.tag_id
         WHERE at2.asset_id = a.id) AS tags,
        (SELECT COALESCE(json_agg(json_build_object(
           'shareType', s.share_type, 'sharedWith', su.username, 'expiresAt', s.expires_at
         )), '[]'::json)
         FROM shares s LEFT JOIN users su ON su.id = s.shared_with
         WHERE s.asset_id = a.id) AS shared_with,
        (SELECT COUNT(*) FROM assets
         WHERE file_hash = a.file_hash AND status != 'deleted' AND id != a.id) AS duplicates_count
      FROM assets a
      LEFT JOIN users u ON u.id = a.owner_id
      WHERE a.id = $1 AND a.status != 'deleted'
    `, [id]);

    if (!rows[0]) return reply.status(404).send({ error: 'Hittades inte' });
    const a = rows[0];

    // Hämta EXIF-data (numeriska TIFF-tag-nycklar)
    const { rows: metaRows } = await query(
      `SELECT key, value FROM asset_metadata WHERE asset_id = $1 AND source = 'exif'`, [id]
    );
    const exif = Object.fromEntries(metaRows.map(r => [r.key, r.value]));

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
        uploadedBy:    a.owner_name ?? 'Okänd',
        thumbLargePath: a.thumb_large_path ?? null,
      },
      organization: {
        title:       a.title ?? null,
        description: a.description ?? null,
        rating:      a.rating ?? null,
        label:       null,
        keywords:    a.tags ?? [],
      },
      faces: (a.faces ?? []).map(f => ({
        faceId:      f.faceId,
        personId:    f.personId,
        personName:  f.personName,
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
      system: {
        checksum:        a.file_hash,
        duplicatesCount: parseInt(a.duplicates_count ?? 0),
        viewCount:       a.view_count ?? 0,
        sharedWith:      a.shared_with ?? [],
        indexedAt:       a.indexed_at,
      },
    }});
  });

  // DELETE /api/assets/:id — flytta till papperskorg
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
      "UPDATE assets SET status = 'trashed', trashed_at = NOW() WHERE id = $1 AND status = 'active' RETURNING id",
      [id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Hittades inte eller redan i papperskorgen' });

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

  // POST /api/trash/:id/restore — återställ från papperskorg
  fastify.post('/api/trash/:id/restore', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await query(
      "UPDATE assets SET status = 'active', trashed_at = NULL WHERE id = $1 AND status = 'trashed' RETURNING id",
      [id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Hittades inte i papperskorgen' });

    await logAudit(request.user.id, 'restore', id, 'asset', null, request.ip);
    return reply.send({ data: { ok: true } });
  });

  // DELETE /api/trash/:id/permanent — permanent radering (admin only)
  fastify.delete('/api/trash/:id/permanent', {
    onRequest: [fastify.requireAdmin],
  }, async (request, reply) => {
    const { id } = request.params;
    await query("UPDATE assets SET status = 'deleted' WHERE id = $1 AND status = 'trashed'", [id]);
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
