import { query } from '../db/pool.js';

const ALLOWED_EMOJIS = ['❤️', '😂', '😮', '👍', '😢', '🔥'];

export default async function socialRoutes(fastify) {

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
