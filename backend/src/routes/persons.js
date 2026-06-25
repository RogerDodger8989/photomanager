import path from 'path';
import { tmpdir } from 'os';
import { createReadStream, existsSync } from 'fs';
import { writeFile, unlink } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import archiver from 'archiver';
import { query } from '../db/pool.js';
import { syncFacesToFile } from '../services/xmpService.js';
import { config } from '../config.js';
import { findClosestPerson } from '../services/aiService.js';

export default async function personsRoutes(fastify) {

  // GET /api/persons — alla namngivna personer med filter/sortering
  fastify.get('/api/persons', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          filter: { type: 'string', enum: ['no_photos', 'no_birth', 'no_death', 'dead', 'alive'] },
          sort:   { type: 'string', enum: ['name_asc', 'name_desc', 'most_photos', 'least_photos', 'newest', 'birth_year'] },
        },
      },
    },
  }, async (request, reply) => {
    const { filter, sort = 'most_photos' } = request.query;

    const whereConditions = [];
    const havingConditions = [];

    if (filter === 'no_birth')  whereConditions.push('p.birth_year IS NULL');
    if (filter === 'no_death')  whereConditions.push('p.death_year IS NULL');
    if (filter === 'dead')      whereConditions.push('p.death_year IS NOT NULL');
    if (filter === 'alive')     whereConditions.push('p.death_year IS NULL');
    if (filter === 'no_photos') havingConditions.push('COUNT(DISTINCT fa.id) = 0');

    const whereClause  = whereConditions.length  ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const havingClause = havingConditions.length ? `HAVING ${havingConditions.join(' AND ')}` : '';

    const ORDER_MAP = {
      name_asc:    'p.name ASC',
      name_desc:   'p.name DESC',
      most_photos: 'COUNT(DISTINCT fa.id) DESC',
      least_photos:'COUNT(DISTINCT fa.id) ASC',
      newest:      'p.created_at DESC',
      birth_year:  'p.birth_year ASC NULLS LAST',
    };
    const orderClause = ORDER_MAP[sort] ?? ORDER_MAP.most_photos;

    const { rows } = await query(
      `SELECT
         p.id, p.name, p.birth_year, p.death_year, p.cover_face_id, p.created_at,
         p.external_url, p.notes, p.custom_id,
         a.thumb_small_path AS cover_thumb,
         (SELECT f3.id
          FROM faces f3
          JOIN assets a3 ON a3.id = f3.asset_id AND a3.status = 'active'
          WHERE f3.person_id = p.id
          LIMIT 1) AS fallback_face_id,
         COUNT(DISTINCT fa.id)::int AS photo_count
       FROM persons p
       LEFT JOIN faces f ON f.person_id = p.id
       LEFT JOIN assets fa ON fa.id = f.asset_id AND fa.status = 'active'
       LEFT JOIN faces cf ON cf.id = p.cover_face_id
       LEFT JOIN assets a ON a.id = cf.asset_id AND a.status = 'active'
       ${whereClause}
       GROUP BY p.id, a.thumb_small_path
       ${havingClause}
       ORDER BY ${orderClause}`
    );
    return reply.send({ data: rows });
  });

  // GET /api/persons/duplicates — hitta möjliga dubblettpersoner via embedding-likhet
  fastify.get('/api/persons/duplicates', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    // Hämta medelembedding per person (avg av alla deras ansikten)
    const { rows } = await query(
      `SELECT p.id, p.name, p.birth_year, p.death_year, p.cover_face_id,
              (SELECT f3.id FROM faces f3 JOIN assets a3 ON a3.id = f3.asset_id AND a3.status = 'active'
               WHERE f3.person_id = p.id LIMIT 1) AS fallback_face_id,
              COUNT(DISTINCT f.id)::int AS face_count,
              AVG(f.embedding)::text AS avg_embedding
       FROM persons p
       JOIN faces f ON f.person_id = p.id AND f.embedding IS NOT NULL
       JOIN assets a ON a.id = f.asset_id AND a.status = 'active'
       GROUP BY p.id
       HAVING COUNT(f.id) >= 1`
    );

    if (rows.length < 2) return reply.send({ data: [] });

    function parseEmb(text) {
      if (!text) return null;
      try { return text.slice(1, -1).split(',').map(Number); } catch { return null; }
    }
    function cosineSim(a, b) {
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
      return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
    }

    const DUPE_THRESHOLD = 0.82;
    const pairs = [];

    for (let i = 0; i < rows.length; i++) {
      const embA = parseEmb(rows[i].avg_embedding);
      if (!embA) continue;
      for (let j = i + 1; j < rows.length; j++) {
        const embB = parseEmb(rows[j].avg_embedding);
        if (!embB) continue;
        const sim = cosineSim(embA, embB);
        if (sim >= DUPE_THRESHOLD) {
          pairs.push({
            similarity: Math.round(sim * 100) / 100,
            personA: { id: rows[i].id, name: rows[i].name, birth_year: rows[i].birth_year, death_year: rows[i].death_year, cover_face_id: rows[i].cover_face_id, fallback_face_id: rows[i].fallback_face_id, face_count: rows[i].face_count },
            personB: { id: rows[j].id, name: rows[j].name, birth_year: rows[j].birth_year, death_year: rows[j].death_year, cover_face_id: rows[j].cover_face_id, fallback_face_id: rows[j].fallback_face_id, face_count: rows[j].face_count },
          });
        }
      }
    }

    pairs.sort((a, b) => b.similarity - a.similarity);
    return reply.send({ data: pairs });
  });

  // GET /api/persons/:id/stats — statistik för en person
  fastify.get('/api/persons/:id/stats', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;

    const [photoYears, topMonths, topPlaces, yearRange] = await Promise.all([
      query(
        `SELECT EXTRACT(YEAR FROM a.taken_at)::int AS year, COUNT(*)::int AS count
         FROM faces f JOIN assets a ON a.id = f.asset_id AND a.status = 'active'
         WHERE f.person_id = $1 AND a.taken_at IS NOT NULL
         GROUP BY year ORDER BY count DESC`,
        [id]
      ),
      query(
        `SELECT TO_CHAR(a.taken_at, 'Month') AS month, EXTRACT(MONTH FROM a.taken_at)::int AS month_num, COUNT(*)::int AS count
         FROM faces f JOIN assets a ON a.id = f.asset_id AND a.status = 'active'
         WHERE f.person_id = $1 AND a.taken_at IS NOT NULL
         GROUP BY month, month_num ORDER BY count DESC LIMIT 3`,
        [id]
      ),
      query(
        `SELECT a.location_label, COUNT(*)::int AS count
         FROM faces f JOIN assets a ON a.id = f.asset_id AND a.status = 'active'
         WHERE f.person_id = $1 AND a.location_label IS NOT NULL
         GROUP BY a.location_label ORDER BY count DESC LIMIT 5`,
        [id]
      ),
      query(
        `SELECT MIN(EXTRACT(YEAR FROM a.taken_at))::int AS first_year,
                MAX(EXTRACT(YEAR FROM a.taken_at))::int AS last_year,
                COUNT(DISTINCT EXTRACT(YEAR FROM a.taken_at))::int AS active_years
         FROM faces f JOIN assets a ON a.id = f.asset_id AND a.status = 'active'
         WHERE f.person_id = $1 AND a.taken_at IS NOT NULL`,
        [id]
      ),
    ]);

    return reply.send({
      data: {
        photoYears: photoYears.rows,
        topMonths:  topMonths.rows,
        topPlaces:  topPlaces.rows,
        yearRange:  yearRange.rows[0] ?? {},
      },
    });
  });

  // GET /api/persons/:id/export — exportera persondata som JSON
  fastify.get('/api/persons/:id/export', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows: pRows } = await query('SELECT * FROM persons WHERE id = $1', [id]);
    if (!pRows[0]) return reply.status(404).send({ error: 'Person hittades inte' });
    const p = pRows[0];

    const { rows: assets } = await query(
      `SELECT a.file_name, a.taken_at, a.location_label,
              ST_Y(a.location::geometry) AS lat, ST_X(a.location::geometry) AS lon
       FROM faces f JOIN assets a ON a.id = f.asset_id AND a.status = 'active'
       WHERE f.person_id = $1 ORDER BY a.taken_at`,
      [id]
    );

    const exportData = {
      id: p.id,
      name: p.name,
      birth_year: p.birth_year,
      death_year: p.death_year,
      photo_count: assets.length,
      photos: assets.map(a => ({
        file_name: a.file_name,
        taken_at: a.taken_at,
        location: a.location_label,
        lat: a.lat,
        lon: a.lon,
      })),
      exported_at: new Date().toISOString(),
    };

    const safeName = p.name.replace(/[^a-zA-Z0-9åäöÅÄÖ_-]/g, '_');
    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="${safeName}.json"`);
    return reply.send(JSON.stringify(exportData, null, 2));
  });

  // GET /api/persons/:id/export-photos — ZIP med alla originalbilder personen förekommer i
  fastify.get('/api/persons/:id/export-photos', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows: pRows } = await query('SELECT name FROM persons WHERE id = $1', [id]);
    if (!pRows[0]) return reply.status(404).send({ error: 'Person hittades inte' });

    const { rows: assets } = await query(
      `SELECT DISTINCT a.file_path, a.file_name
       FROM faces f JOIN assets a ON a.id = f.asset_id AND a.status = 'active'
       WHERE f.person_id = $1 ORDER BY a.file_name`,
      [id]
    );

    const safeName = pRows[0].name.replace(/[^a-zA-Z0-9åäöÅÄÖ_-]/g, '_');
    reply.raw.setHeader('Content-Type', 'application/zip');
    reply.raw.setHeader('Content-Disposition', `attachment; filename="${safeName}_bilder.zip"`);

    const archive = archiver('zip', { zlib: { level: 0 } }); // level 0 = store (bilder komprimeras ej)
    archive.pipe(reply.raw);

    for (const asset of assets) {
      const absPath = path.resolve(config.media.photosPath, asset.file_path);
      if (existsSync(absPath)) archive.file(absPath, { name: asset.file_name });
    }

    await archive.finalize();
    return reply;
  });

  // POST /api/faces/search-by-image — ladda upp bild och hitta liknande ansikten/personer
  fastify.post('/api/faces/search-by-image', {
    onRequest: [fastify.authenticate],
    config: { bodyLimit: 20 * 1024 * 1024 },
  }, async (request, reply) => {
    const { isAiAvailable, processAssetFaces } = await import('../services/aiService.js');
    const { analyzeFaces, toVectorString } = await import('../services/faceRecognition.js');

    if (!isAiAvailable()) {
      return reply.status(503).send({ error: 'AI-tjänsten är inte aktiv' });
    }

    // Spara uppladdad fil temporärt
    const tmpPath = path.join(tmpdir(), `face-search-${uuidv4()}.jpg`);
    try {
      const parts = request.parts({ limits: { fileSize: 20 * 1024 * 1024 } });
      let saved = false;
      for await (const part of parts) {
        if (part.type === 'file') {
          const chunks = [];
          for await (const chunk of part.file) chunks.push(chunk);
          await writeFile(tmpPath, Buffer.concat(chunks));
          saved = true;
          break;
        }
      }
      if (!saved) return reply.status(400).send({ error: 'Ingen bildfil uppladdad' });

      const detected = await analyzeFaces(tmpPath);
      if (!detected.faces.length) {
        return reply.send({ data: [], message: 'Inga ansikten hittades i bilden' });
      }

      // Sök varje ansikte mot kända personer via pgvector
      const results = [];
      for (const face of detected.faces) {
        if (!face.embedding.length) continue;
        const vecStr = toVectorString(face.embedding);
        const { rows } = await query(
          `SELECT p.id, p.name, p.birth_year, p.death_year, p.cover_face_id,
                  (SELECT f3.id FROM faces f3 JOIN assets a3 ON a3.id = f3.asset_id AND a3.status = 'active'
                   WHERE f3.person_id = p.id LIMIT 1) AS fallback_face_id,
                  1 - (f.embedding <=> $1::vector) AS similarity
           FROM faces f
           JOIN persons p ON p.id = f.person_id
           JOIN assets a ON a.id = f.asset_id AND a.status = 'active'
           WHERE f.embedding IS NOT NULL AND f.person_id IS NOT NULL
           ORDER BY f.embedding <=> $1::vector
           LIMIT 5`,
          [vecStr]
        );
        const matches = rows.filter(r => parseFloat(r.similarity) >= 0.5);
        if (matches.length) {
          results.push({
            face: { region_x: face.region_x, region_y: face.region_y, region_w: face.region_w, region_h: face.region_h },
            matches: matches.map(r => ({ ...r, similarity: Math.round(parseFloat(r.similarity) * 100) / 100 })),
          });
        }
      }

      return reply.send({ data: results });
    } finally {
      unlink(tmpPath).catch(() => {});
    }
  });

  // GET /api/faces/unassigned — okända ansikten grupperade i kluster
  fastify.get('/api/faces/unassigned', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { rows } = await query(
      `SELECT f.id, f.asset_id,
              a.file_name, a.thumb_small_path, a.thumb_large_path, a.mime_type,
              f.region_x, f.region_y, f.region_w, f.region_h,
              f.cluster_group_id,
              f.embedding::text AS embedding_text
       FROM faces f
       JOIN assets a ON a.id = f.asset_id AND a.status = 'active'
       WHERE f.person_id IS NULL AND f.dismissed IS NOT TRUE
       ORDER BY f.created_at DESC
       LIMIT 5000`
    );

    function parseEmbedding(text) {
      return text.slice(1, -1).split(',').map(Number);
    }

    function cosineSim(a, b) {
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
      return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
    }

    // Gruppera manuellt sammanslagna faces (cluster_group_id) först
    const manualGroups = new Map(); // cluster_group_id → face[]
    const remaining = [];
    for (const row of rows) {
      if (row.cluster_group_id) {
        if (!manualGroups.has(row.cluster_group_id)) manualGroups.set(row.cluster_group_id, []);
        manualGroups.get(row.cluster_group_id).push(row);
      } else {
        remaining.push(row);
      }
    }

    // Greedy agglomerativ klustring på remaining, tröskel 0.75
    const THRESHOLD = 0.75;
    const clusters = [];

    const withEmb    = remaining.filter(r => r.embedding_text);
    const withoutEmb = remaining.filter(r => !r.embedding_text);

    for (const face of withEmb) {
      const emb = parseEmbedding(face.embedding_text);
      let bestIdx = -1, bestSim = -1;
      for (let i = 0; i < clusters.length; i++) {
        const sim = cosineSim(emb, clusters[i].centroid);
        if (sim > bestSim) { bestSim = sim; bestIdx = i; }
      }
      if (bestSim >= THRESHOLD) {
        const cl = clusters[bestIdx];
        cl.faces.push(face);
        for (let i = 0; i < emb.length; i++) cl.sum[i] += emb[i];
        const n = cl.faces.length;
        cl.centroid = cl.sum.map(v => v / n);
      } else {
        clusters.push({ centroid: emb, sum: [...emb], faces: [face] });
      }
    }

    clusters.sort((a, b) => b.faces.length - a.faces.length);

    const data = [];

    // Manuella grupper visas först (de är bekräftade av användaren)
    let mgIdx = 0;
    for (const [groupId, faces] of manualGroups) {
      data.push({
        clusterId: `mg${mgIdx++}`,
        faces: faces.map(({ embedding_text, cluster_group_id, ...f }) => f),
      });
    }

    // Embedding-kluster
    for (let i = 0; i < clusters.length; i++) {
      data.push({
        clusterId: `c${i}`,
        faces: clusters[i].faces.map(({ embedding_text, cluster_group_id, ...f }) => f),
      });
    }

    // Faces utan embedding sist som singletons
    for (const f of withoutEmb) {
      const { embedding_text, cluster_group_id, ...face } = f;
      data.push({ clusterId: null, faces: [face] });
    }

    // Hämta befintliga (ej avvisade) AI-suggestions för alla unassigned faces
    const allFaceIds = data.flatMap(cl => cl.faces.map(f => f.id));
    if (allFaceIds.length > 0) {
      const { rows: sugRows } = await query(
        `SELECT s.face_id, s.person_id, s.confidence, p.name AS person_name
         FROM ai_suggestions s
         JOIN persons p ON p.id = s.person_id
         WHERE s.face_id = ANY($1::uuid[])
           AND (s.reviewed = FALSE OR s.accepted = TRUE)`,
        [allFaceIds]
      );
      const sugByFaceId = Object.fromEntries(sugRows.map(r => [r.face_id, r]));
      for (const cl of data) {
        const sug = cl.faces.map(f => sugByFaceId[f.id]).find(Boolean);
        if (sug) cl.suggestion = { personId: sug.person_id, personName: sug.person_name, confidence: sug.confidence, faceId: sug.face_id };
      }
    }

    return reply.send({
      data,
      meta: { total_faces: rows.length, total_clusters: clusters.length },
    });
  });

  // POST /api/faces/assign — tilldela ansikten till befintlig eller ny person
  fastify.post('/api/faces/assign', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['faceIds'],
        properties: {
          faceIds:    { type: 'array', items: { type: 'string' }, minItems: 1 },
          personId:   { type: 'string' },
          personName: { type: 'string', minLength: 1 },
          birthYear:  { type: ['integer', 'null'] },
          deathYear:  { type: ['integer', 'null'] },
        },
      },
    },
  }, async (request, reply) => {
    const { faceIds, personId: givenPersonId, personName, birthYear, deathYear } = request.body;

    let personId = givenPersonId ?? null;

    if (!personId && personName?.trim()) {
      // Skapa ny person
      const { rows: ins } = await query(
        `INSERT INTO persons (name, birth_year, death_year)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [personName.trim(), birthYear ?? null, deathYear ?? null]
      );
      personId = ins[0].id;
    } else if (!personId) {
      return reply.status(400).send({ error: 'personId eller personName krävs' });
    }

    // Tilldela alla ansikten
    const placeholders = faceIds.map((_, i) => `$${i + 2}`).join(',');
    await query(
      `UPDATE faces SET person_id = $1 WHERE id IN (${placeholders})`,
      [personId, ...faceIds]
    );

    // Synka XMP för berörda assets
    const xmpPlaceholders = faceIds.map((_, i) => `$${i + 1}`).join(',');
    const { rows: affected } = await query(
      `SELECT DISTINCT asset_id FROM faces WHERE id IN (${xmpPlaceholders})`,
      faceIds
    );
    for (const { asset_id } of affected) {
      syncFacesToFile(asset_id).catch(() => {});
    }

    // Hämta personnamn om vi fick ett ID
    const { rows: personRows } = await query('SELECT name FROM persons WHERE id = $1', [personId]);

    return reply.send({ data: { personId, personName: personRows[0]?.name ?? personName } });
  });

  // PATCH /api/faces/:faceId/dismiss — markera ett ansikte (och hela klustret) som "inte ett ansikte"
  fastify.patch('/api/faces/dismiss', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['faceIds'],
        properties: {
          faceIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { faceIds } = request.body;
    const placeholders = faceIds.map((_, i) => `$${i + 1}`).join(',');
    await query(
      `UPDATE faces SET dismissed = TRUE WHERE id IN (${placeholders})`,
      faceIds
    );
    return reply.send({ data: { ok: true, dismissed: faceIds.length } });
  });

  // PATCH /api/faces/undismiss — ångra avfärdning av ansikten
  fastify.patch('/api/faces/undismiss', {
    onRequest: [fastify.authenticate],
    schema: { body: { type: 'object', required: ['faceIds'], properties: { faceIds: { type: 'array', items: { type: 'string' }, minItems: 1 } } } },
  }, async (request, reply) => {
    const { faceIds } = request.body;
    const placeholders = faceIds.map((_, i) => `$${i + 1}`).join(',');
    await query(`UPDATE faces SET dismissed = FALSE WHERE id IN (${placeholders})`, faceIds);
    return reply.send({ data: { ok: true } });
  });

  // POST /api/faces/compute-suggestions — beräkna AI-förslag för unassigned faces utan suggestion
  fastify.post('/api/faces/compute-suggestions', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { rows: faces } = await query(`
      SELECT f.id, f.embedding::text AS embedding_text
      FROM faces f
      WHERE f.person_id IS NULL AND f.dismissed IS NOT TRUE AND f.embedding IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM ai_suggestions s
          WHERE s.face_id = f.id AND (s.reviewed = FALSE OR s.accepted = TRUE)
        )
      LIMIT 200
    `);

    let computed = 0;
    for (const face of faces) {
      const emb = face.embedding_text.slice(1, -1).split(',').map(Number);
      const match = await findClosestPerson(emb, face.id);
      if (!match) continue;
      await query(
        `INSERT INTO ai_suggestions (face_id, person_id, confidence)
         VALUES ($1, $2, $3)
         ON CONFLICT (face_id) DO UPDATE SET person_id=$2, confidence=$3, reviewed=FALSE, accepted=NULL`,
        [face.id, match.personId, match.confidence]
      );
      computed++;
    }
    return reply.send({ data: { computed } });
  });

  // POST /api/faces/ungroup — lyft ut ett ansikte ur sin kluster-grupp
  fastify.post('/api/faces/ungroup', {
    onRequest: [fastify.authenticate],
    schema: { body: { type: 'object', required: ['faceId'], properties: { faceId: { type: 'string' } } } },
  }, async (request, reply) => {
    const { faceId } = request.body;
    await query('UPDATE faces SET cluster_group_id = NULL WHERE id = $1', [faceId]);
    return reply.send({ data: { ok: true } });
  });

  // POST /api/faces/merge-clusters — slå ihop alla ansikten från ett kluster till ett annat
  fastify.post('/api/faces/merge-clusters', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['fromFaceIds', 'intoFaceIds'],
        properties: {
          fromFaceIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
          intoFaceIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { fromFaceIds, intoFaceIds } = request.body;
    const allIds = [...new Set([...fromFaceIds, ...intoFaceIds])];

    // Återanvänd befintlig cluster_group_id om någon av ansiktena redan har en
    const { rows: existing } = await query(
      `SELECT cluster_group_id FROM faces WHERE id = ANY($1::uuid[]) AND cluster_group_id IS NOT NULL LIMIT 1`,
      [allIds]
    );
    const groupId = existing[0]?.cluster_group_id ?? (await query('SELECT gen_random_uuid() AS id')).rows[0].id;

    await query(
      `UPDATE faces SET cluster_group_id = $1 WHERE id = ANY($2::uuid[])`,
      [groupId, allIds]
    );
    return reply.send({ data: { ok: true, cluster_group_id: groupId } });
  });

  // GET /api/faces/:faceId/thumb — beskuren ansiktsbild för valfritt face-id (ingen auth)
  fastify.get('/api/faces/:faceId/thumb', async (request, reply) => {
    const { faceId } = request.params;
    const { rows } = await query(
      `SELECT f.region_x, f.region_y, f.region_w, f.region_h,
              a.file_path, a.width, a.height
       FROM faces f
       JOIN assets a ON a.id = f.asset_id
       WHERE f.id = $1`,
      [faceId]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Ansikt hittades inte' });

    const { region_x, region_y, region_w, region_h, file_path, width, height } = rows[0];
    const fullPath = path.resolve(config.media.photosPath,file_path);

    // Face coords are stored in display space (after orientation correction).
    // Use display dims: for 90°/270° EXIF rotations (5-8), w/h are swapped.
    const sharpMeta = await sharp(fullPath).metadata();
    const orientation = sharpMeta.orientation ?? 1;
    const isRotated90 = orientation >= 5 && orientation <= 8;
    const dispW = isRotated90 ? (height ?? sharpMeta.height ?? 1000) : (width ?? sharpMeta.width ?? 1000);
    const dispH = isRotated90 ? (width  ?? sharpMeta.width  ?? 1000) : (height ?? sharpMeta.height ?? 1000);

    const left  = Math.max(0, Math.round(region_x * dispW));
    const top   = Math.max(0, Math.round(region_y * dispH));
    const cropW = Math.max(1, Math.round(region_w * dispW));
    const cropH = Math.max(1, Math.round(region_h * dispH));

    reply.header('Content-Type', 'image/webp');
    reply.header('Cache-Control', 'public, max-age=86400');

    const imgBuf = await sharp(fullPath)
      .rotate()
      .extract({ left, top, width: cropW, height: cropH })
      .resize(200, 200, { fit: 'cover' })
      .webp({ quality: 85 })
      .toBuffer();

    return reply.send(imgBuf);
  });

  // GET /api/persons/:id/face-thumb — beskuren ansiktsbild (ingen auth)
  fastify.get('/api/persons/:id/face-thumb', async (request, reply) => {
    const { id } = request.params;
    const { rows } = await query(
      `SELECT f.region_x, f.region_y, f.region_w, f.region_h,
              a.file_path, a.width, a.height
       FROM persons p
       JOIN faces f ON f.id = p.cover_face_id
       JOIN assets a ON a.id = f.asset_id
       WHERE p.id = $1`,
      [id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Ingen profilbild satt' });

    const { region_x, region_y, region_w, region_h, file_path, width, height } = rows[0];
    const fullPath = path.resolve(config.media.photosPath,file_path);

    const sharpMeta = await sharp(fullPath).metadata();
    const orientation = sharpMeta.orientation ?? 1;
    const isRotated90 = orientation >= 5 && orientation <= 8;
    const dispW = isRotated90 ? (height ?? sharpMeta.height ?? 1000) : (width ?? sharpMeta.width ?? 1000);
    const dispH = isRotated90 ? (width  ?? sharpMeta.width  ?? 1000) : (height ?? sharpMeta.height ?? 1000);

    const left  = Math.max(0, Math.round(region_x * dispW));
    const top   = Math.max(0, Math.round(region_y * dispH));
    const cropW = Math.max(1, Math.round(region_w * dispW));
    const cropH = Math.max(1, Math.round(region_h * dispH));

    reply.header('Content-Type', 'image/webp');
    reply.header('Cache-Control', 'public, max-age=86400');

    const imgBuf = await sharp(fullPath)
      .rotate()
      .extract({ left, top, width: cropW, height: cropH })
      .resize(200, 200, { fit: 'cover' })
      .webp({ quality: 85 })
      .toBuffer();

    return reply.send(imgBuf);
  });

  // GET /api/persons/:id — person med bilder
  fastify.get('/api/persons/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit:  { type: 'integer', default: 50 },
          cursor: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { limit = 50, cursor } = request.query;

    const { rows: personRows } = await query(
      `SELECT p.id, p.name, p.birth_year, p.death_year, p.cover_face_id, p.created_at,
              p.external_url, p.notes, p.custom_id,
              (SELECT f.id FROM faces f JOIN assets a ON a.id = f.asset_id AND a.status = 'active'
               WHERE f.person_id = p.id LIMIT 1) AS fallback_face_id
       FROM persons p WHERE p.id = $1`,
      [id]
    );
    if (!personRows[0]) return reply.status(404).send({ error: 'Person hittades inte' });

    const params = [id, limit + 1];
    const cursorCondition = cursor ? `AND a.taken_at < $${params.push(cursor)}` : '';

    const { rows: assets } = await query(
      `SELECT DISTINCT a.id, a.file_name, a.mime_type,
              a.taken_at, a.thumb_small_path, a.thumb_large_path,
              a.location_label,
              ST_Y(a.location::geometry) AS lat,
              ST_X(a.location::geometry) AS lon,
              f.region_x, f.region_y, f.region_w, f.region_h
       FROM faces f
       JOIN assets a ON a.id = f.asset_id
       WHERE f.person_id = $1 AND a.status = 'active' ${cursorCondition}
       ORDER BY a.taken_at DESC NULLS LAST
       LIMIT $2`,
      params
    );

    const hasMore = assets.length > limit;
    const items = hasMore ? assets.slice(0, limit) : assets;

    return reply.send({
      data: { person: personRows[0], assets: items },
      meta: { hasMore, nextCursor: hasMore ? items[items.length - 1].taken_at : null },
    });
  });

  // PATCH /api/persons/:id — uppdatera namn, födelseår, dödsdatum, omslag
  fastify.patch('/api/persons/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          name:        { type: 'string', minLength: 1 },
          birthYear:   { type: ['integer', 'null'] },
          deathYear:   { type: ['integer', 'null'] },
          coverFaceId: { type: 'string' },
          externalUrl: { type: ['string', 'null'] },
          notes:       { type: ['string', 'null'] },
          customId:    { type: ['string', 'null'] },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { name, birthYear, deathYear, coverFaceId, externalUrl, notes, customId } = request.body;
    if (name !== undefined) {
      await query('UPDATE persons SET name = $1 WHERE id = $2', [name, id]);
    }
    if (birthYear !== undefined) {
      await query('UPDATE persons SET birth_year = $1 WHERE id = $2', [birthYear ?? null, id]);
    }
    if (deathYear !== undefined) {
      await query('UPDATE persons SET death_year = $1 WHERE id = $2', [deathYear ?? null, id]);
    }
    if (coverFaceId !== undefined) {
      await query('UPDATE persons SET cover_face_id = $1 WHERE id = $2', [coverFaceId, id]);
    }
    if (externalUrl !== undefined) {
      await query('UPDATE persons SET external_url = $1 WHERE id = $2', [externalUrl ?? null, id]);
    }
    if (notes !== undefined) {
      await query('UPDATE persons SET notes = $1 WHERE id = $2', [notes ?? null, id]);
    }
    if (customId !== undefined) {
      await query('UPDATE persons SET custom_id = $1 WHERE id = $2', [customId ?? null, id]);
    }
    return reply.send({ data: { ok: true } });
  });

  // POST /api/persons/:id/merge/:targetId — slå ihop två personer (bakåtkompatibel)
  fastify.post('/api/persons/:id/merge/:targetId', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id, targetId } = request.params;
    await query('UPDATE faces SET person_id = $1 WHERE person_id = $2', [id, targetId]);
    await query('DELETE FROM persons WHERE id = $1', [targetId]);
    return reply.send({ data: { ok: true } });
  });

  // POST /api/persons/merge — slå ihop flera personer till en
  fastify.post('/api/persons/merge', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['personIds', 'keepId'],
        properties: {
          personIds: { type: 'array', items: { type: 'string' }, minItems: 2 },
          keepId:    { type: 'string' },
          newName:   { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { personIds, keepId, newName } = request.body;
    if (!personIds.includes(keepId)) {
      return reply.status(400).send({ error: 'keepId måste vara med i personIds' });
    }
    const removeIds = personIds.filter((id) => id !== keepId);
    for (const rid of removeIds) {
      await query('UPDATE faces SET person_id = $1 WHERE person_id = $2', [keepId, rid]);
      await query('DELETE FROM persons WHERE id = $1', [rid]);
    }
    if (newName?.trim()) {
      await query('UPDATE persons SET name = $1 WHERE id = $2', [newName.trim(), keepId]);
    }
    return reply.send({ data: { ok: true, keepId } });
  });

  // GET /api/persons/:id/relations — hämta relationer för en person
  fastify.get('/api/persons/:id/relations', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await query(
      `SELECT r.id, r.relation, r.label,
              p.id AS other_id, p.name AS other_name, p.birth_year AS other_birth_year,
              p.cover_face_id, p.death_year AS other_death_year,
              (SELECT f.id FROM faces f JOIN assets a ON a.id = f.asset_id AND a.status = 'active'
               WHERE f.person_id = p.id LIMIT 1) AS fallback_face_id,
              'a_to_b' AS direction
       FROM person_relations r
       JOIN persons p ON p.id = r.person_b
       WHERE r.person_a = $1
       UNION ALL
       SELECT r.id, r.relation, r.label,
              p.id AS other_id, p.name AS other_name, p.birth_year AS other_birth_year,
              p.cover_face_id, p.death_year AS other_death_year,
              (SELECT f.id FROM faces f JOIN assets a ON a.id = f.asset_id AND a.status = 'active'
               WHERE f.person_id = p.id LIMIT 1) AS fallback_face_id,
              'b_to_a' AS direction
       FROM person_relations r
       JOIN persons p ON p.id = r.person_a
       WHERE r.person_b = $1
       ORDER BY relation, other_name`,
      [id]
    );
    return reply.send({ data: rows });
  });

  // POST /api/persons/:id/relations — lägg till relation
  fastify.post('/api/persons/:id/relations', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['otherPersonId', 'relation'],
        properties: {
          otherPersonId: { type: 'string' },
          relation:      { type: 'string', enum: ['parent', 'child', 'sibling', 'partner', 'other'] },
          label:         { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { otherPersonId, relation, label } = request.body;
    const { rows } = await query(
      `INSERT INTO person_relations (person_a, person_b, relation, label)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (person_a, person_b, relation) DO UPDATE SET label = EXCLUDED.label
       RETURNING id`,
      [id, otherPersonId, relation, label ?? null]
    );
    return reply.status(201).send({ data: { id: rows[0].id } });
  });

  // DELETE /api/persons/relations/:relationId — ta bort en relation
  fastify.delete('/api/persons/relations/:relationId', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    await query('DELETE FROM person_relations WHERE id = $1', [request.params.relationId]);
    return reply.send({ data: { ok: true } });
  });

  // POST /api/faces — skapa ny ansiktsregion (manuell taggning)
  fastify.post('/api/faces', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['assetId', 'regionX', 'regionY', 'regionW', 'regionH'],
        properties: {
          assetId:    { type: 'string' },
          personId:   { type: 'string' },
          personName: { type: 'string' },
          regionX:    { type: 'number' },
          regionY:    { type: 'number' },
          regionW:    { type: 'number' },
          regionH:    { type: 'number' },
        },
      },
    },
  }, async (request, reply) => {
    const { assetId, personId: pid, personName, regionX, regionY, regionW, regionH } = request.body;

    let personId = pid ?? null;
    if (!personId && personName?.trim()) {
      const existing = await query('SELECT id FROM persons WHERE name = $1', [personName.trim()]);
      if (existing.rows[0]) {
        personId = existing.rows[0].id;
      } else {
        const ins = await query('INSERT INTO persons (name) VALUES ($1) RETURNING id', [personName.trim()]);
        personId = ins.rows[0].id;
      }
    }

    const { rows } = await query(
      `INSERT INTO faces (asset_id, person_id, source, region_x, region_y, region_w, region_h)
       VALUES ($1, $2, 'manual', $3, $4, $5, $6) RETURNING id`,
      [assetId, personId, regionX, regionY, regionW, regionH]
    );

    const { rows: personRows } = personId
      ? await query('SELECT id, name FROM persons WHERE id = $1', [personId])
      : { rows: [null] };

    syncFacesToFile(assetId).catch(() => {});

    return reply.status(201).send({ data: {
      faceId: rows[0].id, personId, personName: personRows[0]?.name ?? null,
      regionX, regionY, regionW, regionH,
    }});
  });

  // DELETE /api/faces/:id — ta bort ansiktsregion
  fastify.delete('/api/faces/:id', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { rows } = await query(
      'DELETE FROM faces WHERE id = $1 RETURNING id, asset_id, person_id, source, region_x, region_y, region_w, region_h',
      [request.params.id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Ansikt hittades inte' });
    syncFacesToFile(rows[0].asset_id).catch(() => {});
    return reply.send({ data: rows[0] });
  });

  // GET /api/faces/:assetId — hämta alla ansiktsregioner för en bild
  fastify.get('/api/faces/:assetId', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { rows } = await query(
      `SELECT f.id, f.person_id, f.source,
              f.region_x, f.region_y, f.region_w, f.region_h,
              p.name AS person_name, p.birth_year
       FROM faces f
       LEFT JOIN persons p ON p.id = f.person_id
       WHERE f.asset_id = $1`,
      [request.params.assetId]
    );
    return reply.send({ data: rows });
  });

  // PATCH /api/faces/:id — tilldela ett ansikte till en person
  fastify.patch('/api/faces/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          personId:   { type: 'string' },
          personName: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    let { personId, personName } = request.body;

    if (!personId && personName) {
      const { rows } = await query(
        `INSERT INTO persons (name) VALUES ($1)
         ON CONFLICT DO NOTHING RETURNING id`,
        [personName.trim()]
      );
      personId = rows[0]?.id;
      if (!personId) {
        const { rows: ex } = await query('SELECT id FROM persons WHERE name = $1', [personName.trim()]);
        personId = ex[0]?.id;
      }
    }

    await query('UPDATE faces SET person_id = $1 WHERE id = $2', [personId ?? null, id]);
    const { rows: faceAsset } = await query('SELECT asset_id FROM faces WHERE id = $1', [id]);
    if (faceAsset[0]) syncFacesToFile(faceAsset[0].asset_id).catch(() => {});
    return reply.send({ data: { ok: true, personId } });
  });
}
