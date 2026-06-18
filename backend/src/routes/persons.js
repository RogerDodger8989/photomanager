import { query } from '../db/pool.js';
import { syncFacesToFile } from '../services/xmpService.js';

export default async function personsRoutes(fastify) {

  // GET /api/persons — alla namngivna personer
  fastify.get('/api/persons', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { rows } = await query(
      `SELECT
         p.id, p.name, p.created_at,
         a.thumb_small_path AS cover_thumb,
         COUNT(DISTINCT f.asset_id)::int AS photo_count
       FROM persons p
       LEFT JOIN faces f ON f.person_id = p.id
       LEFT JOIN assets fa ON fa.id = f.asset_id AND fa.status = 'active'
       LEFT JOIN faces cf ON cf.id = p.cover_face_id
       LEFT JOIN assets a ON a.id = cf.asset_id
       GROUP BY p.id, a.thumb_small_path
       ORDER BY COUNT(DISTINCT f.asset_id) DESC`
    );
    return reply.send({ data: rows });
  });

  // GET /api/persons/:id — person med bilder
  fastify.get('/api/persons/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit:  { type: 'integer', default: 50 },
          cursor: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { limit = 50, cursor } = request.query;

    const { rows: personRows } = await query(
      'SELECT * FROM persons WHERE id = $1',
      [id]
    );
    if (!personRows[0]) return reply.status(404).send({ error: 'Person hittades inte' });

    const params = [id, limit + 1];
    const cursorCondition = cursor ? `AND a.taken_at < $${params.push(cursor)}` : '';

    const { rows: assets } = await query(
      `SELECT DISTINCT a.id, a.file_name, a.mime_type,
              a.taken_at, a.thumb_small_path, a.thumb_large_path,
              f.region_x, f.region_y, f.region_w, f.region_h
       FROM faces f
       JOIN assets a ON a.id = f.asset_id
       WHERE f.person_id = $1 AND a.status = 'active' ${cursorCondition}
       ORDER BY a.taken_at DESC NULLS LAST
       LIMIT $2`,
      params
    );

    const hasMore = assets.length > limit;
    const items = hasMore ? assets.slice(0, limit) : assets;

    return reply.send({
      data: { person: personRows[0], assets: items },
      meta: { hasMore, nextCursor: hasMore ? items[items.length - 1].taken_at : null },
    });
  });

  // PATCH /api/persons/:id — byt namn
  fastify.patch('/api/persons/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name:         { type: 'string', minLength: 1 },
          coverFaceId:  { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { name, coverFaceId } = request.body;
    await query('UPDATE persons SET name = $1 WHERE id = $2', [name, id]);
    if (coverFaceId) {
      await query('UPDATE persons SET cover_face_id = $1 WHERE id = $2', [coverFaceId, id]);
    }
    return reply.send({ data: { ok: true } });
  });

  // POST /api/persons/:id/merge/:targetId — slå ihop två personer
  fastify.post('/api/persons/:id/merge/:targetId', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id, targetId } = request.params;
    // Flytta alla ansikten från targetId → id
    await query('UPDATE faces SET person_id = $1 WHERE person_id = $2', [id, targetId]);
    await query('DELETE FROM persons WHERE id = $1', [targetId]);
    return reply.send({ data: { ok: true } });
  });

  // POST /api/faces — skapa ny ansiktsregion (manuell taggning)
  fastify.post('/api/faces', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['assetId', 'regionX', 'regionY', 'regionW', 'regionH'],
        properties: {
          assetId:    { type: 'string' },
          personId:   { type: 'string' },
          personName: { type: 'string' },
          regionX:    { type: 'number' },
          regionY:    { type: 'number' },
          regionW:    { type: 'number' },
          regionH:    { type: 'number' },
        },
      },
    },
  }, async (request, reply) => {
    const { assetId, personId: pid, personName, regionX, regionY, regionW, regionH } = request.body;

    let personId = pid ?? null;
    if (!personId && personName?.trim()) {
      const existing = await query('SELECT id FROM persons WHERE name = $1', [personName.trim()]);
      if (existing.rows[0]) {
        personId = existing.rows[0].id;
      } else {
        const ins = await query('INSERT INTO persons (name) VALUES ($1) RETURNING id', [personName.trim()]);
        personId = ins.rows[0].id;
      }
    }

    const { rows } = await query(
      `INSERT INTO faces (asset_id, person_id, source, region_x, region_y, region_w, region_h)
       VALUES ($1, $2, 'manual', $3, $4, $5, $6) RETURNING id`,
      [assetId, personId, regionX, regionY, regionW, regionH]
    );

    const { rows: personRows } = personId
      ? await query('SELECT id, name FROM persons WHERE id = $1', [personId])
      : { rows: [null] };

    syncFacesToFile(assetId).catch(() => {});

    return reply.status(201).send({ data: {
      faceId: rows[0].id, personId, personName: personRows[0]?.name ?? null,
      regionX, regionY, regionW, regionH,
    }});
  });

  // DELETE /api/faces/:id — ta bort ansiktsregion
  fastify.delete('/api/faces/:id', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { rows } = await query(
      'DELETE FROM faces WHERE id = $1 RETURNING id, asset_id, person_id, source, region_x, region_y, region_w, region_h',
      [request.params.id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Ansikt hittades inte' });
    syncFacesToFile(rows[0].asset_id).catch(() => {});
    return reply.send({ data: rows[0] });
  });

  // GET /api/faces/:assetId — hämta alla ansiktsregioner för en bild
  fastify.get('/api/faces/:assetId', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { rows } = await query(
      `SELECT f.id, f.person_id, f.source,
              f.region_x, f.region_y, f.region_w, f.region_h,
              p.name AS person_name
       FROM faces f
       LEFT JOIN persons p ON p.id = f.person_id
       WHERE f.asset_id = $1`,
      [request.params.assetId]
    );
    return reply.send({ data: rows });
  });

  // PATCH /api/faces/:id — tilldela ett ansikte till en person
  fastify.patch('/api/faces/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          personId: { type: 'string' },  // null = okänd
          personName: { type: 'string' }, // skapa ny person om personId saknas
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    let { personId, personName } = request.body;

    if (!personId && personName) {
      const { rows } = await query(
        `INSERT INTO persons (name) VALUES ($1)
         ON CONFLICT DO NOTHING RETURNING id`,
        [personName.trim()]
      );
      personId = rows[0]?.id;
      if (!personId) {
        const { rows: ex } = await query('SELECT id FROM persons WHERE name = $1', [personName.trim()]);
        personId = ex[0]?.id;
      }
    }

    await query('UPDATE faces SET person_id = $1 WHERE id = $2', [personId ?? null, id]);
    const { rows: faceAsset } = await query('SELECT asset_id FROM faces WHERE id = $1', [id]);
    if (faceAsset[0]) syncFacesToFile(faceAsset[0].asset_id).catch(() => {});
    return reply.send({ data: { ok: true, personId } });
  });
}
