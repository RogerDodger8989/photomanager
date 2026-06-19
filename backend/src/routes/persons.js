import path from 'path';
import sharp from 'sharp';
import { query } from '../db/pool.js';
import { syncFacesToFile } from '../services/xmpService.js';
import { config } from '../config.js';

export default async function personsRoutes(fastify) {

  // GET /api/persons — alla namngivna personer
  fastify.get('/api/persons', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { rows } = await query(
      `SELECT
         p.id, p.name, p.birth_year, p.death_year, p.cover_face_id, p.created_at,
         a.thumb_small_path AS cover_thumb,
         (SELECT f3.id
          FROM faces f3
          JOIN assets a3 ON a3.id = f3.asset_id AND a3.status = 'active'
          WHERE f3.person_id = p.id
          LIMIT 1) AS fallback_face_id,
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

  // GET /api/faces/:faceId/thumb — beskuren ansiktsbild för valfritt face-id (ingen auth)
  fastify.get('/api/faces/:faceId/thumb', async (request, reply) => {
    const { faceId } = request.params;
    const { rows } = await query(
      `SELECT f.region_x, f.region_y, f.region_w, f.region_h,
              a.file_path, a.width, a.height
       FROM faces f
       JOIN assets a ON a.id = f.asset_id
       WHERE f.id = $1`,
      [faceId]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Ansikt hittades inte' });

    const { region_x, region_y, region_w, region_h, file_path, width, height } = rows[0];
    const fullPath = path.join(config.media.photosPath, file_path);

    // Face coords are stored in display space (after orientation correction).
    // Use display dims: for 90°/270° EXIF rotations (5-8), w/h are swapped.
    const sharpMeta = await sharp(fullPath).metadata();
    const orientation = sharpMeta.orientation ?? 1;
    const isRotated90 = orientation >= 5 && orientation <= 8;
    const dispW = isRotated90 ? (height ?? sharpMeta.height ?? 1000) : (width ?? sharpMeta.width ?? 1000);
    const dispH = isRotated90 ? (width  ?? sharpMeta.width  ?? 1000) : (height ?? sharpMeta.height ?? 1000);

    const left  = Math.max(0, Math.round(region_x * dispW));
    const top   = Math.max(0, Math.round(region_y * dispH));
    const cropW = Math.max(1, Math.round(region_w * dispW));
    const cropH = Math.max(1, Math.round(region_h * dispH));

    reply.header('Content-Type', 'image/webp');
    reply.header('Cache-Control', 'public, max-age=86400');

    const imgBuf = await sharp(fullPath)
      .rotate()
      .extract({ left, top, width: cropW, height: cropH })
      .resize(200, 200, { fit: 'cover' })
      .webp({ quality: 85 })
      .toBuffer();

    return reply.send(imgBuf);
  });

  // GET /api/persons/:id/face-thumb — beskuren ansiktsbild (ingen auth)
  fastify.get('/api/persons/:id/face-thumb', async (request, reply) => {
    const { id } = request.params;
    const { rows } = await query(
      `SELECT f.region_x, f.region_y, f.region_w, f.region_h,
              a.file_path, a.width, a.height
       FROM persons p
       JOIN faces f ON f.id = p.cover_face_id
       JOIN assets a ON a.id = f.asset_id
       WHERE p.id = $1`,
      [id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Ingen profilbild satt' });

    const { region_x, region_y, region_w, region_h, file_path, width, height } = rows[0];
    const fullPath = path.join(config.media.photosPath, file_path);

    const sharpMeta = await sharp(fullPath).metadata();
    const orientation = sharpMeta.orientation ?? 1;
    const isRotated90 = orientation >= 5 && orientation <= 8;
    const dispW = isRotated90 ? (height ?? sharpMeta.height ?? 1000) : (width ?? sharpMeta.width ?? 1000);
    const dispH = isRotated90 ? (width  ?? sharpMeta.width  ?? 1000) : (height ?? sharpMeta.height ?? 1000);

    const left  = Math.max(0, Math.round(region_x * dispW));
    const top   = Math.max(0, Math.round(region_y * dispH));
    const cropW = Math.max(1, Math.round(region_w * dispW));
    const cropH = Math.max(1, Math.round(region_h * dispH));

    reply.header('Content-Type', 'image/webp');
    reply.header('Cache-Control', 'public, max-age=86400');

    const imgBuf = await sharp(fullPath)
      .rotate()
      .extract({ left, top, width: cropW, height: cropH })
      .resize(200, 200, { fit: 'cover' })
      .webp({ quality: 85 })
      .toBuffer();

    return reply.send(imgBuf);
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
      `SELECT p.id, p.name, p.birth_year, p.death_year, p.cover_face_id, p.created_at,
              (SELECT f.id FROM faces f JOIN assets a ON a.id = f.asset_id AND a.status = 'active'
               WHERE f.person_id = p.id LIMIT 1) AS fallback_face_id
       FROM persons p WHERE p.id = $1`,
      [id]
    );
    if (!personRows[0]) return reply.status(404).send({ error: 'Person hittades inte' });

    const params = [id, limit + 1];
    const cursorCondition = cursor ? `AND a.taken_at < $${params.push(cursor)}` : '';

    const { rows: assets } = await query(
      `SELECT DISTINCT a.id, a.file_name, a.mime_type,
              a.taken_at, a.thumb_small_path, a.thumb_large_path,
              a.location_label,
              ST_Y(a.location::geometry) AS lat,
              ST_X(a.location::geometry) AS lon,
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

  // PATCH /api/persons/:id — uppdatera namn, födelseår, dödsdatum, omslag
  fastify.patch('/api/persons/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          name:        { type: 'string', minLength: 1 },
          birthYear:   { type: ['integer', 'null'] },
          deathYear:   { type: ['integer', 'null'] },
          coverFaceId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { name, birthYear, deathYear, coverFaceId } = request.body;
    if (name !== undefined) {
      await query('UPDATE persons SET name = $1 WHERE id = $2', [name, id]);
    }
    if (birthYear !== undefined) {
      await query('UPDATE persons SET birth_year = $1 WHERE id = $2', [birthYear ?? null, id]);
    }
    if (deathYear !== undefined) {
      await query('UPDATE persons SET death_year = $1 WHERE id = $2', [deathYear ?? null, id]);
    }
    if (coverFaceId !== undefined) {
      await query('UPDATE persons SET cover_face_id = $1 WHERE id = $2', [coverFaceId, id]);
    }
    return reply.send({ data: { ok: true } });
  });

  // POST /api/persons/:id/merge/:targetId — slå ihop två personer (bakåtkompatibel)
  fastify.post('/api/persons/:id/merge/:targetId', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id, targetId } = request.params;
    await query('UPDATE faces SET person_id = $1 WHERE person_id = $2', [id, targetId]);
    await query('DELETE FROM persons WHERE id = $1', [targetId]);
    return reply.send({ data: { ok: true } });
  });

  // POST /api/persons/merge — slå ihop flera personer till en
  fastify.post('/api/persons/merge', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['personIds', 'keepId'],
        properties: {
          personIds: { type: 'array', items: { type: 'string' }, minItems: 2 },
          keepId:    { type: 'string' },
          newName:   { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { personIds, keepId, newName } = request.body;
    if (!personIds.includes(keepId)) {
      return reply.status(400).send({ error: 'keepId måste vara med i personIds' });
    }
    const removeIds = personIds.filter((id) => id !== keepId);
    for (const rid of removeIds) {
      await query('UPDATE faces SET person_id = $1 WHERE person_id = $2', [keepId, rid]);
      await query('DELETE FROM persons WHERE id = $1', [rid]);
    }
    if (newName?.trim()) {
      await query('UPDATE persons SET name = $1 WHERE id = $2', [newName.trim(), keepId]);
    }
    return reply.send({ data: { ok: true, keepId } });
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
              p.name AS person_name, p.birth_year
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
          personId:   { type: 'string' },
          personName: { type: 'string' },
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
