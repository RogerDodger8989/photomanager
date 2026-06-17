import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/pool.js';
import { logAudit } from '../services/authService.js';
import { sendToUser } from '../services/sseService.js';

export default async function sharesRoutes(fastify) {

  // GET /api/shares — lista mina delningar (utgående)
  fastify.get('/api/shares', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { rows } = await query(
      `SELECT s.*,
              a.file_name   AS asset_name,
              a.thumb_small_path,
              al.name       AS album_name,
              u.username    AS shared_with_username
       FROM shares s
       LEFT JOIN assets a  ON a.id  = s.asset_id
       LEFT JOIN albums al ON al.id = s.album_id
       LEFT JOIN users u   ON u.id  = s.shared_with
       WHERE s.created_by = $1
       ORDER BY s.created_at DESC`,
      [request.user.id]
    );
    return reply.send({ data: rows });
  });

  // GET /api/shares/received — delningar som är skickade TILL mig
  fastify.get('/api/shares/received', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { rows } = await query(
      `SELECT s.*,
              a.file_name, a.thumb_small_path, a.mime_type,
              al.name AS album_name,
              u.username AS shared_by_username
       FROM shares s
       LEFT JOIN assets a  ON a.id  = s.asset_id
       LEFT JOIN albums al ON al.id = s.album_id
       JOIN users u ON u.id = s.created_by
       WHERE s.shared_with = $1 AND s.share_type = 'internal'
       ORDER BY s.created_at DESC`,
      [request.user.id]
    );
    return reply.send({ data: rows });
  });

  // POST /api/shares — skapa intern eller publik delning
  fastify.post('/api/shares', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['shareType'],
        properties: {
          shareType:   { type: 'string', enum: ['internal', 'public_link'] },
          assetId:     { type: 'string' },
          albumId:     { type: 'string' },
          sharedWith:  { type: 'string' },   // userId, intern delning
          expiresAt:   { type: 'string' },   // ISO datum
          accessLevel: { type: 'string', enum: ['read', 'write'], default: 'read' },
          maxViews:    { type: 'integer' },
        },
      },
    },
  }, async (request, reply) => {
    const {
      shareType, assetId, albumId, sharedWith,
      expiresAt, accessLevel = 'read', maxViews,
    } = request.body;

    if (!assetId && !albumId) {
      return reply.status(400).send({ error: 'assetId eller albumId krävs' });
    }

    const token = shareType === 'public_link' ? uuidv4() : null;

    const { rows } = await query(
      `INSERT INTO shares
         (share_type, asset_id, album_id, created_by, shared_with,
          token, expires_at, access_level, max_views)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        shareType, assetId ?? null, albumId ?? null, request.user.id,
        sharedWith ?? null, token, expiresAt ?? null, accessLevel, maxViews ?? null,
      ]
    );

    const share = rows[0];

    // Notifiera mottagaren via SSE om intern delning
    if (shareType === 'internal' && sharedWith) {
      sendToUser(sharedWith, 'share.received', {
        shareId: share.id,
        fromUsername: request.user.username,
        assetId, albumId,
      });
    }

    await logAudit(request.user.id, 'share', assetId ?? albumId, assetId ? 'asset' : 'album',
      { shareType, token }, request.ip);

    // Returnera inkl. publik URL om relevant
    const publicUrl = token ? `/share/${token}` : null;
    return reply.status(201).send({ data: { ...share, publicUrl } });
  });

  // DELETE /api/shares/:id — ta bort delning
  fastify.delete('/api/shares/:id', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await query(
      'DELETE FROM shares WHERE id = $1 AND created_by = $2 RETURNING id',
      [id, request.user.id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Delning hittades inte' });
    return reply.send({ data: { ok: true } });
  });

  // GET /share/:token — publik delnings-endpoint (ingen auth)
  fastify.get('/share/:token', async (request, reply) => {
    const { token } = request.params;

    const { rows } = await query(
      `SELECT s.*,
              a.id AS asset_id_r, a.file_name, a.mime_type, a.width, a.height,
              a.thumb_large_path, a.duration, a.transcode_status,
              al.id AS album_id_r, al.name AS album_name
       FROM shares s
       LEFT JOIN assets a  ON a.id  = s.asset_id  AND a.status = 'active'
       LEFT JOIN albums al ON al.id = s.album_id
       WHERE s.token = $1 AND s.share_type = 'public_link'`,
      [token]
    );

    const share = rows[0];
    if (!share) return reply.status(404).send({ error: 'Länk hittades inte' });

    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return reply.status(410).send({ error: 'Länken har gått ut' });
    }

    if (share.max_views && share.view_count >= share.max_views) {
      return reply.status(410).send({ error: 'Länkens maxvisningar har uppnåtts' });
    }

    await query('UPDATE shares SET view_count = view_count + 1 WHERE token = $1', [token]);

    // Om det är ett album, hämta innehållet
    let albumAssets = null;
    if (share.album_id) {
      const { rows: aRows } = await query(
        `SELECT a.id, a.file_name, a.mime_type, a.thumb_small_path, a.thumb_large_path,
                a.taken_at, a.duration
         FROM album_assets aa
         JOIN assets a ON a.id = aa.asset_id AND a.status = 'active'
         WHERE aa.album_id = $1
         ORDER BY aa.sort_order, a.taken_at`,
        [share.album_id]
      );
      albumAssets = aRows;
    }

    return reply.send({ data: { share, albumAssets } });
  });
}
