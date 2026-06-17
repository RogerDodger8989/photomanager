import webpush from 'web-push';
import { query } from '../db/pool.js';
import { config } from '../config.js';

// Konfigurera VAPID om nycklar finns
let pushEnabled = false;
if (config.vapid?.publicKey && config.vapid?.privateKey) {
  webpush.setVapidDetails(
    `mailto:${config.vapid.email ?? 'admin@photomanager.local'}`,
    config.vapid.publicKey,
    config.vapid.privateKey
  );
  pushEnabled = true;
}

// Hjälpfunktion som anropas från andra services
export async function sendPushToUser(userId, payload) {
  if (!pushEnabled) return;
  const { rows } = await query(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [userId]
  );
  for (const sub of rows) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
    } catch (err) {
      // Prenumeration ogiltig — ta bort den
      if (err.statusCode === 410) {
        await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
      }
    }
  }
}

export default async function pushRoutes(fastify) {

  // GET /api/push/vapid-public-key — frontend behöver den för att prenumerera
  fastify.get('/api/push/vapid-public-key', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    if (!pushEnabled) return reply.send({ data: { enabled: false } });
    return reply.send({ data: { enabled: true, publicKey: config.vapid.publicKey } });
  });

  // POST /api/push/subscribe — spara push-prenumeration
  fastify.post('/api/push/subscribe', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['endpoint', 'keys'],
        properties: {
          endpoint: { type: 'string' },
          keys: {
            type: 'object',
            required: ['p256dh', 'auth'],
            properties: {
              p256dh: { type: 'string' },
              auth:   { type: 'string' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!pushEnabled) return reply.status(503).send({ error: 'Push ej konfigurerat' });

    const { endpoint, keys } = request.body;
    const userId = request.user.id;

    await query(`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4
    `, [userId, endpoint, keys.p256dh, keys.auth]);

    return reply.status(201).send({ data: { ok: true } });
  });

  // DELETE /api/push/subscribe — avregistrera
  fastify.delete('/api/push/subscribe', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { endpoint } = request.body ?? {};
    if (endpoint) {
      await query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2',
        [endpoint, request.user.id]);
    }
    return reply.status(204).send();
  });

}
