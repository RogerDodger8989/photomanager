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

  // GET /api/search/suggestions?type=cameraMake|cameraModel|location|sourceFolder&q=
  fastify.get('/api/search/suggestions', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          q:    { type: 'string', default: '' },
        },
        required: ['type'],
      },
    },
  }, async (request, reply) => {
    const { type, q = '' } = request.query;
    const like = `%${q}%`;
    let rows = [];

    if (type === 'cameraMake') {
      ({ rows } = await query(
        `SELECT DISTINCT m.value AS label, COUNT(m.asset_id)::int AS count
         FROM asset_metadata m
         JOIN assets a ON a.id = m.asset_id AND a.status = 'active'
         WHERE m.key = '271' AND m.value ILIKE $1
         GROUP BY m.value ORDER BY count DESC LIMIT 15`,
        [like]
      ));
    } else if (type === 'cameraModel') {
      ({ rows } = await query(
        `SELECT DISTINCT m.value AS label, COUNT(m.asset_id)::int AS count
         FROM asset_metadata m
         JOIN assets a ON a.id = m.asset_id AND a.status = 'active'
         WHERE m.key = '272' AND m.value ILIKE $1
         GROUP BY m.value ORDER BY count DESC LIMIT 15`,
        [like]
      ));
    } else if (type === 'location') {
      ({ rows } = await query(
        `SELECT location_label AS label, COUNT(*)::int AS count
         FROM assets
         WHERE status = 'active' AND location_label IS NOT NULL AND location_label ILIKE $1
         GROUP BY location_label ORDER BY count DESC LIMIT 15`,
        [like]
      ));
    } else if (type === 'sourceFolder') {
      ({ rows } = await query(
        `SELECT source_folder AS label, COUNT(*)::int AS count
         FROM assets
         WHERE status = 'active' AND source_folder IS NOT NULL AND source_folder ILIKE $1
         GROUP BY source_folder ORDER BY count DESC LIMIT 15`,
        [like]
      ));
    } else {
      return reply.status(400).send({ error: 'Okänd suggestions-typ' });
    }

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
          tags:        { type: 'string' },
          tagsOp:      { type: 'string', enum: ['AND', 'OR'], default: 'AND' },
          personId:    { type: 'string' },
          personIds:   { type: 'string' },
          personIdsOp: { type: 'string', enum: ['AND', 'OR'], default: 'AND' },
          dateFrom:    { type: 'string' },
          dateTo:      { type: 'string' },
          changedFrom: { type: 'string' },
          changedTo:   { type: 'string' },
          hasGps:      { type: 'boolean' },
          mimeType:    { type: 'string' },
          limit:       { type: 'integer', default: 50, maximum: 200 },
          cursor:      { type: 'string' },
          // Nya filtreringsparametrar
          ratingMin:      { type: 'integer' },
          ratingMax:      { type: 'integer' },
          flag:           { type: 'string' },   // kommasep 0-5
          colorLabel:     { type: 'string' },   // kommasep 0-5
          sizeMin:        { type: 'number' },   // bytes
          sizeMax:        { type: 'number' },
          widthMin:       { type: 'integer' },
          widthMax:       { type: 'integer' },
          heightMin:      { type: 'integer' },
          heightMax:      { type: 'integer' },
          isMotionPhoto:  { type: 'boolean' },
          isFavorite:     { type: 'boolean' },
          albumId:        { type: 'string' },
          sourceFolder:   { type: 'string' },
          cameraMake:     { type: 'string' },
          cameraModel:    { type: 'string' },
          sort:           { type: 'string' },
          order:          { type: 'string', enum: ['asc','desc'], default: 'desc' },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.user.id;
    const {
      q, tags, tagsOp = 'AND', personId, personIds, personIdsOp = 'AND',
      dateFrom, dateTo, changedFrom, changedTo, hasGps, mimeType,
      limit = 50, cursor,
      ratingMin, ratingMax, flag, colorLabel,
      sizeMin, sizeMax, widthMin, widthMax, heightMin, heightMax,
      isMotionPhoto, isFavorite, albumId, sourceFolder, cameraMake, cameraModel,
      sort = 'taken_at', order = 'desc',
    } = request.query;

    const params = [];
    const isAdmin = request.user.role === 'admin';
    const userRole = request.user.role;
    const conditions = [
      "a.status = 'active'",
      // Visa bara stack-covers (inte non-cover members)
      "(a.stack_id IS NULL OR a.id = (SELECT cover_asset_id FROM stacks WHERE id = a.stack_id))",
    ];

    // Synlighetsfilter — samma logik som GET /api/assets
    if (!isAdmin) {
      conditions.push(
        `(a.owner_id = $${params.push(userId)} OR a.visibility = 'shared'` +
        (userRole === 'family' ? ` OR a.visibility = 'family'` : '') +
        `)`
      );
    }

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
        OR EXISTS (
          SELECT 1 FROM faces f2
          JOIN persons p2 ON p2.id = f2.person_id
          WHERE f2.asset_id = a.id AND (
            p2.name ILIKE $${params.push('%' + q + '%')}
            OR p2.custom_id ILIKE $${params.push('%' + q + '%')}
          )
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
          WHERE at4.asset_id = a.id AND LOWER(t3.name) IN (${placeholders})
        )`);
      } else {
        // AND: bilden har ALLA taggar
        for (const tag of tagList) {
          conditions.push(`EXISTS (
            SELECT 1 FROM asset_tags at4
            JOIN tags t3 ON t3.id = at4.tag_id
            WHERE at4.asset_id = a.id AND LOWER(t3.name) = $${params.push(tag)}
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

    // Betyg
    if (ratingMin != null) conditions.push(`a.rating >= $${params.push(ratingMin)}`);
    if (ratingMax != null) conditions.push(`a.rating <= $${params.push(ratingMax)}`);

    // Flagga (kommasep, t.ex. "1,2,3")
    if (flag) {
      const flagVals = flag.split(',').map(Number).filter((n) => !isNaN(n));
      if (flagVals.length) conditions.push(`a.flag IN (${flagVals.map((v) => `$${params.push(v)}`).join(',')})`);
    }

    // Färgetikett (kommasep)
    if (colorLabel) {
      const clVals = colorLabel.split(',').map(Number).filter((n) => !isNaN(n));
      if (clVals.length) conditions.push(`a.color_label IN (${clVals.map((v) => `$${params.push(v)}`).join(',')})`);
    }

    // Filstorlek (bytes)
    if (sizeMin != null) conditions.push(`a.file_size >= $${params.push(sizeMin)}`);
    if (sizeMax != null) conditions.push(`a.file_size <= $${params.push(sizeMax)}`);

    // Dimensioner
    if (widthMin  != null) conditions.push(`a.width  >= $${params.push(widthMin)}`);
    if (widthMax  != null) conditions.push(`a.width  <= $${params.push(widthMax)}`);
    if (heightMin != null) conditions.push(`a.height >= $${params.push(heightMin)}`);
    if (heightMax != null) conditions.push(`a.height <= $${params.push(heightMax)}`);

    // Motion photo
    if (isMotionPhoto === true)  conditions.push('a.is_motion_photo = TRUE');
    if (isMotionPhoto === false) conditions.push('a.is_motion_photo = FALSE');

    // Favorit
    if (isFavorite === true)
      conditions.push(`EXISTS (SELECT 1 FROM favorites f2 WHERE f2.asset_id = a.id AND f2.user_id = $${params.push(userId)})`);
    if (isFavorite === false)
      conditions.push(`NOT EXISTS (SELECT 1 FROM favorites f2 WHERE f2.asset_id = a.id AND f2.user_id = $${params.push(userId)})`);

    // Album
    if (albumId)
      conditions.push(`EXISTS (SELECT 1 FROM album_assets aa WHERE aa.asset_id = a.id AND aa.album_id = $${params.push(albumId)})`);

    // Källmapp
    if (sourceFolder) conditions.push(`a.source_folder ILIKE $${params.push('%' + sourceFolder + '%')}`);

    // Kameramärke (EXIF-tag 271)
    if (cameraMake)
      conditions.push(`EXISTS (SELECT 1 FROM asset_metadata m WHERE m.asset_id = a.id AND m.key = '271' AND m.value ILIKE $${params.push('%' + cameraMake + '%')})`);

    // Kameramodell (EXIF-tag 272)
    if (cameraModel)
      conditions.push(`EXISTS (SELECT 1 FROM asset_metadata m WHERE m.asset_id = a.id AND m.key = '272' AND m.value ILIKE $${params.push('%' + cameraModel + '%')})`);

    // Cursor-paginering
    if (cursor) conditions.push(`a.taken_at < $${params.push(cursor)}`);

    const where = `WHERE ${conditions.join(' AND ')}`;
    params.push(limit + 1);
    params.push(userId);

    // Sortering — whitelist mot SQL-injektion
    const allowedSort = { taken_at:1, indexed_at:1, file_size:1, file_name:1, view_count:1, rating:1 };
    const sortCol = allowedSort[sort] ? sort : 'taken_at';
    const sortDir = order === 'asc' ? 'ASC' : 'DESC';

    const { rows } = await query(
      `SELECT DISTINCT
         a.id, a.file_name, a.mime_type, a.file_size,
         a.taken_at, a.indexed_at, a.thumb_small_path, a.thumb_large_path,
         a.location_label, a.view_count, a.duration, a.width, a.height,
         a.is_motion_photo, a.flag, a.color_label, a.rating, a.visibility,
         a.stack_id,
         (SELECT COUNT(*)::int FROM assets s WHERE s.stack_id = a.stack_id AND s.status = 'active') AS stack_size,
         ST_Y(a.location::geometry) AS lat,
         ST_X(a.location::geometry) AS lon,
         (EXISTS (SELECT 1 FROM favorites f WHERE f.asset_id = a.id AND f.user_id = $${params.length})) AS is_favorite
       FROM assets a
       ${where}
       ORDER BY a.${sortCol} ${sortDir} NULLS LAST
       LIMIT $${params.length - 1}`,
      params
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].taken_at : null;

    return reply.send({ data: items, meta: { hasMore, nextCursor } });
  });
}
