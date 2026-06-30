import { query } from '../db/pool.js';

const ALLOWED_EMOJIS = ['❤️', '😂', '😮', '👍', '😢', '🔥'];

// Åtgärder som visas i aktivitetsflödet (view/login_failed filtreras bort)
const ACTIVITY_ACTIONS = new Set([
  'upload', 'edit_metadata', 'edit_replace', 'edit_copy',
  'trash', 'restore', 'permanent_delete', 'share',
  'login', 'comment', 'reaction',
]);

export default async function socialRoutes(fastify) {

  // GET /api/activity — aktivitetsflöde för alla inloggade användare
  fastify.get('/api/activity', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit:  { type: 'integer', default: 60, maximum: 200 },
          offset: { type: 'integer', default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const { limit = 60, offset = 0 } = request.query;
    const actionList = [...ACTIVITY_ACTIONS].map((_, i) => `$${i + 1}`).join(',');
    const actionValues = [...ACTIVITY_ACTIONS];

    const { rows } = await query(
      `SELECT al.id, al.action, al.target_id, al.target_type, al.meta, al.created_at,
              u.username, u.id AS user_id,
              a.file_name, a.taken_at, a.thumb_small_path
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.user_id
       LEFT JOIN assets a ON a.id = al.target_id AND al.target_type = 'asset'
       WHERE al.action IN (${actionList})
       ORDER BY al.created_at DESC
       LIMIT $${actionValues.length + 1}
       OFFSET $${actionValues.length + 2}`,
      [...actionValues, limit, offset]
    );

    return reply.send({ data: rows });
  });

  // GET /api/assets/:id/social — kommentarer + reaktioner för en bild
  fastify.get('/api/assets/:id/social', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user.id;

    const [commentRows, reactionRows, myReactionRows] = await Promise.all([
      query(
        `SELECT c.id, c.content, c.created_at, c.updated_at,
                u.id AS user_id, u.username AS user_name
         FROM comments c
         JOIN users u ON u.id = c.user_id
         WHERE c.asset_id = $1
         ORDER BY c.created_at ASC`,
        [id]
      ),
      query(
        `SELECT emoji, COUNT(*)::int AS count
         FROM reactions
         WHERE asset_id = $1
         GROUP BY emoji`,
        [id]
      ),
      query(
        `SELECT emoji FROM reactions WHERE asset_id = $1 AND user_id = $2`,
        [id, userId]
      ),
    ]);

    return reply.send({
      data: {
        comments:    commentRows.rows,
        reactions:   reactionRows.rows,
        myReactions: myReactionRows.rows.map((r) => r.emoji),
      },
    });
  });

  // POST /api/assets/:id/comments — lägg till kommentar
  fastify.post('/api/assets/:id/comments', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['content'],
        properties: { content: { type: 'string', minLength: 1, maxLength: 2000 } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { content } = request.body;
    const userId = request.user.id;

    const { rows } = await query(
      `INSERT INTO comments (asset_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, content, created_at, updated_at`,
      [id, userId, content.trim()]
    );

    const { rows: userRows } = await query(
      `SELECT id, username FROM users WHERE id = $1`,
      [userId]
    );

    return reply.status(201).send({
      data: { ...rows[0], user_id: userId, user_name: userRows[0]?.username ?? 'Okänd' },
    });
  });

  // DELETE /api/comments/:id — ta bort kommentar (egen eller admin)
  fastify.delete('/api/comments/:id', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user.id;
    const isAdmin = request.user.role === 'admin';

    const { rows } = await query('SELECT user_id FROM comments WHERE id = $1', [id]);
    if (!rows.length) return reply.status(404).send({ error: 'Kommentar hittades inte' });
    if (!isAdmin && rows[0].user_id !== userId) {
      return reply.status(403).send({ error: 'Inte din kommentar' });
    }

    await query('DELETE FROM comments WHERE id = $1', [id]);
    return reply.send({ data: { ok: true } });
  });

  // POST /api/assets/:id/reactions — toggle reaktion (emoji skickas i body)
  fastify.post('/api/assets/:id/reactions', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['emoji'],
        properties: { emoji: { type: 'string', maxLength: 10 } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { emoji } = request.body;
    const userId = request.user.id;

    if (!ALLOWED_EMOJIS.includes(emoji)) {
      return reply.status(400).send({ error: 'Emoji ej tillåten' });
    }

    // Försök INSERT — om den redan finns, ta bort den (toggle)
    const existing = await query(
      `SELECT id FROM reactions WHERE asset_id = $1 AND user_id = $2 AND emoji = $3`,
      [id, userId, emoji]
    );

    if (existing.rows.length > 0) {
      await query('DELETE FROM reactions WHERE id = $1', [existing.rows[0].id]);
      return reply.send({ data: { action: 'removed', emoji } });
    } else {
      await query(
        `INSERT INTO reactions (asset_id, user_id, emoji) VALUES ($1, $2, $3)`,
        [id, userId, emoji]
      );
      return reply.send({ data: { action: 'added', emoji } });
    }
  });
}
