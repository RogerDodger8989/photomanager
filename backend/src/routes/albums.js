import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/pool.js';

export default async function albumsRoutes(fastify) {

  // GET /api/albums — valfri ?assetId=xxx lägger till contains_asset per album
  fastify.get('/api/albums', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: { assetId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { assetId } = request.query;
    const params = [request.user.id];
    if (assetId) params.push(assetId);
    const { rows } = await query(
      `SELECT al.id, al.name, al.description, al.is_smart, al.rule_logic, al.created_at, al.updated_at,
              al.cover_asset_id,
              COALESCE(
                a.thumb_small_path,
                (SELECT a2.thumb_small_path
                 FROM album_assets aa2
                 JOIN assets a2 ON a2.id = aa2.asset_id AND a2.status = 'active'
                 WHERE aa2.album_id = al.id
                 ORDER BY aa2.sort_order, a2.taken_at LIMIT 1)
              ) AS cover_thumb,
              COUNT(aa.asset_id)::int AS asset_count
              ${assetId ? `, EXISTS(SELECT 1 FROM album_assets cx WHERE cx.album_id = al.id AND cx.asset_id = $2) AS contains_asset` : ''}
       FROM albums al
       LEFT JOIN album_assets aa ON aa.album_id = al.id
       LEFT JOIN assets a ON a.id = al.cover_asset_id
       WHERE al.owner_id = $1
       GROUP BY al.id, a.thumb_small_path
       ORDER BY al.updated_at DESC`,
      params
    );
    return reply.send({ data: rows });
  });

  // POST /api/albums
  fastify.post('/api/albums', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name:        { type: 'string', minLength: 1 },
          description: { type: 'string' },
          is_smart:    { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const { name, description, is_smart } = request.body;
    const { rows } = await query(
      'INSERT INTO albums (id, name, description, owner_id, is_smart) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [uuidv4(), name, description ?? null, request.user.id, is_smart ?? false]
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // GET /api/albums/:id
  fastify.get('/api/albums/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit:  { type: 'integer', default: 50 },
          offset: { type: 'integer', default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { limit = 50, offset = 0 } = request.query;

    const { rows: albumRows } = await query('SELECT * FROM albums WHERE id = $1', [id]);
    if (!albumRows[0]) return reply.status(404).send({ error: 'Album hittades inte' });

    const { rows: assets } = await query(
      `SELECT a.id, a.file_name, a.mime_type, a.taken_at,
              a.thumb_small_path, a.thumb_large_path, a.duration,
              aa.sort_order,
              EXISTS(SELECT 1 FROM favorites fv WHERE fv.asset_id = a.id AND fv.user_id = $2) AS is_favorite
       FROM album_assets aa
       JOIN assets a ON a.id = aa.asset_id AND a.status = 'active'
       WHERE aa.album_id = $1
       ORDER BY aa.sort_order, a.taken_at
       LIMIT $3 OFFSET $4`,
      [id, request.user.id, limit, offset]
    );

    const { rows: countRows } = await query(
      'SELECT COUNT(*)::int AS total FROM album_assets WHERE album_id = $1',
      [id]
    );

    return reply.send({
      data: { album: albumRows[0], assets },
      meta: { total: countRows[0].total, limit, offset },
    });
  });

  // PUT /api/albums/:id
  fastify.put('/api/albums/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          name:          { type: 'string' },
          description:   { type: 'string' },
          coverAssetId:  { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { name, description, coverAssetId } = request.body;
    if (name !== undefined) {
      await query('UPDATE albums SET name = $1, updated_at = NOW() WHERE id = $2 AND owner_id = $3',
        [name, id, request.user.id]);
    }
    if (description !== undefined) {
      await query('UPDATE albums SET description = $1, updated_at = NOW() WHERE id = $2 AND owner_id = $3',
        [description, id, request.user.id]);
    }
    if (coverAssetId !== undefined) {
      await query('UPDATE albums SET cover_asset_id = $1, updated_at = NOW() WHERE id = $2 AND owner_id = $3',
        [coverAssetId, id, request.user.id]);
    }
    return reply.send({ data: { ok: true } });
  });

  // DELETE /api/albums/:id
  fastify.delete('/api/albums/:id', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    await query('DELETE FROM albums WHERE id = $1 AND owner_id = $2',
      [request.params.id, request.user.id]);
    return reply.send({ data: { ok: true } });
  });

  // POST /api/albums/:id/assets — lägg till bilder
  fastify.post('/api/albums/:id/assets', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['assetIds'],
        properties: {
          assetIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { assetIds } = request.body;
    for (const assetId of assetIds) {
      await query(
        'INSERT INTO album_assets (album_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [id, assetId]
      );
    }
    await query('UPDATE albums SET updated_at = NOW() WHERE id = $1', [id]);
    return reply.send({ data: { ok: true, added: assetIds.length } });
  });

  // DELETE /api/albums/:id/assets/:assetId
  fastify.delete('/api/albums/:id/assets/:assetId', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    await query('DELETE FROM album_assets WHERE album_id = $1 AND asset_id = $2',
      [request.params.id, request.params.assetId]);
    return reply.send({ data: { ok: true } });
  });

  // GET /api/albums/:id/rules — hämta regler för ett smart-album
  fastify.get('/api/albums/:id/rules', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows: albumRows } = await query(
      'SELECT id, name, is_smart, rule_logic FROM albums WHERE id = $1 AND owner_id = $2',
      [id, request.user.id]
    );
    if (!albumRows[0]) return reply.status(404).send({ error: 'Hittades inte' });
    const { rows: rules } = await query(
      'SELECT id, rule_type, value, sort_order FROM smart_album_rules WHERE album_id = $1 ORDER BY sort_order',
      [id]
    );
    return reply.send({ data: { album: albumRows[0], rules } });
  });

  // PUT /api/albums/:id/rules — spara regler och bygg om album
  fastify.put('/api/albums/:id/rules', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          rules:     { type: 'array' },
          ruleLogic: { type: 'string', enum: ['ALL', 'ANY'] },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { rules = [], ruleLogic = 'ALL' } = request.body;
    const { rows } = await query('SELECT id FROM albums WHERE id = $1 AND owner_id = $2', [id, request.user.id]);
    if (!rows[0]) return reply.status(404).send({ error: 'Hittades inte' });

    await query('UPDATE albums SET is_smart = TRUE, rule_logic = $1, updated_at = NOW() WHERE id = $2', [ruleLogic, id]);
    await query('DELETE FROM smart_album_rules WHERE album_id = $1', [id]);
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      await query(
        'INSERT INTO smart_album_rules (album_id, rule_type, value, sort_order) VALUES ($1,$2,$3,$4)',
        [id, r.rule_type, JSON.stringify(r.value ?? {}), i]
      );
    }

    const count = await rebuildSmartAlbum(id, request.user.id, rules, ruleLogic);
    return reply.send({ data: { ok: true, assetCount: count } });
  });

  // POST /api/albums/:id/rebuild — kör om reglerna utan att ändra dem
  fastify.post('/api/albums/:id/rebuild', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await query(
      'SELECT id, rule_logic FROM albums WHERE id = $1 AND owner_id = $2 AND is_smart = TRUE',
      [id, request.user.id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Hittades inte eller inte ett smart-album' });
    const { rows: rules } = await query(
      'SELECT rule_type, value FROM smart_album_rules WHERE album_id = $1 ORDER BY sort_order',
      [id]
    );
    const count = await rebuildSmartAlbum(id, request.user.id, rules, rows[0].rule_logic);
    return reply.send({ data: { ok: true, assetCount: count } });
  });
}

// ── Smart album query builder ─────────────────────────────────────────────────

async function rebuildSmartAlbum(albumId, userId, rules, logic) {
  await query('DELETE FROM album_assets WHERE album_id = $1', [albumId]);
  if (!rules.length) return 0;

  // $1 = albumId, $2 = userId — rule params start at $3
  const params = [albumId, userId];
  const clauses = [];

  for (const rule of rules) {
    const v = rule.value ?? {};
    switch (rule.rule_type) {
      case 'date_range': {
        if (v.from) { params.push(v.from); clauses.push(`a.taken_at >= $${params.length}::timestamptz`); }
        if (v.to)   { params.push(v.to);   clauses.push(`a.taken_at < ($${params.length}::date + interval '1 day')`); }
        break;
      }
      case 'person': {
        params.push(v.personId);
        clauses.push(`EXISTS (SELECT 1 FROM faces f WHERE f.asset_id = a.id AND f.person_id = $${params.length})`);
        break;
      }
      case 'location': {
        params.push(`%${v.label ?? ''}%`);
        clauses.push(`a.location_label ILIKE $${params.length}`);
        break;
      }
      case 'mime_type': {
        params.push(`${v.type ?? 'image'}/%`);
        clauses.push(`a.mime_type LIKE $${params.length}`);
        break;
      }
      case 'has_gps':
        clauses.push(`a.location IS NOT NULL`);
        break;
      case 'is_favorite':
        clauses.push(`EXISTS (SELECT 1 FROM favorites fv WHERE fv.asset_id = a.id AND fv.user_id = $2)`);
        break;
      case 'rating':
        params.push(Number(v.min ?? 1));
        clauses.push(`a.rating >= $${params.length}`);
        break;
    }
  }

  if (!clauses.length) return 0;

  const joiner = logic === 'ANY' ? ' OR ' : ' AND ';
  const where = clauses.map((c) => `(${c})`).join(joiner);

  const { rowCount } = await query(
    `INSERT INTO album_assets (album_id, asset_id, sort_order)
     SELECT $1, a.id, ROW_NUMBER() OVER (ORDER BY a.taken_at DESC)
     FROM assets a
     WHERE a.owner_id = $2 AND a.status = 'active'
       AND (${where})
     ON CONFLICT DO NOTHING`,
    params
  );

  await query('UPDATE albums SET updated_at = NOW() WHERE id = $1', [albumId]);
  return rowCount ?? 0;
}
