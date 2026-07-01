import { join, resolve } from 'path';
import { query } from '../db/pool.js';
import { getJobStats } from '../services/jobService.js';
import { backfillMotionPhotos } from '../workers/motionPhotoBackfill.js';
import { getModelStatus, downloadModel } from '../services/objectDetectionService.js';
import { testRemote, runBackup, startOAuthFlow, handleOAuthCallback, generateKeyConfig } from '../services/rcloneService.js';
import { config } from '../config.js';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

export default async function adminRoutes(fastify) {

  // Alla admin-routes kräver admin-roll
  fastify.addHook('onRequest', fastify.requireAdmin);

  // GET /api/admin/watermark — hämta vattenstämpel-inställningar
  fastify.get('/api/admin/watermark', async (_request, reply) => {
    const { rows } = await query("SELECT value FROM system_settings WHERE key = 'watermark'");
    return reply.send({ data: rows[0]?.value ?? { text: '© PhotoManager', position: 'southeast', opacity: 0.65 } });
  });

  // PATCH /api/admin/watermark — uppdatera vattenstämpel-inställningar
  fastify.patch('/api/admin/watermark', {
    schema: {
      body: {
        type: 'object',
        properties: {
          text:     { type: 'string', maxLength: 100 },
          position: { type: 'string', enum: ['southeast', 'southwest', 'northeast', 'northwest', 'center'] },
          opacity:  { type: 'number', minimum: 0.1, maximum: 1.0 },
        },
      },
    },
  }, async (request, reply) => {
    const patch = {};
    const b = request.body ?? {};
    if (typeof b.text     === 'string') patch.text     = b.text.trim() || '© PhotoManager';
    if (typeof b.position === 'string') patch.position = b.position;
    if (typeof b.opacity  === 'number') patch.opacity  = Math.round(b.opacity * 100) / 100;

    await query(`
      INSERT INTO system_settings (key, value)
      VALUES ('watermark', $1::jsonb)
      ON CONFLICT (key) DO UPDATE
        SET value = system_settings.value || $1::jsonb, updated_at = NOW()
    `, [JSON.stringify(patch)]);

    const { rows } = await query("SELECT value FROM system_settings WHERE key = 'watermark'");
    return reply.send({ data: rows[0]?.value });
  });

  // GET /api/admin/stats/storage — lagringsanalys per år/album/person
  fastify.get('/api/admin/stats/storage', async (_request, reply) => {
    const [yearRows, albumRows, personRows] = await Promise.all([
      query(`
        SELECT EXTRACT(YEAR FROM taken_at)::int AS label,
               COUNT(*)::int                    AS count,
               COALESCE(SUM(file_size), 0)::bigint AS bytes
        FROM assets
        WHERE status = 'active' AND taken_at IS NOT NULL
        GROUP BY label
        ORDER BY label DESC
      `),
      query(`
        SELECT al.name AS label,
               COUNT(DISTINCT aa.asset_id)::int        AS count,
               COALESCE(SUM(a.file_size), 0)::bigint   AS bytes
        FROM albums al
        JOIN album_assets aa ON aa.album_id = al.id
        JOIN assets a ON a.id = aa.asset_id AND a.status = 'active'
        GROUP BY al.id, al.name
        ORDER BY bytes DESC
        LIMIT 15
      `),
      query(`
        SELECT p.name AS label,
               COUNT(DISTINCT f.asset_id)::int        AS count,
               COALESCE(SUM(a.file_size), 0)::bigint  AS bytes
        FROM persons p
        JOIN faces f ON f.person_id = p.id
        JOIN assets a ON a.id = f.asset_id AND a.status = 'active'
        GROUP BY p.id, p.name
        ORDER BY bytes DESC
        LIMIT 15
      `),
    ]);

    return reply.send({ data: {
      year:   yearRows.rows,
      album:  albumRows.rows,
      person: personRows.rows,
    }});
  });

  // GET /api/admin/stats/camera — kamerastatistik för histogram-vyn
  fastify.get('/api/admin/stats/camera', async (_request, reply) => {
    const [isoRows, apertureRows, shutterRows, focalRows, lensRows] = await Promise.all([
      // ISO: sortera numeriskt, gruppera exakta värden, max 20 buckets
      query(`
        SELECT iso AS label, COUNT(*)::int AS count
        FROM assets
        WHERE iso IS NOT NULL AND status = 'active'
        GROUP BY iso
        ORDER BY iso
        LIMIT 20
      `),
      // Bländare: sortera numeriskt
      query(`
        SELECT aperture::TEXT AS label, COUNT(*)::int AS count
        FROM assets
        WHERE aperture IS NOT NULL AND status = 'active'
        GROUP BY aperture
        ORDER BY aperture
        LIMIT 20
      `),
      // Slutartid: sortera efter numeriskt värde (1/4000 < 1/250 < 1s < 2s)
      query(`
        SELECT shutter_speed AS label, COUNT(*)::int AS count,
               CASE
                 WHEN shutter_speed LIKE '1/%' THEN 1.0 / NULLIF(SPLIT_PART(shutter_speed, '/', 2)::NUMERIC, 0)
                 WHEN shutter_speed LIKE '%s'  THEN REPLACE(shutter_speed, 's', '')::NUMERIC
                 ELSE 0
               END AS sort_val
        FROM assets
        WHERE shutter_speed IS NOT NULL AND status = 'active'
        GROUP BY shutter_speed
        ORDER BY sort_val
        LIMIT 20
      `),
      // Brännvidd: sortera numeriskt
      query(`
        SELECT focal_length_mm::TEXT AS label, COUNT(*)::int AS count
        FROM assets
        WHERE focal_length_mm IS NOT NULL AND status = 'active'
        GROUP BY focal_length_mm
        ORDER BY focal_length_mm
        LIMIT 20
      `),
      // Objektiv: topp 10 efter antal bilder
      query(`
        SELECT lens_model AS label, COUNT(*)::int AS count
        FROM assets
        WHERE lens_model IS NOT NULL AND status = 'active'
        GROUP BY lens_model
        ORDER BY count DESC
        LIMIT 10
      `),
    ]);

    return reply.send({ data: {
      iso:          isoRows.rows,
      aperture:     apertureRows.rows,
      shutterSpeed: shutterRows.rows,
      focalLength:  focalRows.rows,
      lenses:       lensRows.rows,
    }});
  });

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

  // GET /api/admin/debug-metadata?path=<relativ-sökväg> — visa råa XMP-fält från en fil
  fastify.get('/api/admin/debug-metadata', async (request, reply) => {
    const { path: relPath } = request.query;
    if (!relPath) return reply.code(400).send({ error: 'path krävs' });
    const absPath = resolve(config.media.photosPath, relPath);
    const exifr = (await import('exifr')).default;
    const raw = await exifr.parse(absPath, {
      tiff: true, exif: true, iptc: true, xmp: true,
      translateKeys: false, translateValues: false, reviveValues: false,
    });
    // Filtrera ut relevanta tag-fält
    const tagFields = {};
    for (const key of Object.keys(raw ?? {})) {
      const lk = key.toLowerCase();
      if (lk.includes('subject') || lk.includes('keyword') || lk.includes('tag') || lk.includes('hier')) {
        tagFields[key] = raw[key];
      }
    }
    return reply.send({ tagFields, allKeys: Object.keys(raw ?? {}) });
  });

  // POST /api/admin/reindex-all — re-extrahera taggar för alla aktiva filer i bakgrunden
  fastify.post('/api/admin/reindex-all', async (request, reply) => {
    const { rows } = await query(
      `SELECT id, file_path FROM assets WHERE status = 'active'`
    );
    const total = rows.length;

    setImmediate(async () => {
      const { extractMetadata } = await import('../services/metadataService.js');
      for (const row of rows) {
        try {
          const absPath = resolve(config.media.photosPath, row.file_path);
          const meta = await extractMetadata(absPath);

          // Ta bort manuella/XMP-taggar — behåll AI-genererade (source='ai')
          await query("DELETE FROM asset_tags WHERE asset_id = $1 AND source != 'ai'", [row.id]);

          const hierPaths = meta.hierarchicalTags ?? [];
          const flatTags  = meta.tags ?? [];
          const coveredByHierarchy = new Set();
          for (const parts of hierPaths) {
            for (const part of parts) coveredByHierarchy.add(part.toLowerCase());
          }

          for (const parts of hierPaths) {
            let parentId = null;
            let parentPath = null;
            for (const part of parts) {
              const fullPath = parentPath ? `${parentPath}/${part}` : part;
              const underPersoner = fullPath === 'Personer' || fullPath.toLowerCase().startsWith('personer/');
              const { rows: tr } = await query(
                `INSERT INTO tags (name, path, parent_id, is_face_tag, export_only_leaf, show_lifespan, export_synonyms)
                 VALUES ($1, $2, $3, $4, $4, $4, NOT $4)
                 ON CONFLICT (path) DO UPDATE SET
                   name             = EXCLUDED.name,
                   parent_id        = EXCLUDED.parent_id,
                   is_face_tag      = CASE WHEN EXCLUDED.is_face_tag THEN TRUE ELSE tags.is_face_tag END,
                   export_only_leaf = CASE WHEN EXCLUDED.export_only_leaf THEN TRUE ELSE tags.export_only_leaf END,
                   show_lifespan    = CASE WHEN EXCLUDED.show_lifespan THEN TRUE ELSE tags.show_lifespan END,
                   export_synonyms  = CASE WHEN NOT EXCLUDED.export_synonyms THEN FALSE ELSE tags.export_synonyms END
                 RETURNING id`,
                [part, fullPath, parentId, underPersoner]
              );
              parentId   = tr[0].id;
              parentPath = fullPath;
            }
            if (parentId) {
              await query(
                `INSERT INTO asset_tags (asset_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [row.id, parentId]
              );
            }
          }

          for (const tagName of flatTags) {
            if (coveredByHierarchy.has(tagName.toLowerCase())) continue;
            const { rows: tr } = await query(
              `INSERT INTO tags (name, path) VALUES ($1, $1)
               ON CONFLICT (path) DO UPDATE SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id
               RETURNING id`,
              [tagName]
            );
            await query(
              `INSERT INTO asset_tags (asset_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [row.id, tr[0].id]
            );
          }
        } catch { /* hoppa över enstaka fel */ }
      }
      // Ta bort taggar som varken används av bilder ELLER är förälder till en använd tagg
      await query(`
        WITH RECURSIVE kept AS (
          -- Direkt använda löv-taggar
          SELECT tag_id AS id FROM asset_tags
          UNION
          -- Alla förfäder (föräldrar, far-föräldrar osv) till använda taggar
          SELECT t.parent_id
          FROM tags t
          JOIN kept k ON t.id = k.id
          WHERE t.parent_id IS NOT NULL
        )
        DELETE FROM tags WHERE id NOT IN (SELECT id FROM kept)
      `);
      console.log(`Re-indexering klar: ${total} filer behandlade`);
    });

    return reply.send({ data: { queued: total } });
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

  // POST /api/admin/phash-backfill — köa pHash-beräkning för alla bilder utan phash
  fastify.post('/api/admin/phash-backfill', async (request, reply) => {
    const { rows } = await query(
      `SELECT id FROM assets
       WHERE phash IS NULL AND status IN ('active', 'duplicate')
         AND mime_type LIKE 'image/%'
         AND thumb_small_path IS NOT NULL`
    );
    for (const row of rows) {
      await query(
        `INSERT INTO jobs (job_type, asset_id) VALUES ('phash', $1)`,
        [row.id]
      );
    }
    return reply.send({ data: { queued: rows.length } });
  });

  // GET /api/admin/object-detection/model-status — kontrollera om YOLOv8n-modellen finns
  fastify.get('/api/admin/object-detection/model-status', async (_request, reply) => {
    const status = await getModelStatus();
    return reply.send({ data: status });
  });

  // POST /api/admin/object-detection/download-model — ladda ner YOLOv8n.onnx till servern
  fastify.post('/api/admin/object-detection/download-model', async (_request, reply) => {
    try {
      const result = await downloadModel();
      return reply.send({ data: result });
    } catch (err) {
      return reply.code(500).send({ error: `Nedladdning misslyckades: ${err.message}` });
    }
  });

  // POST /api/admin/object-detection/backfill — köa objektdetektion för alla bilder utan AI-taggar
  fastify.post('/api/admin/object-detection/backfill', async (request, reply) => {
    const status = await getModelStatus();
    if (!status.ready) {
      return reply.code(400).send({ error: 'Modellen saknas — ladda ner den först' });
    }
    // Bilder som ännu inte har AI-taggar (d.v.s. saknar asset_tags med source='ai')
    const { rows } = await query(
      `SELECT DISTINCT a.id FROM assets a
       WHERE a.status IN ('active', 'duplicate')
         AND a.mime_type LIKE 'image/%'
         AND a.thumb_small_path IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM asset_tags at2 WHERE at2.asset_id = a.id AND at2.source = 'ai'
         )`
    );
    for (const row of rows) {
      await query(
        `INSERT INTO jobs (job_type, asset_id) VALUES ('object_detection', $1)`,
        [row.id]
      );
    }
    return reply.send({ data: { queued: rows.length } });
  });

  // GET /api/admin/perceptual-duplicates — nästan-identiska bilder via pHash Hamming-distans
  fastify.get('/api/admin/perceptual-duplicates', async (request, reply) => {
    const threshold = Math.min(parseInt(request.query.threshold ?? '10', 10), 20);

    // Hämta alla bilder med phash
    const { rows: assets } = await query(
      `SELECT id, file_path, file_name, file_size, width, height,
              taken_at, indexed_at, thumb_small_path, status, phash
       FROM assets
       WHERE phash IS NOT NULL AND status IN ('active', 'duplicate')
       ORDER BY indexed_at ASC`
    );

    if (assets.length === 0) return reply.send({ data: [] });

    // Beräkna nästan-duplikat med union-find i JS (undviker O(n²) SQL för stora bibliotek)
    const parent = new Map(assets.map((a) => [a.id, a.id]));
    function find(x) {
      if (parent.get(x) !== x) parent.set(x, find(parent.get(x)));
      return parent.get(x);
    }
    function union(x, y) {
      parent.set(find(x), find(y));
    }

    // Beräkna Hamming-distans mellan alla par (Brian Kernighan popcount)
    for (let i = 0; i < assets.length; i++) {
      const ha = BigInt(assets[i].phash);
      for (let j = i + 1; j < assets.length; j++) {
        const hb = BigInt(assets[j].phash);
        // asUintN(64) konverterar signed int64 → unsigned för korrekt biträkning
        let tmp = BigInt.asUintN(64, ha ^ hb);
        if (tmp === 0n) { union(assets[i].id, assets[j].id); continue; }
        let bits = 0;
        while (tmp !== 0n) { tmp &= tmp - 1n; bits++; if (bits > threshold) break; }
        if (bits <= threshold) union(assets[i].id, assets[j].id);
      }
    }

    // Gruppera
    const groups = new Map();
    for (const a of assets) {
      const root = find(a.id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(a);
    }

    const result = [...groups.values()]
      .filter((g) => g.length > 1)
      .sort((a, b) => b.length - a.length);

    return reply.send({ data: result });
  });

  // GET /api/admin/duplicates — lista duplikat (active + duplicate-status)
  fastify.get('/api/admin/duplicates', async (request, reply) => {
    const { rows } = await query(
      `SELECT file_hash, COUNT(*)::int AS count,
              json_agg(json_build_object(
                'id', id, 'file_path', file_path,
                'file_size', file_size, 'taken_at', taken_at,
                'thumb_small_path', thumb_small_path,
                'status', status
              ) ORDER BY indexed_at) AS assets
       FROM assets
       WHERE file_hash IS NOT NULL AND status IN ('active', 'duplicate')
       GROUP BY file_hash
       HAVING COUNT(*) > 1
       ORDER BY count DESC`
    );
    return reply.send({ data: rows });
  });

  // GET /api/admin/users — lista alla användare
  fastify.get('/api/admin/users', async (request, reply) => {
    const { rows } = await query(
      `SELECT u.id, u.username, u.email, u.role, u.is_active, u.can_upload,
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
          role:       { type: 'string', enum: ['admin', 'family', 'user', 'guest'] },
          can_upload: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const { username, email, password, role, can_upload } = request.body;
    const hash = await bcrypt.hash(password, 12);
    // Admins och family-users kan ladda upp som default
    const uploadDefault = can_upload ?? (role === 'admin' || role === 'family');
    const { rows } = await query(
      `INSERT INTO users (id, username, email, password_hash, role, can_upload)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, username, email, role, can_upload, created_at`,
      [uuidv4(), username, email ?? null, hash, role, uploadDefault]
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // PATCH /api/admin/users/:id — uppdatera användare
  fastify.patch('/api/admin/users/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          email:      { type: 'string' },
          role:       { type: 'string', enum: ['admin', 'family', 'user', 'guest'] },
          is_active:  { type: 'boolean' },
          password:   { type: 'string', minLength: 8 },
          can_upload: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { email, role, is_active, password, can_upload } = request.body;

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
    if (can_upload !== undefined) {
      await query('UPDATE users SET can_upload = $1 WHERE id = $2', [can_upload, id]);
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
        (SELECT COUNT(*)  FROM assets WHERE status = 'active' AND mime_type NOT LIKE 'video/%') AS total_images,
        (SELECT COUNT(*)  FROM assets WHERE status = 'active' AND mime_type LIKE 'video/%') AS total_videos,
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

    // Uppladdningar per dag (senaste 30 dagarna)
    const { rows: uploadsPerDay } = await query(`
      SELECT
        DATE(indexed_at)::text AS day,
        COUNT(*)::int           AS count
      FROM assets
      WHERE status = 'active' AND indexed_at >= NOW() - INTERVAL '30 days'
      GROUP BY day
      ORDER BY day ASC
    `);

    // Lagring per månad (senaste 12 månader)
    const { rows: storagePerMonth } = await query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', indexed_at), 'YYYY-MM') AS month,
        COALESCE(SUM(file_size), 0)::bigint                  AS bytes
      FROM assets
      WHERE status = 'active' AND indexed_at >= NOW() - INTERVAL '12 months'
      GROUP BY month
      ORDER BY month ASC
    `);

    // AI-igenkänningsprecision
    const { rows: aiRows } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE reviewed = TRUE)::int                         AS ai_reviewed,
        COUNT(*) FILTER (WHERE reviewed = TRUE AND accepted = TRUE)::int      AS ai_accepted,
        COUNT(*) FILTER (WHERE reviewed = TRUE AND accepted = FALSE)::int     AS ai_rejected,
        ROUND(AVG(confidence) FILTER (WHERE accepted = TRUE)::numeric, 2)    AS ai_avg_conf_accepted,
        ROUND(AVG(confidence) FILTER (WHERE accepted = FALSE)::numeric, 2)   AS ai_avg_conf_rejected
      FROM ai_suggestions
    `);
    const aiStats = aiRows[0] ?? {};

    return reply.send({ data: { ...rows[0], perYear, cameras, uploadsPerDay, storagePerMonth, aiStats } });
  });

  // POST /api/admin/faces/recluster — köa om-klustringsjobb för alla okända ansikten
  fastify.post('/api/admin/faces/recluster', async (request, reply) => {
    await query(`INSERT INTO jobs (job_type) VALUES ('recluster_faces') ON CONFLICT DO NOTHING`);
    return reply.send({ data: { ok: true, message: 'Omklustringsjobb köat' } });
  });

  // POST /api/admin/backfill-motion-photos — uppdatera is_motion_photo för befintliga bilder
  fastify.post('/api/admin/backfill-motion-photos', async (request, reply) => {
    const result = await backfillMotionPhotos();
    return reply.send({ data: result });
  });

  // GET /api/admin/import-sessions — senaste import-sessioner
  fastify.get('/api/admin/import-sessions', async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit ?? '100', 10), 200);
    const { rows } = await query(
      `SELECT id, source, source_path, started_at, ended_at,
              total, imported, skipped, errors
       FROM import_sessions
       ORDER BY started_at DESC
       LIMIT $1`,
      [limit]
    );
    return reply.send({ data: rows });
  });

  // GET /api/admin/backups — lista molnbackup-konfigurationer
  fastify.get('/api/admin/backups', async (_request, reply) => {
    const { rows } = await query(
      `SELECT id, name, remote_name, dest_path, schedule, enabled,
              last_run, last_status, last_log, created_at
       FROM backup_configs ORDER BY created_at DESC`
    );
    return reply.send({ data: rows });
  });

  // POST /api/admin/backups — skapa via nyckelbaserad provider (S3, B2, WebDAV, SFTP)
  fastify.post('/api/admin/backups', async (request, reply) => {
    const { name, remoteName, destPath = 'PhotoManager', schedule = 'manual', provider, ...providerParams } = request.body;
    if (!name || !remoteName || !provider) return reply.status(400).send({ error: 'name, remoteName och provider krävs' });

    const rcloneConfig = await generateKeyConfig({ provider, remoteName, ...providerParams });
    const { rows } = await query(
      `INSERT INTO backup_configs (name, remote_name, rclone_config, dest_path, schedule, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, name, remote_name, dest_path, schedule, enabled, last_run, last_status, last_log, created_at`,
      [name, remoteName, rcloneConfig, destPath, schedule, request.user.id]
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // POST /api/admin/oauth/start — starta OAuth-flöde för Google Drive / OneDrive / Dropbox
  fastify.post('/api/admin/oauth/start', async (request, reply) => {
    const { provider, clientId, clientSecret, remoteName, name, destPath, schedule } = request.body;
    if (!provider || !clientId || !clientSecret || !remoteName || !name) {
      return reply.status(400).send({ error: 'provider, clientId, clientSecret, remoteName och name krävs' });
    }
    const result = startOAuthFlow({ provider, clientId, clientSecret, remoteName, name, destPath, schedule });
    return reply.send({ data: result });
  });

  // GET /api/admin/oauth/callback — OAuth-återanrop från Google/Microsoft/Dropbox (öppnas i popup)
  fastify.get('/api/admin/oauth/callback', async (request, reply) => {
    const { code, state, error: oauthError } = request.query;

    if (oauthError) {
      return reply.type('text/html').send(oauthCallbackHtml(false, `OAuth-fel: ${oauthError}`));
    }
    if (!code || !state) {
      return reply.type('text/html').send(oauthCallbackHtml(false, 'Saknar code eller state i återanropet.'));
    }

    try {
      await handleOAuthCallback(code, state);
      return reply.type('text/html').send(oauthCallbackHtml(true, ''));
    } catch (err) {
      fastify.log.error(err, 'OAuth callback misslyckades');
      return reply.type('text/html').send(oauthCallbackHtml(false, err.message));
    }
  });

  // PATCH /api/admin/backups/:id
  fastify.patch('/api/admin/backups/:id', async (request, reply) => {
    const { id } = request.params;
    const { name, destPath, schedule, enabled } = request.body;
    const { rows } = await query(
      `UPDATE backup_configs SET
         name      = COALESCE($2, name),
         dest_path = COALESCE($3, dest_path),
         schedule  = COALESCE($4, schedule),
         enabled   = COALESCE($5, enabled)
       WHERE id = $1
       RETURNING id, name, remote_name, dest_path, schedule, enabled, last_run, last_status, last_log, created_at`,
      [id, name ?? null, destPath ?? null, schedule ?? null, enabled ?? null]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Backup-konfiguration hittades inte' });
    return reply.send({ data: rows[0] });
  });

  // DELETE /api/admin/backups/:id
  fastify.delete('/api/admin/backups/:id', async (request, reply) => {
    const { rows } = await query('DELETE FROM backup_configs WHERE id = $1 RETURNING id', [request.params.id]);
    if (!rows[0]) return reply.status(404).send({ error: 'Hittades inte' });
    return reply.send({ data: { ok: true } });
  });

  // POST /api/admin/backups/:id/test
  fastify.post('/api/admin/backups/:id/test', async (request, reply) => {
    const result = await testRemote(request.params.id);
    return reply.send({ data: result });
  });

  // POST /api/admin/backups/:id/run
  fastify.post('/api/admin/backups/:id/run', async (request, reply) => {
    const { id } = request.params;
    const { rows } = await query('SELECT id FROM backup_configs WHERE id = $1', [id]);
    if (!rows[0]) return reply.status(404).send({ error: 'Hittades inte' });
    await query(`UPDATE backup_configs SET last_status = 'running' WHERE id = $1`, [id]);
    runBackup(id).catch((err) => fastify.log.error(err, 'Backup misslyckades'));
    return reply.send({ data: { ok: true } });
  });
}

function oauthCallbackHtml(success, errorMsg) {
  const escaped = String(errorMsg).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html><html lang="sv">
<head><meta charset="UTF-8"><title>${success ? 'Klart' : 'Fel'} – PhotoManager</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0f172a;color:#e2e8f0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.box{background:#1e293b;border:1px solid #334155;border-radius:1rem;padding:2rem 2.5rem;text-align:center;max-width:400px}
h2{font-size:1.25rem;margin-bottom:.75rem;color:${success ? '#4ade80' : '#f87171'}}p{color:#94a3b8;font-size:.875rem;line-height:1.5}</style></head>
<body><div class="box">
<h2>${success ? '✓ Ansluten!' : '✕ Något gick fel'}</h2>
<p>${success ? 'Backupen skapades. Det här fönstret stängs automatiskt…' : escaped}</p>
</div>
<script>
if(${success}){
  if(window.opener){window.opener.postMessage({type:'oauth-done'},'*');}
  setTimeout(()=>window.close(),1500);
}
</script></body></html>`;
}
