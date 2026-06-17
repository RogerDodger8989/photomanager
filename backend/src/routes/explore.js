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
              a.thumb_small_path, a.thumb_large_path, f.added_at
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
