import { query } from '../db/pool.js';

export default async function searchRoutes(fastify) {

  // GET /api/search
  // Parametrar: q, tags, personId, dateFrom, dateTo, changedFrom, changedTo,
  //             hasGps, mimeType, limit, cursor
  fastify.get('/api/search', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q:           { type: 'string' },
          tags:        { type: 'string' },        // kommaseparerat
          personId:    { type: 'string' },
          dateFrom:    { type: 'string' },
          dateTo:      { type: 'string' },
          changedFrom: { type: 'string' },
          changedTo:   { type: 'string' },
          hasGps:      { type: 'boolean' },
          mimeType:    { type: 'string' },        // 'image' | 'video' | exact
          limit:       { type: 'integer', default: 50, maximum: 200 },
          cursor:      { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const {
      q, tags, personId, dateFrom, dateTo,
      changedFrom, changedTo, hasGps, mimeType,
      limit = 50, cursor,
    } = request.query;

    const params = [];
    const conditions = ["a.status = 'active'"];
    const joins = [];

    // Fritext: söker i filnamn, location_label, taggar och metadata-värden
    if (q) {
      const tsQuery = q.trim().split(/\s+/).join(' & ');
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

    // Taggar (AND-logik: bilden måste ha ALLA angivna taggar)
    if (tags) {
      const tagList = tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      for (const tag of tagList) {
        conditions.push(`EXISTS (
          SELECT 1 FROM asset_tags at4
          JOIN tags t3 ON t3.id = at4.tag_id
          WHERE at4.asset_id = a.id AND t3.name = $${params.push(tag)}
        )`);
      }
    }

    // Specifik person i bilden
    if (personId) {
      conditions.push(`EXISTS (
        SELECT 1 FROM faces f2
        WHERE f2.asset_id = a.id AND f2.person_id = $${params.push(personId)}
      )`);
    }

    // Fotodatum
    if (dateFrom) conditions.push(`a.taken_at >= $${params.push(dateFrom)}`);
    if (dateTo)   conditions.push(`a.taken_at <= $${params.push(dateTo)}`);

    // Ändringsdatum (indexed_at används som proxy för "senast modifierad i systemet")
    if (changedFrom) conditions.push(`a.indexed_at >= $${params.push(changedFrom)}`);
    if (changedTo)   conditions.push(`a.indexed_at <= $${params.push(changedTo)}`);

    // Filtrera på GPS
    if (hasGps === true)  conditions.push('a.location IS NOT NULL');
    if (hasGps === false) conditions.push('a.location IS NULL');

    // MIME-typ
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

    const { rows } = await query(
      `SELECT DISTINCT
         a.id, a.file_name, a.mime_type, a.file_size,
         a.taken_at, a.indexed_at, a.thumb_small_path, a.thumb_large_path,
         a.location_label, a.view_count, a.duration, a.width, a.height,
         ST_Y(a.location::geometry) AS lat,
         ST_X(a.location::geometry) AS lon
       FROM assets a
       ${where}
       ORDER BY a.taken_at DESC NULLS LAST
       LIMIT $${params.length}`,
      params
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].taken_at : null;

    return reply.send({ data: items, meta: { hasMore, nextCursor } });
  });
}
