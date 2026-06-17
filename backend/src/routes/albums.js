import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/pool.js';

export default async function albumsRoutes(fastify) {

  // GET /api/albums
  fastify.get('/api/albums', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { rows } = await query(
      `SELECT al.id, al.name, al.description, al.created_at, al.updated_at,
              al.cover_asset_id, a.thumb_small_path AS cover_thumb,
              COUNT(aa.asset_id)::int AS asset_count
       FROM albums al
       LEFT JOIN album_assets aa ON aa.album_id = al.id
       LEFT JOIN assets a ON a.id = al.cover_asset_id
       WHERE al.owner_id = $1
       GROUP BY al.id, a.thumb_small_path
       ORDER BY al.updated_at DESC`,
      [request.user.id]
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
        },
      },
    },
  }, async (request, reply) => {
    const { name, description } = request.body;
    const { rows } = await query(
      'INSERT INTO albums (id, name, description, owner_id) VALUES ($1,$2,$3,$4) RETURNING *',
      [uuidv4(), name, description ?? null, request.user.id]
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
              aa.sort_order
       FROM album_assets aa
       JOIN assets a ON a.id = aa.asset_id AND a.status = 'active'
       WHERE aa.album_id = $1
       ORDER BY aa.sort_order, a.taken_at
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
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
      await query('UPDATE albums SET description = $1, updated_at = NOW() WHERE id = $2',
        [description, id]);
    }
    if (coverAssetId !== undefined) {
      await query('UPDATE albums SET cover_asset_id = $1, updated_at = NOW() WHERE id = $2',
        [coverAssetId, id]);
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
}
