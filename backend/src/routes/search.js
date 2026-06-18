import { query } from '../db/pool.js';

export default async function searchRoutes(fastify) {

  // GET /api/tags?q= — taggar för autocomplete
  fastify.get('/api/tags', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: { q: { type: 'string', default: '' } },
      },
    },
  }, async (request, reply) => {
    const { q = '' } = request.query;
    const { rows } = await query(
      `SELECT t.name, COUNT(at2.asset_id)::int AS count
       FROM tags t JOIN asset_tags at2 ON at2.tag_id = t.id
       WHERE t.name ILIKE $1
       GROUP BY t.name ORDER BY count DESC LIMIT 15`,
      [`%${q}%`]
    );
    return reply.send({ data: rows });
  });

  // GET /api/search
  // Parametrar: q, tags, personId, personIds, dateFrom, dateTo, changedFrom, changedTo,
  //             hasGps, mimeType, limit, cursor
  fastify.get('/api/search', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q:           { type: 'string' },
          tags:        { type: 'string' },        // kommaseparerat
          tagsOp:      { type: 'string', enum: ['AND', 'OR'], default: 'AND' },
          personId:    { type: 'string' },         // bakåtkompatibel
          personIds:   { type: 'string' },         // kommaseparerat
          personIdsOp: { type: 'string', enum: ['AND', 'OR'], default: 'AND' },
          dateFrom:    { type: 'string' },
          dateTo:      { type: 'string' },
          changedFrom: { type: 'string' },
          changedTo:   { type: 'string' },
          hasGps:      { type: 'boolean' },
          mimeType:    { type: 'string' },
          limit:       { type: 'integer', default: 50, maximum: 200 },
          cursor:      { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.user.id;
    const {
      q, tags, tagsOp = 'AND', personId, personIds, personIdsOp = 'AND',
      dateFrom, dateTo, changedFrom, changedTo, hasGps, mimeType,
      limit = 50, cursor,
    } = request.query;

    const params = [];
    const conditions = ["a.status = 'active'"];

    // Fritext
    if (q) {
      conditions.push(`(
        a.file_name       ILIKE $${params.push('%' + q + '%')}
        OR a.location_label ILIKE $${params.push('%' + q + '%')}
        OR EXISTS (
          SELECT 1 FROM tags t2
          JOIN asset_tags at3 ON at3.tag_id = t2.id AND at3.asset_id = a.id
          WHERE t2.name ILIKE $${params.push('%' + q + '%')}
        )
        OR EXISTS (
          SELECT 1 FROM asset_metadata m2
          WHERE m2.asset_id = a.id AND m2.value ILIKE $${params.push('%' + q + '%')}
        )
      )`);
    }

    // Taggar
    if (tags) {
      const tagList = tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      if (tagsOp === 'OR') {
        // OR: bilden har MINST EN av taggarna
        const placeholders = tagList.map((t) => `$${params.push(t)}`).join(',');
        conditions.push(`EXISTS (
          SELECT 1 FROM asset_tags at4
          JOIN tags t3 ON t3.id = at4.tag_id
          WHERE at4.asset_id = a.id AND t3.name IN (${placeholders})
        )`);
      } else {
        // AND: bilden har ALLA taggar
        for (const tag of tagList) {
          conditions.push(`EXISTS (
            SELECT 1 FROM asset_tags at4
            JOIN tags t3 ON t3.id = at4.tag_id
            WHERE at4.asset_id = a.id AND t3.name = $${params.push(tag)}
          )`);
        }
      }
    }

    // PersonIds
    const allPersonIds = [
      ...(personIds ? personIds.split(',').map((p) => p.trim()).filter(Boolean) : []),
      ...(personId && !personIds ? [personId] : []),
    ];
    if (allPersonIds.length) {
      if (personIdsOp === 'OR') {
        // OR: bilden har MINST EN av personerna
        const placeholders = allPersonIds.map((p) => `$${params.push(p)}`).join(',');
        conditions.push(`EXISTS (
          SELECT 1 FROM faces f2
          WHERE f2.asset_id = a.id AND f2.person_id IN (${placeholders})
        )`);
      } else {
        // AND: bilden har ALLA valda personer
        for (const pid of allPersonIds) {
          conditions.push(`EXISTS (
            SELECT 1 FROM faces f2
            WHERE f2.asset_id = a.id AND f2.person_id = $${params.push(pid)}
          )`);
        }
      }
    }

    // Fotodatum
    if (dateFrom) conditions.push(`a.taken_at >= $${params.push(dateFrom)}`);
    if (dateTo)   conditions.push(`a.taken_at <= $${params.push(dateTo)}`);

    // Ändringsdatum
    if (changedFrom) conditions.push(`a.indexed_at >= $${params.push(changedFrom)}`);
    if (changedTo)   conditions.push(`a.indexed_at <= $${params.push(changedTo)}`);

    // GPS
    if (hasGps === true)  conditions.push('a.location IS NOT NULL');
    if (hasGps === false) conditions.push('a.location IS NULL');

    // MIME
    if (mimeType === 'image') {
      conditions.push("a.mime_type LIKE 'image/%'");
    } else if (mimeType === 'video') {
      conditions.push("a.mime_type LIKE 'video/%'");
    } else if (mimeType) {
      conditions.push(`a.mime_type = $${params.push(mimeType)}`);
    }

    // Cursor-paginering
    if (cursor) conditions.push(`a.taken_at < $${params.push(cursor)}`);

    const where = `WHERE ${conditions.join(' AND ')}`;
    params.push(limit + 1);
    params.push(userId);

    const { rows } = await query(
      `SELECT DISTINCT
         a.id, a.file_name, a.mime_type, a.file_size,
         a.taken_at, a.indexed_at, a.thumb_small_path, a.thumb_large_path,
         a.location_label, a.view_count, a.duration, a.width, a.height,
         ST_Y(a.location::geometry) AS lat,
         ST_X(a.location::geometry) AS lon,
         (EXISTS (SELECT 1 FROM favorites f WHERE f.asset_id = a.id AND f.user_id = $${params.length})) AS is_favorite
       FROM assets a
       ${where}
       ORDER BY a.taken_at DESC NULLS LAST
       LIMIT $${params.length - 1}`,
      params
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].taken_at : null;

    return reply.send({ data: items, meta: { hasMore, nextCursor } });
  });
}
