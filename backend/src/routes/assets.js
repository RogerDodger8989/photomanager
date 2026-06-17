import { query } from '../db/pool.js';
import { logAudit } from '../services/authService.js';

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
          takenAt:    { type: 'string', format: 'date-time' },
          tags:       { type: 'array', items: { type: 'string' } },
          locationLabel: { type: 'string' },
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
    const { takenAt, tags, locationLabel } = request.body;

    if (takenAt) {
      await query('UPDATE assets SET taken_at = $1 WHERE id = $2', [takenAt, id]);
    }
    if (locationLabel !== undefined) {
      await query('UPDATE assets SET location_label = $1 WHERE id = $2', [locationLabel, id]);
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

  // GET /api/folders?path= — visa mappstruktur
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
