import { getOnThisDay, getExploreCollections, buildEvents } from '../services/exploreService.js';
import { query } from '../db/pool.js';

export default async function exploreRoutes(fastify) {

  // GET /api/explore/collections — händelse-samlingar
  fastify.get('/api/explore/collections', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';
    const data = await getExploreCollections(userId, isAdmin);
    return reply.send({ data });
  });

  // GET /api/explore/on-this-day — "för N år sedan idag"
  fastify.get('/api/explore/on-this-day', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';
    const data = await getOnThisDay(userId, isAdmin);
    return reply.send({ data });
  });

  // GET /api/explore/collections/:id — en specifik händelse med alla bilder
  fastify.get('/api/explore/collections/:id', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows: eventRows } = await query(
      'SELECT * FROM events WHERE id = $1',
      [id]
    );
    if (!eventRows[0]) return reply.status(404).send({ error: 'Hittades inte' });

    const { rows: assets } = await query(
      `SELECT a.id, a.file_name, a.mime_type, a.taken_at,
              a.thumb_small_path, a.thumb_large_path, a.duration,
              ST_Y(a.location::geometry) AS lat,
              ST_X(a.location::geometry) AS lon
       FROM event_assets ea
       JOIN assets a ON a.id = ea.asset_id
       WHERE ea.event_id = $1 AND a.status = 'active'
       ORDER BY a.taken_at ASC`,
      [id]
    );

    return reply.send({ data: { event: eventRows[0], assets } });
  });

  // GET /api/explore/trips — resor (händelser ≥2 dagar)
  fastify.get('/api/explore/trips', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';
    const ownerFilter = isAdmin ? 'TRUE' : `e.owner_id = '${userId}'`;
    const { rows } = await query(
      `SELECT e.id, e.name, e.date_from, e.date_to, e.location_label,
              e.cover_asset_id,
              a.thumb_large_path AS cover_thumb,
              COUNT(ea.asset_id)::int AS asset_count,
              (e.date_to::date - e.date_from::date) AS duration_days
       FROM events e
       JOIN event_assets ea ON ea.event_id = e.id
       LEFT JOIN assets a ON a.id = e.cover_asset_id
       WHERE ${ownerFilter}
         AND (e.date_to::date - e.date_from::date) >= 1
       GROUP BY e.id, a.thumb_large_path
       ORDER BY e.date_from DESC
       LIMIT 20`
    );
    return reply.send({ data: rows });
  });

  // GET /api/explore/trips/:id/track — GPS-spår för en resa
  fastify.get('/api/explore/trips/:id/track', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await query(
      `SELECT ST_Y(a.location::geometry) AS lat,
              ST_X(a.location::geometry) AS lon,
              a.taken_at
       FROM assets a
       JOIN event_assets ea ON ea.asset_id = a.id
       WHERE ea.event_id = $1 AND a.location IS NOT NULL AND a.status = 'active'
       ORDER BY a.taken_at ASC`,
      [id]
    );
    return reply.send({ data: rows });
  });

  // GET /api/explore/places — topplatser grupperade på location_label
  fastify.get('/api/explore/places', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';
    const { rows } = await query(
      `SELECT a.location_label,
              COUNT(*)::int AS photo_count,
              MAX(a.taken_at) AS latest_photo,
              (SELECT a2.thumb_small_path
               FROM assets a2
               WHERE a2.location_label = a.location_label
                 AND a2.status = 'active'
                 AND a2.thumb_small_path IS NOT NULL
                 AND ($2 OR a2.owner_id = $1)
               ORDER BY RANDOM() LIMIT 1) AS cover_thumb
       FROM assets a
       WHERE a.status = 'active'
         AND a.location_label IS NOT NULL
         AND ($2 OR a.owner_id = $1)
       GROUP BY a.location_label
       ORDER BY photo_count DESC
       LIMIT 24`,
      [userId, isAdmin]
    );
    return reply.send({ data: rows });
  });

  // POST /api/explore/rebuild — trigga ombyggnad av händelse-indexet (admin)
  fastify.post('/api/explore/rebuild', {
    onRequest: [fastify.requireAdmin],
  }, async (request, reply) => {
    // Kör asynkront utan att blockera svaret
    buildEvents().catch(console.error);
    return reply.send({ data: { message: 'Händelse-indexering startad i bakgrunden' } });
  });

  // GET /api/explore/favorites — favoritbilder sorterade efter senast tillagd
  fastify.get('/api/explore/favorites', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { rows } = await query(
      `SELECT a.id, a.file_name, a.mime_type, a.taken_at,
              a.thumb_small_path, a.thumb_large_path, f.added_at,
              true AS is_favorite
       FROM favorites f
       JOIN assets a ON a.id = f.asset_id
       WHERE f.user_id = $1 AND a.status = 'active'
       ORDER BY f.added_at DESC`,
      [request.user.id]
    );
    return reply.send({ data: rows });
  });

  // POST /api/explore/favorites/:assetId — lägg till favorit
  fastify.post('/api/explore/favorites/:assetId', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    await query(
      'INSERT INTO favorites (user_id, asset_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [request.user.id, request.params.assetId]
    );
    return reply.status(201).send({ data: { ok: true } });
  });

  // DELETE /api/explore/favorites/:assetId — ta bort favorit
  fastify.delete('/api/explore/favorites/:assetId', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    await query(
      'DELETE FROM favorites WHERE user_id = $1 AND asset_id = $2',
      [request.user.id, request.params.assetId]
    );
    return reply.send({ data: { ok: true } });
  });
}
