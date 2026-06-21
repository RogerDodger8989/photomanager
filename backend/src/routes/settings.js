import { query } from '../db/pool.js';

export default async function settingsRoutes(fastify) {

  // GET /api/settings — hämta inställningar för inloggad användare
  fastify.get('/api/settings', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const userId = request.user.id;
    const { rows } = await query(
      'SELECT settings FROM user_settings WHERE user_id = $1',
      [userId]
    );
    const settings = rows[0]?.settings ?? {};
    // Returnera med defaults för inställningar som saknas
    return reply.send({
      data: {
        face_detection_enabled:   true,
        face_quality_threshold:   0.5,
        default_export_only_leaf: true,
        default_show_lifespan:    true,
        default_export_synonyms:  true,
        ...settings,
      },
    });
  });

  // PATCH /api/settings — uppdatera inställningar (merge med befintliga)
  fastify.patch('/api/settings', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          faceDetectionEnabled:      { type: 'boolean' },
          defaultExportOnlyLeaf:     { type: 'boolean' },
          defaultShowLifespan:       { type: 'boolean' },
          defaultExportSynonyms:     { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.user.id;
    const body = request.body ?? {};

    const patch = {};
    if (typeof body.faceDetectionEnabled === 'boolean') {
      patch.face_detection_enabled = body.faceDetectionEnabled;
    }
    if (typeof body.faceQualityThreshold === 'number') {
      patch.face_quality_threshold = Math.max(0, Math.min(1, body.faceQualityThreshold));
    }
    if (typeof body.defaultExportOnlyLeaf === 'boolean') {
      patch.default_export_only_leaf = body.defaultExportOnlyLeaf;
    }
    if (typeof body.defaultShowLifespan === 'boolean') {
      patch.default_show_lifespan = body.defaultShowLifespan;
    }
    if (typeof body.defaultExportSynonyms === 'boolean') {
      patch.default_export_synonyms = body.defaultExportSynonyms;
    }

    if (Object.keys(patch).length === 0) {
      return reply.status(400).send({ error: 'Inga giltiga inställningar angavs' });
    }

    await query(
      `INSERT INTO user_settings (user_id, settings)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id) DO UPDATE
         SET settings = user_settings.settings || $2::jsonb`,
      [userId, JSON.stringify(patch)]
    );

    const { rows } = await query(
      'SELECT settings FROM user_settings WHERE user_id = $1',
      [userId]
    );
    const settings = rows[0]?.settings ?? {};
    return reply.send({
      data: {
        face_detection_enabled:   true,
        face_quality_threshold:   0.5,
        default_export_only_leaf: true,
        default_show_lifespan:    true,
        default_export_synonyms:  true,
        ...settings,
      },
    });
  });
}
