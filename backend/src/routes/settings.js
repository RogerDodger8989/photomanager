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
        thumb_overlay_items:      ['rating', 'flag', 'color_border'],
        thumb_overlay_position:   'hover',
        color_labels:             { '1': 'Röd', '2': 'Gul', '3': 'Grön', '4': 'Blå', '5': 'Lila' },
        navigation_state:         {},
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
          faceDetectionEnabled:    { type: 'boolean' },
          defaultExportOnlyLeaf:   { type: 'boolean' },
          defaultShowLifespan:     { type: 'boolean' },
          defaultExportSynonyms:   { type: 'boolean' },
          thumbOverlayItems:       { type: 'array', items: { type: 'string' } },
          thumbOverlayPosition:    { type: 'string', enum: ['hover', 'always'] },
          colorLabels:             { type: 'object' },
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
    if (Array.isArray(body.thumbOverlayItems)) {
      patch.thumb_overlay_items = body.thumbOverlayItems;
    }
    if (body.thumbOverlayPosition) {
      patch.thumb_overlay_position = body.thumbOverlayPosition;
    }
    if (body.colorLabels && typeof body.colorLabels === 'object') {
      patch.color_labels = body.colorLabels;
    }
    if (body.navigationState && typeof body.navigationState === 'object') {
      patch.navigation_state = body.navigationState;
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
        thumb_overlay_items:      ['rating', 'flag', 'color_border'],
        thumb_overlay_position:   'hover',
        color_labels: { '1': 'Röd', '2': 'Gul', '3': 'Grön', '4': 'Blå', '5': 'Lila' },
        ...settings,
      },
    });
  });
}
