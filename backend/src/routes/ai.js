import { query } from '../db/pool.js';
import { isAiAvailable } from '../services/aiService.js';

export default async function aiRoutes(fastify) {

  // GET /api/ai/status — är AI-funktionen tillgänglig?
  fastify.get('/api/ai/status', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    return reply.send({ data: { available: isAiAvailable() } });
  });

  // GET /api/ai/suggestions — ogransade AI-förslag (admin eller egna)
  fastify.get('/api/ai/suggestions', {
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
    const { limit = 50, offset = 0 } = request.query;
    const isAdmin = request.user.role === 'admin';

    const ownerFilter = isAdmin
      ? ''
      : `AND a.owner_id = '${request.user.id}'`;

    const { rows } = await query(
      `SELECT
         s.face_id, s.person_id, s.confidence, s.created_at,
         p.name AS suggested_person_name,
         f.region_x, f.region_y, f.region_w, f.region_h,
         f.source AS face_source,
         a.id AS asset_id, a.file_name, a.thumb_small_path, a.thumb_large_path
       FROM ai_suggestions s
       JOIN faces f     ON f.id = s.face_id
       JOIN assets a    ON a.id = f.asset_id AND a.status = 'active'
       JOIN persons p   ON p.id = s.person_id
       WHERE s.reviewed = false ${ownerFilter}
       ORDER BY s.confidence DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total
       FROM ai_suggestions s
       JOIN faces f ON f.id = s.face_id
       JOIN assets a ON a.id = f.asset_id
       WHERE s.reviewed = false ${ownerFilter}`
    );

    return reply.send({ data: rows, meta: { total: countRows[0].total } });
  });

  // POST /api/ai/suggestions/:faceId/accept — bekräfta AI-förslag
  fastify.post('/api/ai/suggestions/:faceId/accept', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { faceId } = request.params;

    // Hämta förslaget
    const { rows } = await query(
      'SELECT * FROM ai_suggestions WHERE face_id = $1',
      [faceId]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Förslag hittades inte' });

    const suggestion = rows[0];

    // Koppla ansiktet till personen
    await query(
      'UPDATE faces SET person_id = $1 WHERE id = $2',
      [suggestion.person_id, faceId]
    );

    // Markera som granskat och accepterat
    await query(
      'UPDATE ai_suggestions SET reviewed = true, accepted = true WHERE face_id = $1',
      [faceId]
    );

    return reply.send({ data: { ok: true, personId: suggestion.person_id } });
  });

  // POST /api/ai/suggestions/:faceId/reject — avvisa förslag (+ ev. tilldela annan person)
  fastify.post('/api/ai/suggestions/:faceId/reject', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          correctPersonId:   { type: 'string' },  // tilldelad rätt person om känd
          correctPersonName: { type: 'string' },  // skapa ny person om ID saknas
        },
      },
    },
  }, async (request, reply) => {
    const { faceId } = request.params;
    const { correctPersonId, correctPersonName } = request.body ?? {};

    await query(
      'UPDATE ai_suggestions SET reviewed = true, accepted = false WHERE face_id = $1',
      [faceId]
    );

    // Om korrekt person angavs, tilldela direkt
    if (correctPersonId) {
      await query('UPDATE faces SET person_id = $1 WHERE id = $2', [correctPersonId, faceId]);
    } else if (correctPersonName) {
      let personId;
      const { rows } = await query(
        `INSERT INTO persons (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id`,
        [correctPersonName.trim()]
      );
      personId = rows[0]?.id;
      if (!personId) {
        const { rows: ex } = await query('SELECT id FROM persons WHERE name = $1', [correctPersonName.trim()]);
        personId = ex[0]?.id;
      }
      if (personId) {
        await query('UPDATE faces SET person_id = $1 WHERE id = $2', [personId, faceId]);
      }
    }

    return reply.send({ data: { ok: true } });
  });

  // POST /api/ai/suggestions/batch-accept — godkänn flera förslag på en gång
  fastify.post('/api/ai/suggestions/batch-accept', {
    onRequest: [fastify.requireAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['faceIds'],
        properties: {
          faceIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const { faceIds } = request.body;
    let accepted = 0;

    for (const faceId of faceIds) {
      const { rows } = await query(
        'SELECT person_id FROM ai_suggestions WHERE face_id = $1 AND reviewed = false',
        [faceId]
      );
      if (!rows[0]) continue;
      await query('UPDATE faces SET person_id = $1 WHERE id = $2', [rows[0].person_id, faceId]);
      await query('UPDATE ai_suggestions SET reviewed = true, accepted = true WHERE face_id = $1', [faceId]);
      accepted++;
    }

    return reply.send({ data: { accepted } });
  });

  // POST /api/ai/reindex/:assetId — kör om AI-analys för en specifik bild
  // Kräver inloggning; admins kan köra för alla, användare bara sina egna bilder.
  fastify.post('/api/ai/reindex/:assetId', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    if (!isAiAvailable()) {
      return reply.status(503).send({ error: 'AI-ansiktsigenkänning är inte aktiv — InsightFace-tjänsten körs inte.' });
    }

    const { assetId } = request.params;
    const isAdmin = request.user.role === 'admin';
    const ownerFilter = isAdmin ? '' : `AND owner_id = '${request.user.id}'`;

    const { rows } = await query(
      `SELECT file_path FROM assets WHERE id = $1 AND status = 'active' ${ownerFilter}`,
      [assetId]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Bilden hittades inte' });

    // Rensa gamla AI-faces och förslag så att analysen börjar om från noll
    await query(
      `DELETE FROM ai_suggestions WHERE face_id IN (SELECT id FROM faces WHERE asset_id = $1 AND source = 'ai')`,
      [assetId]
    );
    await query(
      `DELETE FROM faces WHERE asset_id = $1 AND source = 'ai'`,
      [assetId]
    );

    // Kör asynkront — svarar direkt till klienten
    const { processAssetFaces } = await import('../services/aiService.js');
    const { config } = await import('../config.js');
    const { resolve } = await import('path');
    processAssetFaces(assetId, resolve(config.media.photosPath, rows[0].file_path))
      .catch((err) => console.error(`AI reindex misslyckades för ${assetId}:`, err));

    return reply.send({ data: { message: 'AI-analys startad i bakgrunden' } });
  });
}
