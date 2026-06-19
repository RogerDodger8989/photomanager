import { query } from '../db/pool.js';
import { getJobStats } from '../services/jobService.js';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

export default async function adminRoutes(fastify) {

  // Alla admin-routes kräver admin-roll
  fastify.addHook('onRequest', fastify.requireAdmin);

  // GET /api/admin/jobs — jobbkö-status
  fastify.get('/api/admin/jobs', async (request, reply) => {
    const stats = await getJobStats();

    const { rows: recent } = await query(
      `SELECT j.id, j.job_type, j.status, j.attempts, j.error_msg,
              j.created_at, j.started_at, j.finished_at,
              a.file_name
       FROM jobs j
       LEFT JOIN assets a ON a.id = j.asset_id
       ORDER BY j.created_at DESC
       LIMIT 100`
    );

    return reply.send({ data: { stats, recent } });
  });

  // POST /api/admin/jobs/:id/retry — återkö ett misslyckat jobb
  fastify.post('/api/admin/jobs/:id/retry', async (request, reply) => {
    const { id } = request.params;
    await query(
      "UPDATE jobs SET status = 'pending', attempts = 0, error_msg = NULL, started_at = NULL, finished_at = NULL WHERE id = $1 AND status = 'failed'",
      [id]
    );
    return reply.send({ data: { ok: true } });
  });

  // POST /api/admin/requeue-thumbnails — köa om alla bilder utan thumbnail
  fastify.post('/api/admin/requeue-thumbnails', async (request, reply) => {
    const { rows } = await query(
      `SELECT id FROM assets WHERE thumb_small_path IS NULL AND status = 'active'
       AND mime_type LIKE 'image/%'`
    );
    for (const row of rows) {
      await query(
        `INSERT INTO jobs (job_type, asset_id) VALUES ('thumbnail', $1)
         ON CONFLICT DO NOTHING`,
        [row.id]
      );
    }
    return reply.send({ data: { queued: rows.length } });
  });

  // GET /api/admin/duplicates — lista duplikat
  fastify.get('/api/admin/duplicates', async (request, reply) => {
    const { rows } = await query(
      `SELECT file_hash, COUNT(*)::int AS count,
              json_agg(json_build_object(
                'id', id, 'file_path', file_path,
                'file_size', file_size, 'taken_at', taken_at,
                'thumb_small_path', thumb_small_path
              ) ORDER BY indexed_at) AS assets
       FROM assets
       WHERE file_hash IS NOT NULL AND status = 'active'
       GROUP BY file_hash
       HAVING COUNT(*) > 1
       ORDER BY count DESC`
    );
    return reply.send({ data: rows });
  });

  // GET /api/admin/users — lista alla användare
  fastify.get('/api/admin/users', async (request, reply) => {
    const { rows } = await query(
      `SELECT u.id, u.username, u.email, u.role, u.is_active,
              u.created_at, u.last_login,
              COALESCE(
                json_object_agg(up.permission_key, up.value)
                FILTER (WHERE up.permission_key IS NOT NULL),
                '{}'::json
              ) AS permissions
       FROM users u
       LEFT JOIN user_permissions up ON up.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at ASC`
    );
    return reply.send({ data: rows });
  });

  // POST /api/admin/users — skapa ny användare
  fastify.post('/api/admin/users', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password', 'role'],
        properties: {
          username: { type: 'string', minLength: 2 },
          email:    { type: 'string' },
          password: { type: 'string', minLength: 8 },
          role:     { type: 'string', enum: ['admin', 'user', 'guest'] },
        },
      },
    },
  }, async (request, reply) => {
    const { username, email, password, role } = request.body;
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      `INSERT INTO users (id, username, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, role, created_at`,
      [uuidv4(), username, email ?? null, hash, role]
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // PATCH /api/admin/users/:id — uppdatera användare
  fastify.patch('/api/admin/users/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          email:     { type: 'string' },
          role:      { type: 'string', enum: ['admin', 'user', 'guest'] },
          is_active: { type: 'boolean' },
          password:  { type: 'string', minLength: 8 },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { email, role, is_active, password } = request.body;

    if (email !== undefined) {
      await query('UPDATE users SET email = $1 WHERE id = $2', [email, id]);
    }
    if (role !== undefined) {
      await query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
    }
    if (is_active !== undefined) {
      await query('UPDATE users SET is_active = $1 WHERE id = $2', [is_active, id]);
    }
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]);
    }

    return reply.send({ data: { ok: true } });
  });

  // PUT /api/admin/users/:id/permissions — sätt rättighetskarta för en användare
  fastify.put('/api/admin/users/:id/permissions', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: { type: 'boolean' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const perms = request.body;

    // Ersätt alla permissions för användaren
    await query('DELETE FROM user_permissions WHERE user_id = $1', [id]);

    for (const [key, value] of Object.entries(perms)) {
      await query(
        `INSERT INTO user_permissions (user_id, permission_key, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, permission_key) DO UPDATE SET value = EXCLUDED.value`,
        [id, key, value]
      );
    }

    return reply.send({ data: { ok: true } });
  });

  // GET /api/admin/audit-log — granskningslogg
  fastify.get('/api/admin/audit-log', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          userId:   { type: 'string' },
          action:   { type: 'string' },
          dateFrom: { type: 'string' },
          dateTo:   { type: 'string' },
          limit:    { type: 'integer', default: 100, maximum: 500 },
          offset:   { type: 'integer', default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const { userId, action, dateFrom, dateTo, limit = 100, offset = 0 } = request.query;

    const conditions = [];
    const params = [];

    if (userId) conditions.push(`al.user_id = $${params.push(userId)}`);
    if (action) conditions.push(`al.action = $${params.push(action)}`);
    if (dateFrom) conditions.push(`al.created_at >= $${params.push(dateFrom)}`);
    if (dateTo)   conditions.push(`al.created_at <= $${params.push(dateTo)}`);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit, offset);
    const { rows } = await query(
      `SELECT al.*, u.username
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.user_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`,
      params
    );

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total FROM audit_log al ${where}`,
      params.slice(0, -2)
    );

    return reply.send({ data: rows, meta: { total: countRows[0].total } });
  });

  // GET /api/admin/audit-log/csv — ladda ner hela loggen som CSV
  fastify.get('/api/admin/audit-log/csv', async (request, reply) => {
    const { rows } = await query(
      `SELECT al.created_at, u.username, al.action, al.target_id, al.ip_address, al.user_agent
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.user_id
       ORDER BY al.created_at DESC
       LIMIT 50000`
    );

    const header = 'timestamp,username,action,target_id,ip_address,user_agent\n';
    const csvRow = (r) => [
      r.created_at?.toISOString() ?? '',
      r.username ?? '',
      r.action ?? '',
      r.target_id ?? '',
      r.ip_address ?? '',
      `"${(r.user_agent ?? '').replace(/"/g, '""')}"`,
    ].join(',');

    const csv = header + rows.map(csvRow).join('\n');

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="audit-log-${Date.now()}.csv"`);
    return reply.send(csv);
  });

  // GET /api/admin/stats — systemoversikt
  fastify.get('/api/admin/stats', async (request, reply) => {
    const { rows } = await query(`
      SELECT
        (SELECT COUNT(*)  FROM assets WHERE status = 'active')               AS total_assets,
        (SELECT COUNT(*)  FROM assets WHERE status = 'active' AND duration IS NOT NULL) AS total_videos,
        (SELECT COALESCE(SUM(file_size), 0) FROM assets WHERE status = 'active') AS total_bytes,
        (SELECT COUNT(*)  FROM assets WHERE status = 'trashed')              AS trashed_assets,
        (SELECT COUNT(*)  FROM users WHERE is_active = true)                 AS total_users,
        (SELECT COUNT(*)  FROM persons)                                      AS total_persons,
        (SELECT COUNT(*)  FROM faces)                                        AS total_faces,
        (SELECT COUNT(*)  FROM albums)                                       AS total_albums,
        (SELECT COUNT(*)  FROM jobs WHERE status = 'pending')                AS pending_jobs,
        (SELECT COUNT(*)  FROM jobs WHERE status = 'failed')                 AS failed_jobs
    `);

    // Bilder per år
    const { rows: perYear } = await query(`
      SELECT
        EXTRACT(YEAR FROM taken_at)::int AS year,
        COUNT(*)::int                    AS count
      FROM assets
      WHERE status = 'active' AND taken_at IS NOT NULL
      GROUP BY year
      ORDER BY year DESC
    `);

    // Vanligaste kameramodeller
    const { rows: cameras } = await query(`
      SELECT m.value AS camera, COUNT(*)::int AS count
      FROM asset_metadata m
      WHERE m.source = 'exif' AND m.key = 'Model'
      GROUP BY m.value
      ORDER BY count DESC
      LIMIT 10
    `);

    return reply.send({ data: { ...rows[0], perYear, cameras } });
  });
}
