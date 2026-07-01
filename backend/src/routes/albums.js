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
      `SELECT al.id, al.name, al.description, al.is_smart, al.album_type, al.rule_logic, al.created_at, al.updated_at,
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
          albumType:   { type: 'string', enum: ['manual', 'project'] },
        },
      },
    },
  }, async (request, reply) => {
    const { name, description, is_smart, albumType } = request.body;
    const { rows } = await query(
      'INSERT INTO albums (id, name, description, owner_id, is_smart, album_type) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [uuidv4(), name, description ?? null, request.user.id, is_smart ?? false, albumType ?? 'manual']
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
              a.rating, a.flag, a.color_label, a.width, a.height,
              a.file_size, a.indexed_at, a.is_motion_photo, a.live_video_path, a.title,
              a.stack_id, a.location_label,
              aa.sort_order,
              (SELECT COUNT(*)::int FROM assets s WHERE s.stack_id = a.stack_id AND s.status = 'active') AS stack_size,
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

  // POST /api/albums/preview-rules — räkna matchande assets utan att spara
  fastify.post('/api/albums/preview-rules', {
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
    const { rules = [], ruleLogic = 'ALL' } = request.body;
    const count = await previewSmartAlbumCount(request.user.id, rules, ruleLogic, request.user.role === 'admin');
    return reply.send({ data: { count } });
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

    const count = await rebuildSmartAlbum(id, request.user.id, rules, ruleLogic, request.user.role === 'admin');
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
    const count = await rebuildSmartAlbum(id, request.user.id, rules, rows[0].rule_logic, request.user.role === 'admin');
    return reply.send({ data: { ok: true, assetCount: count } });
  });

  // ── Projektalbum: kapitel-CRUD ────────────────────────────────────────────────

  // GET /api/albums/:id/chapters — hämta kapitel med assets
  fastify.get('/api/albums/:id/chapters', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows: album } = await query(
      'SELECT id FROM albums WHERE id = $1 AND owner_id = $2',
      [id, request.user.id]
    );
    if (!album[0]) return reply.status(404).send({ error: 'Album hittades inte' });

    const { rows: chapters } = await query(
      `SELECT pc.id, pc.title, pc.description, pc.sort_order, pc.cover_asset_id,
              a.thumb_small_path AS cover_thumb
       FROM project_chapters pc
       LEFT JOIN assets a ON a.id = pc.cover_asset_id
       WHERE pc.album_id = $1
       ORDER BY pc.sort_order, pc.created_at`,
      [id]
    );

    for (const ch of chapters) {
      const { rows: assets } = await query(
        `SELECT a.id, a.file_name, a.mime_type, a.taken_at,
                a.thumb_small_path, a.thumb_large_path, a.duration,
                a.rating, a.flag, a.color_label, a.width, a.height,
                a.file_size, a.is_motion_photo, a.live_video_path,
                ca.sort_order,
                EXISTS(SELECT 1 FROM favorites fv WHERE fv.asset_id = a.id AND fv.user_id = $2) AS is_favorite
         FROM chapter_assets ca
         JOIN assets a ON a.id = ca.asset_id AND a.status = 'active'
         WHERE ca.chapter_id = $1
         ORDER BY ca.sort_order, a.taken_at`,
        [ch.id, request.user.id]
      );
      ch.assets = assets;
    }

    return reply.send({ data: chapters });
  });

  // POST /api/albums/:id/chapters — skapa kapitel
  fastify.post('/api/albums/:id/chapters', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          title:       { type: 'string' },
          description: { type: 'string' },
          sortOrder:   { type: 'integer' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { title = 'Nytt kapitel', description, sortOrder } = request.body ?? {};

    const { rows: album } = await query(
      'SELECT id FROM albums WHERE id = $1 AND owner_id = $2',
      [id, request.user.id]
    );
    if (!album[0]) return reply.status(404).send({ error: 'Album hittades inte' });

    // Beräkna sort_order om inte angiven
    let order = sortOrder;
    if (order === undefined) {
      const { rows: cnt } = await query(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM project_chapters WHERE album_id = $1',
        [id]
      );
      order = cnt[0].next;
    }

    const { rows } = await query(
      `INSERT INTO project_chapters (album_id, title, description, sort_order)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, title, description ?? null, order]
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // PATCH /api/albums/:id/chapters/:chId — uppdatera kapitel
  fastify.patch('/api/albums/:id/chapters/:chId', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          title:        { type: 'string' },
          description:  { type: 'string' },
          sortOrder:    { type: 'integer' },
          coverAssetId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { chId } = request.params;
    const { title, description, sortOrder, coverAssetId } = request.body ?? {};

    const sets = [];
    const vals = [];
    if (title       !== undefined) { vals.push(title);       sets.push(`title = $${vals.length}`); }
    if (description !== undefined) { vals.push(description); sets.push(`description = $${vals.length}`); }
    if (sortOrder   !== undefined) { vals.push(sortOrder);   sets.push(`sort_order = $${vals.length}`); }
    if (coverAssetId !== undefined) { vals.push(coverAssetId); sets.push(`cover_asset_id = $${vals.length}`); }

    if (!sets.length) return reply.send({ data: { ok: true } });

    vals.push(chId);
    await query(`UPDATE project_chapters SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    return reply.send({ data: { ok: true } });
  });

  // DELETE /api/albums/:id/chapters/:chId
  fastify.delete('/api/albums/:id/chapters/:chId', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    await query('DELETE FROM project_chapters WHERE id = $1', [request.params.chId]);
    return reply.send({ data: { ok: true } });
  });

  // POST /api/albums/:id/chapters/:chId/assets — lägg till assets i kapitel
  fastify.post('/api/albums/:id/chapters/:chId/assets', {
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
    const { chId } = request.params;
    const { assetIds } = request.body;

    const { rows: cnt } = await query(
      'SELECT COALESCE(MAX(sort_order), -1) AS max FROM chapter_assets WHERE chapter_id = $1',
      [chId]
    );
    let order = (cnt[0].max ?? -1) + 1;

    for (const assetId of assetIds) {
      await query(
        'INSERT INTO chapter_assets (chapter_id, asset_id, sort_order) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [chId, assetId, order++]
      );
    }
    return reply.send({ data: { ok: true, added: assetIds.length } });
  });

  // DELETE /api/albums/:id/chapters/:chId/assets/:assetId
  fastify.delete('/api/albums/:id/chapters/:chId/assets/:assetId', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    await query(
      'DELETE FROM chapter_assets WHERE chapter_id = $1 AND asset_id = $2',
      [request.params.chId, request.params.assetId]
    );
    return reply.send({ data: { ok: true } });
  });

  // PUT /api/albums/:id/chapters/:chId/reorder — sätt ny ordning för assets i kapitel
  fastify.put('/api/albums/:id/chapters/:chId/reorder', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['assetIds'],
        properties: { assetIds: { type: 'array', items: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { chId } = request.params;
    const { assetIds } = request.body;
    for (let i = 0; i < assetIds.length; i++) {
      await query(
        'UPDATE chapter_assets SET sort_order = $1 WHERE chapter_id = $2 AND asset_id = $3',
        [i, chId, assetIds[i]]
      );
    }
    return reply.send({ data: { ok: true } });
  });
}

// ── Smart album query builder ─────────────────────────────────────────────────

function buildRuleClauses(rules, userId, params) {
  const clauses = [];
  for (const rule of rules) {
    const v = rule.value ?? {};
    switch (rule.rule_type) {
      case 'date_range': {
        const subClauses = [];
        if (v.from) { params.push(v.from); subClauses.push(`a.taken_at >= $${params.length}::timestamptz`); }
        if (v.to)   { params.push(v.to);   subClauses.push(`a.taken_at < ($${params.length}::date + interval '1 day')`); }
        if (subClauses.length) clauses.push(subClauses.join(' AND '));
        break;
      }
      case 'person': {
        if (!v.personId) break;
        params.push(v.personId);
        clauses.push(`EXISTS (SELECT 1 FROM faces f WHERE f.asset_id = a.id AND f.person_id = $${params.length})`);
        break;
      }
      case 'location': {
        if (!v.label) break;
        params.push(`%${v.label}%`);
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
      case 'is_favorite': {
        const uidIdx = params.indexOf(userId) + 1 || (() => { params.push(userId); return params.length; })();
        clauses.push(`EXISTS (SELECT 1 FROM favorites fv WHERE fv.asset_id = a.id AND fv.user_id = $${uidIdx})`);
        break;
      }
      case 'rating':
        params.push(Number(v.min ?? 1));
        clauses.push(`a.rating >= $${params.length}`);
        break;
    }
  }
  return clauses;
}

async function previewSmartAlbumCount(userId, rules, logic, isAdmin = false) {
  if (!rules.length) return 0;
  // isAdmin: start empty — no owner filter, so $1 must not be unused userId
  const params = isAdmin ? [] : [userId];
  const clauses = buildRuleClauses(rules, userId, params);
  if (!clauses.length) return 0;
  const joiner = logic === 'ANY' ? ' OR ' : ' AND ';
  const where = clauses.map((c) => `(${c})`).join(joiner);
  const ownerClause = isAdmin ? '' : `a.owner_id = $1 AND `;
  const { rows } = await query(
    `SELECT COUNT(*)::int AS cnt FROM assets a WHERE ${ownerClause}a.status = 'active' AND (${where})`,
    params
  );
  return rows[0]?.cnt ?? 0;
}

async function rebuildSmartAlbum(albumId, userId, rules, logic, isAdmin = false) {
  await query('DELETE FROM album_assets WHERE album_id = $1', [albumId]);
  if (!rules.length) return 0;

  const params = isAdmin ? [albumId] : [albumId, userId];
  const clauses = buildRuleClauses(rules, userId, params);
  if (!clauses.length) return 0;

  const joiner = logic === 'ANY' ? ' OR ' : ' AND ';
  const where = clauses.map((c) => `(${c})`).join(joiner);
  const ownerClause = isAdmin ? '' : `a.owner_id = $2 AND `;

  const { rowCount } = await query(
    `INSERT INTO album_assets (album_id, asset_id, sort_order)
     SELECT $1, a.id, ROW_NUMBER() OVER (ORDER BY a.taken_at DESC)
     FROM assets a
     WHERE ${ownerClause}a.status = 'active'
       AND (${where})
     ON CONFLICT DO NOTHING`,
    params
  );

  await query('UPDATE albums SET updated_at = NOW() WHERE id = $1', [albumId]);
  return rowCount ?? 0;
}
