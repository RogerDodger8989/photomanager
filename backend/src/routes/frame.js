import { randomBytes } from 'crypto';
import { query } from '../db/pool.js';

async function getFrameConfig() {
  const { rows } = await query("SELECT value FROM system_settings WHERE key = 'frame'");
  return rows[0]?.value ?? {};
}

async function setFrameConfig(patch) {
  await query(`
    INSERT INTO system_settings (key, value)
    VALUES ('frame', $1::jsonb)
    ON CONFLICT (key) DO UPDATE
      SET value = system_settings.value || $1::jsonb, updated_at = NOW()
  `, [JSON.stringify(patch)]);
  return getFrameConfig();
}

export default async function frameRoutes(fastify) {

  // GET /api/frame/config — hämta ramkonfiguration (admin)
  fastify.get('/api/frame/config', {
    onRequest: [fastify.requireAdmin],
  }, async (_request, reply) => {
    const cfg = await getFrameConfig();
    // Generera token om den saknas
    if (!cfg.token) {
      cfg.token = randomBytes(16).toString('hex');
      await setFrameConfig({ token: cfg.token });
    }
    return reply.send({ data: cfg });
  });

  // PATCH /api/frame/config — uppdatera ramkonfiguration (admin)
  fastify.patch('/api/frame/config', {
    onRequest: [fastify.requireAdmin],
    schema: {
      body: {
        type: 'object',
        properties: {
          enabled:   { type: 'boolean' },
          source:    { type: 'string', enum: ['random', 'favorites', 'album'] },
          album_id:  { type: ['string', 'null'] },
          interval:  { type: 'integer', minimum: 3, maximum: 120 },
          show_info: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const patch = {};
    const b = request.body ?? {};
    if (typeof b.enabled   === 'boolean') patch.enabled   = b.enabled;
    if (typeof b.source    === 'string')  patch.source    = b.source;
    if ('album_id'  in b)                 patch.album_id  = b.album_id ?? null;
    if (typeof b.interval  === 'number')  patch.interval  = b.interval;
    if (typeof b.show_info === 'boolean') patch.show_info = b.show_info;

    const cfg = await setFrameConfig(patch);
    return reply.send({ data: cfg });
  });

  // POST /api/frame/config/regenerate-token — generera nytt token (admin)
  fastify.post('/api/frame/config/regenerate-token', {
    onRequest: [fastify.requireAdmin],
  }, async (_request, reply) => {
    const token = randomBytes(16).toString('hex');
    const cfg = await setFrameConfig({ token });
    return reply.send({ data: cfg });
  });

  // GET /api/frame/photos?token=xxx — publik endpoint, returnerar bilder för slideshown
  fastify.get('/api/frame/photos', async (request, reply) => {
    const { token, limit = 30 } = request.query;
    const cfg = await getFrameConfig();

    if (!cfg.enabled || !cfg.token || cfg.token !== token) {
      return reply.status(403).send({ error: 'Fotoram ej aktiverad eller ogiltigt token' });
    }

    const n = Math.min(Math.max(1, parseInt(limit, 10) || 30), 100);
    let rows;

    if (cfg.source === 'favorites') {
      // Alla favoriter, slumpmässig ordning
      ({ rows } = await query(`
        SELECT a.id, a.thumb_large_path, a.taken_at, a.location_label, a.file_name,
               a.width, a.height
        FROM assets a
        JOIN favorites f ON f.asset_id = a.id
        WHERE a.status = 'active' AND a.thumb_large_path IS NOT NULL
        ORDER BY RANDOM() LIMIT $1
      `, [n]));
    } else if (cfg.source === 'album' && cfg.album_id) {
      ({ rows } = await query(`
        SELECT a.id, a.thumb_large_path, a.taken_at, a.location_label, a.file_name,
               a.width, a.height
        FROM assets a
        JOIN album_assets aa ON aa.asset_id = a.id AND aa.album_id = $2
        WHERE a.status = 'active' AND a.thumb_large_path IS NOT NULL
        ORDER BY RANDOM() LIMIT $1
      `, [n, cfg.album_id]));
    } else {
      // Slumpmässigt bland alla aktiva bilder med thumbnail
      ({ rows } = await query(`
        SELECT id, thumb_large_path, taken_at, location_label, file_name, width, height
        FROM assets
        WHERE status = 'active' AND thumb_large_path IS NOT NULL
        ORDER BY RANDOM() LIMIT $1
      `, [n]));
    }

    return reply.send({ data: rows });
  });
}
