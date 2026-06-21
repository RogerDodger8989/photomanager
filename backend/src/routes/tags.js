import { query } from '../db/pool.js';
import {
  buildPersonPath,
  buildYearPath,
  buildPath,
  looksLikeYear,
  updatePathRecursive,
  getTagTree,
} from '../services/tagPathService.js';

/** Returnerar true om path är "Personer" eller börjar med "Personer/" */
function isUnderPersoner(path) {
  const p = (path ?? '').toLowerCase();
  return p === 'personer' || p.startsWith('personer/');
}

export default async function tagsRoutes(fastify) {

  // ── GET /api/tags/tree — hela hierarkin som nestlat JSON ─────────────────
  fastify.get('/api/tags/tree', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';
    const tree = await getTagTree(userId, isAdmin);
    return reply.send({ data: tree });
  });

  // ── GET /api/tags/stats ────────────────────────────────────────────────────
  fastify.get('/api/tags/stats', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { rows } = await query(`
      SELECT
        COUNT(*)::int                                              AS total,
        COUNT(*) FILTER (WHERE is_face_tag)::int                  AS face_tags,
        COUNT(*) FILTER (WHERE parent_id IS NULL)::int            AS root_tags,
        COUNT(*) FILTER (WHERE id NOT IN (
          SELECT DISTINCT parent_id FROM tags WHERE parent_id IS NOT NULL
        ))::int                                                    AS leaf_tags,
        COUNT(*) FILTER (WHERE id NOT IN (
          SELECT DISTINCT tag_id FROM asset_tags
        ))::int                                                    AS unused_tags
      FROM tags
    `);
    return reply.send({ data: rows[0] });
  });

  // ── GET /api/tags/unused ───────────────────────────────────────────────────
  fastify.get('/api/tags/unused', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { rows } = await query(`
      SELECT t.id, t.name, t.path, t.color
      FROM tags t
      WHERE t.id NOT IN (SELECT DISTINCT tag_id FROM asset_tags)
      ORDER BY t.path
    `);
    return reply.send({ data: rows });
  });

  // ── GET /api/tags/duplicates — likartade taggnamn via trigram ─────────────
  fastify.get('/api/tags/duplicates', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { rows } = await query(`
      SELECT a.id AS id_a, a.name AS name_a, a.path AS path_a,
             b.id AS id_b, b.name AS name_b, b.path AS path_b,
             similarity(a.name, b.name) AS sim
      FROM tags a
      JOIN tags b ON a.id < b.id AND similarity(a.name, b.name) > 0.7
      ORDER BY sim DESC
      LIMIT 50
    `);
    return reply.send({ data: rows });
  });

  // ── GET /api/tags/auto-suggest?q= — smart auto-taggning (A) ──────────────
  fastify.get('/api/tags/auto-suggest', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        required: ['q'],
        properties: { q: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { q } = request.query;
    const { rows } = await query(`
      SELECT id, name, path, color,
             similarity(name, $1) AS sim
      FROM tags
      WHERE name ILIKE '%' || $1 || '%'
         OR similarity(name, $1) > 0.3
      ORDER BY
        CASE WHEN name ILIKE $1 || '%' THEN 0
             WHEN name ILIKE '%' || $1 || '%' THEN 1
             ELSE 2 END,
        sim DESC
      LIMIT 12
    `, [q]);
    return reply.send({ data: rows });
  });

  // ── GET /api/tags/:id/assets — assets för en tagg ─────────────────────────
  fastify.get('/api/tags/:id/assets', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          limit:  { type: 'integer', default: 50, minimum: 1, maximum: 200 },
          offset: { type: 'integer', default: 0, minimum: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { limit = 50, offset = 0 } = request.query;
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';

    const { rows } = await query(`
      SELECT a.id, a.file_name, a.thumb_small_path, a.thumb_large_path,
             a.taken_at, a.mime_type,
             COUNT(*) OVER() AS total_count
      FROM assets a
      JOIN asset_tags at2 ON at2.asset_id = a.id
      WHERE at2.tag_id = $1
        AND a.status = 'active'
        AND ($4 OR a.owner_id = $3)
      ORDER BY a.taken_at DESC NULLS LAST
      LIMIT $2 OFFSET $5
    `, [id, limit, userId, isAdmin, offset]);

    const total = Number(rows[0]?.total_count ?? 0);
    return reply.send({ data: { rows, total } });
  });

  // ── POST /api/tags — skapa ny tagg ────────────────────────────────────────
  fastify.post('/api/tags', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name:      { type: 'string', minLength: 1 },
          parent_id: { type: 'string', nullable: true },
          is_face_tag: { type: 'boolean' },
          birth_year:  { type: 'integer', nullable: true },
          death_year:  { type: 'integer', nullable: true },
        },
      },
    },
  }, async (request, reply) => {
    let { name, parent_id = null, is_face_tag = false, birth_year = null, death_year = null } = request.body;
    const normalizedName = name.trim();

    let parentPath = null;
    if (parent_id) {
      const { rows: parentRows } = await query('SELECT path FROM tags WHERE id = $1', [parent_id]);
      parentPath = parentRows[0]?.path ?? null;
    }

    // Taggar under "Personer" (eller djupare) ärver automatiskt person-inställningar
    if (parentPath && isUnderPersoner(parentPath)) {
      is_face_tag = true;
    }

    let path;
    if (is_face_tag) {
      path = buildPersonPath(normalizedName, birth_year, death_year).path;
    } else if (looksLikeYear(normalizedName) && !parent_id) {
      path = buildYearPath(normalizedName);
    } else {
      path = buildPath(normalizedName, parentPath);
    }

    const { rows } = await query(`
      INSERT INTO tags (name, path, parent_id, is_face_tag, export_only_leaf, show_lifespan, export_synonyms, birth_year, death_year)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (path) DO UPDATE SET
        name             = EXCLUDED.name,
        parent_id        = COALESCE(EXCLUDED.parent_id, tags.parent_id),
        is_face_tag      = EXCLUDED.is_face_tag,
        export_only_leaf = EXCLUDED.export_only_leaf,
        show_lifespan    = EXCLUDED.show_lifespan,
        export_synonyms  = EXCLUDED.export_synonyms
      RETURNING *
    `, [normalizedName, path, parent_id, is_face_tag,
        is_face_tag, is_face_tag, !is_face_tag,   // export_only_leaf, show_lifespan, export_synonyms
        birth_year, death_year]);

    return reply.code(201).send({ data: rows[0] });
  });

  // ── PATCH /api/tags/:id — redigera tagg ───────────────────────────────────
  fastify.patch('/api/tags/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          name:             { type: 'string', minLength: 1 },
          parent_id:        { type: 'string', nullable: true },
          color:            { type: 'string', nullable: true },
          icon_thumb:       { type: 'string', nullable: true },
          is_face_tag:      { type: 'boolean' },
          export_only_leaf: { type: 'boolean' },
          show_lifespan:    { type: 'boolean' },
          birth_year:       { type: 'integer', nullable: true },
          death_year:       { type: 'integer', nullable: true },
          sort_order:       { type: 'integer' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;

    const { rows: existing } = await query('SELECT * FROM tags WHERE id = $1', [id]);
    if (!existing.length) return reply.code(404).send({ error: 'Tagg hittades inte' });
    const tag = existing[0];

    // Kontrollera om ny (eller befintlig) förälder är under "Personer"
    const effectiveParentId = body.parent_id !== undefined ? body.parent_id : tag.parent_id;
    let parentUnderPersoner = false;
    if (effectiveParentId) {
      const { rows: pRows } = await query('SELECT path FROM tags WHERE id = $1', [effectiveParentId]);
      parentUnderPersoner = isUnderPersoner(pRows[0]?.path ?? '');
    }

    const updated = {
      name:             body.name             !== undefined ? body.name.trim()              : tag.name,
      parent_id:        body.parent_id        !== undefined ? body.parent_id                : tag.parent_id,
      color:            body.color            !== undefined ? body.color                    : tag.color,
      icon_thumb:       body.icon_thumb       !== undefined ? body.icon_thumb               : tag.icon_thumb,
      is_face_tag:      parentUnderPersoner ? true : (body.is_face_tag !== undefined ? body.is_face_tag : tag.is_face_tag),
      export_only_leaf: parentUnderPersoner ? true : (body.export_only_leaf !== undefined ? body.export_only_leaf : tag.export_only_leaf),
      show_lifespan:    parentUnderPersoner ? true : (body.show_lifespan    !== undefined ? body.show_lifespan    : tag.show_lifespan),
      export_synonyms:  parentUnderPersoner ? false : (body.export_synonyms !== undefined ? body.export_synonyms : (tag.export_synonyms ?? true)),
      birth_year:       body.birth_year       !== undefined ? body.birth_year               : tag.birth_year,
      death_year:       body.death_year       !== undefined ? body.death_year               : tag.death_year,
      sort_order:       body.sort_order       !== undefined ? body.sort_order               : tag.sort_order,
    };

    // Bygg ny path om namn/förälder/livstid ändrats
    const displayName = body.name ? body.name.trim() : tag.name;
    let newPath;
    if (updated.is_face_tag) {
      newPath = buildPersonPath(displayName, updated.birth_year, updated.death_year).path;
    } else if (updated.parent_id) {
      const { rows: pRows } = await query('SELECT path FROM tags WHERE id = $1', [updated.parent_id]);
      newPath = buildPath(displayName, pRows[0]?.path ?? null);
    } else if (looksLikeYear(displayName)) {
      newPath = buildYearPath(displayName);
    } else {
      newPath = displayName;
    }

    const { rows: result } = await query(`
      UPDATE tags SET
        name = $1, path = $2, parent_id = $3, color = $4, icon_thumb = $5,
        is_face_tag = $6, export_only_leaf = $7, show_lifespan = $8,
        birth_year = $9, death_year = $10, sort_order = $11, export_synonyms = $12
      WHERE id = $13
      RETURNING *
    `, [
      updated.name, newPath, updated.parent_id, updated.color, updated.icon_thumb,
      updated.is_face_tag, updated.export_only_leaf, updated.show_lifespan,
      updated.birth_year, updated.death_year, updated.sort_order, updated.export_synonyms, id,
    ]);

    // Synkronisera birth_year/death_year till kopplad person om det är en face tag
    if (updated.is_face_tag && (body.birth_year !== undefined || body.death_year !== undefined)) {
      await query(`
        UPDATE persons SET birth_year = $1, death_year = $2
        WHERE name = $3 AND (birth_year IS DISTINCT FROM $1 OR death_year IS DISTINCT FROM $2)
      `, [updated.birth_year, updated.death_year, updated.name]);
    }

    // Uppdatera barn-noder rekursivt om path ändrades
    if (newPath !== tag.path) {
      const { rows: children } = await query('SELECT id, name FROM tags WHERE parent_id = $1', [id]);
      for (const child of children) {
        await updatePathRecursive(child.id, `${newPath}/${child.name}`);
      }
    }

    return reply.send({ data: result[0] });
  });

  // ── DELETE /api/tags/:id — radera tagg ────────────────────────────────────
  fastify.delete('/api/tags/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: { cascade: { type: 'boolean', default: false } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { cascade = false } = request.query;

    // Spara undo-data (namn, parent_id, asset_ids)
    const { rows: tagRows } = await query('SELECT * FROM tags WHERE id = $1', [id]);
    if (!tagRows.length) return reply.code(404).send({ error: 'Tagg hittades inte' });

    const { rows: assetIds } = await query(
      'SELECT asset_id FROM asset_tags WHERE tag_id = $1', [id]
    );

    if (!cascade && assetIds.length > 0) {
      return reply.code(409).send({
        error: `Taggen används på ${assetIds.length} bilder. Använd ?cascade=true för att ta bort ändå.`,
        assetCount: assetIds.length,
      });
    }

    await query('DELETE FROM tags WHERE id = $1', [id]);

    return reply.send({
      data: { deleted: true },
      undo: {
        tag: tagRows[0],
        assetIds: assetIds.map((r) => r.asset_id),
      },
    });
  });

  // ── POST /api/tags/merge — slå ihop taggar ────────────────────────────────
  fastify.post('/api/tags/merge', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['sourceId', 'targetId'],
        properties: {
          sourceId: { type: 'string' },
          targetId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { sourceId, targetId } = request.body;

    // Flytta alla asset_tags från source till target (hoppa över dubletter)
    await query(`
      INSERT INTO asset_tags (asset_id, tag_id)
      SELECT asset_id, $2 FROM asset_tags WHERE tag_id = $1
      ON CONFLICT DO NOTHING
    `, [sourceId, targetId]);

    // Flytta barn i hierarkin
    await query('UPDATE tags SET parent_id = $2 WHERE parent_id = $1', [sourceId, targetId]);

    const { rows: sourceRows } = await query('SELECT name FROM tags WHERE id = $1', [sourceId]);
    await query('DELETE FROM tags WHERE id = $1', [sourceId]);

    return reply.send({ data: { merged: true, sourceName: sourceRows[0]?.name } });
  });

  // ── POST /api/tags/:id/move — flytta i hierarkin ─────────────────────────
  fastify.post('/api/tags/:id/move', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: { newParentId: { type: 'string', nullable: true } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { newParentId = null } = request.body;

    const { rows: tagRows } = await query('SELECT name FROM tags WHERE id = $1', [id]);
    if (!tagRows.length) return reply.code(404).send({ error: 'Tagg hittades inte' });

    let parentPath = null;
    if (newParentId) {
      const { rows: pRows } = await query('SELECT path FROM tags WHERE id = $1', [newParentId]);
      parentPath = pRows[0]?.path ?? null;
    }

    const newPath = buildPath(tagRows[0].name, parentPath);
    await query('UPDATE tags SET parent_id = $1 WHERE id = $2', [newParentId, id]);
    await updatePathRecursive(id, newPath);

    return reply.send({ data: { moved: true, newPath } });
  });

  // ── POST /api/tags/:id/face-tag — märk som ansiktstagg ───────────────────
  fastify.post('/api/tags/:id/face-tag', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { rows: tagRows } = await query('SELECT * FROM tags WHERE id = $1', [id]);
    if (!tagRows.length) return reply.code(404).send({ error: 'Tagg hittades inte' });

    const tag = tagRows[0];
    const { path: newPath } = buildPersonPath(tag.name, tag.birth_year, tag.death_year);
    await query(
      'UPDATE tags SET is_face_tag = TRUE, path = $1, parent_id = NULL WHERE id = $2',
      [newPath, id]
    );
    await updatePathRecursive(id, newPath);

    return reply.send({ data: { id, is_face_tag: true, path: newPath } });
  });

  // ── GET /api/tags/export — exportera taggar ───────────────────────────────
  fastify.get('/api/tags/export', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['json', 'csv', 'xmp'], default: 'json' },
          ids:    { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { format = 'json', ids } = request.query;
    const idList = ids ? ids.split(',').filter(Boolean) : null;

    const where = idList?.length ? `WHERE t.id = ANY($1::uuid[])` : '';
    const params = idList?.length ? [idList] : [];

    const { rows } = await query(`
      SELECT t.id, t.name, t.path, t.color, t.is_face_tag, t.export_only_leaf,
             t.show_lifespan, t.birth_year, t.death_year, t.parent_id, t.sort_order,
             COUNT(at2.asset_id)::int AS asset_count
      FROM tags t
      LEFT JOIN asset_tags at2 ON at2.tag_id = t.id
      ${where}
      GROUP BY t.id
      ORDER BY t.path
    `, params);

    if (format === 'json') {
      reply.header('Content-Disposition', 'attachment; filename="tags.json"');
      reply.header('Content-Type', 'application/json');
      return reply.send(JSON.stringify({
        version: 1,
        exported: new Date().toISOString(),
        tags: rows,
      }, null, 2));
    }

    if (format === 'csv') {
      reply.header('Content-Disposition', 'attachment; filename="tags.csv"');
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      const header = 'path,name,color,is_face_tag,birth_year,death_year,asset_count\n';
      const body = rows.map((r) =>
        `"${r.path}","${r.name}","${r.color ?? ''}",${r.is_face_tag},${r.birth_year ?? ''},${r.death_year ?? ''},${r.asset_count}`
      ).join('\n');
      return reply.send(header + body);
    }

    // XMP-format (en rad per tagg, exporterar leaf-namn om export_only_leaf)
    reply.header('Content-Disposition', 'attachment; filename="tags.txt"');
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    const lines = rows.map((r) => r.export_only_leaf ? r.name : r.path);
    return reply.send(lines.join('\n'));
  });

  // ── POST /api/tags/import — importera taggar ──────────────────────────────
  fastify.post('/api/tags/import', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          onConflict: { type: 'string', enum: ['skip', 'merge', 'overwrite'], default: 'skip' },
        },
      },
    },
  }, async (request, reply) => {
    const { onConflict = 'skip' } = request.query;
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'Ingen fil uppladdad' });

    const buf = await data.toBuffer();
    const text = buf.toString('utf8');
    let tags;

    try {
      const parsed = JSON.parse(text);
      tags = parsed.tags ?? parsed;
    } catch {
      // Försök CSV
      const lines = text.split('\n').filter(Boolean);
      const header = lines[0]?.split(',').map((h) => h.replace(/"/g, '').trim());
      tags = lines.slice(1).map((line) => {
        const vals = line.split(',');
        /** @type {Record<string, any>} */
        const obj = {};
        header?.forEach((h, i) => { obj[h] = vals[i]?.replace(/"/g, '').trim(); });
        return obj;
      });
    }

    let created = 0, skipped = 0, updated = 0;

    for (const tag of tags) {
      const name = (tag.name ?? '').trim();
      if (!name) continue;

      const path = tag.path ?? name;
      const { rows: existing } = await query('SELECT id FROM tags WHERE name = $1', [name]);

      if (existing.length) {
        if (onConflict === 'skip') { skipped++; continue; }
        if (onConflict === 'overwrite') {
          await query(
            'UPDATE tags SET path=$1, color=$2, is_face_tag=$3, birth_year=$4, death_year=$5 WHERE name=$6',
            [path, tag.color || null, Boolean(tag.is_face_tag), tag.birth_year || null, tag.death_year || null, name]
          );
          updated++;
        } else {
          skipped++;
        }
        continue;
      }

      await query(
        'INSERT INTO tags (name, path, color, is_face_tag, birth_year, death_year) VALUES ($1,$2,$3,$4,$5,$6)',
        [name, path, tag.color || null, Boolean(tag.is_face_tag), tag.birth_year || null, tag.death_year || null]
      );
      created++;
    }

    return reply.send({ data: { created, updated, skipped } });
  });

  // ── GET /api/folder-tag-rules ─────────────────────────────────────────────
  fastify.get('/api/folder-tag-rules', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { rows } = await query(`
      SELECT ftr.id, ftr.pattern, ftr.match_type, ftr.created_at,
             t.id AS tag_id, t.name AS tag_name, t.path AS tag_path, t.color AS tag_color
      FROM folder_tag_rules ftr
      JOIN tags t ON t.id = ftr.tag_id
      ORDER BY ftr.created_at DESC
    `);
    return reply.send({ data: rows });
  });

  // ── POST /api/folder-tag-rules ────────────────────────────────────────────
  fastify.post('/api/folder-tag-rules', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['pattern', 'tagId'],
        properties: {
          pattern:    { type: 'string', minLength: 1 },
          tagId:      { type: 'string' },
          match_type: { type: 'string', enum: ['folder_name', 'folder_name_contains', 'folder_path_contains', 'glob'], default: 'folder_name' },
        },
      },
    },
  }, async (request, reply) => {
    const { pattern, tagId, match_type = 'folder_name' } = request.body;
    const { rows } = await query(
      'INSERT INTO folder_tag_rules (pattern, tag_id, match_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *',
      [pattern.trim(), tagId, match_type]
    );
    return reply.code(201).send({ data: rows[0] });
  });

  // ── DELETE /api/folder-tag-rules/:id ─────────────────────────────────────
  fastify.delete('/api/folder-tag-rules/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (request, reply) => {
    await query('DELETE FROM folder_tag_rules WHERE id = $1', [request.params.id]);
    return reply.send({ data: { deleted: true } });
  });

  // ── GET /api/tags/synonyms/:tagId ─────────────────────────────────────────
  fastify.get('/api/tags/synonyms/:tagId', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { tagId: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { rows } = await query(
      'SELECT id, synonym FROM tag_synonyms WHERE tag_id = $1 ORDER BY synonym',
      [request.params.tagId]
    );
    return reply.send({ data: rows });
  });

  // ── POST /api/tags/synonyms — lägg till synonym ───────────────────────────
  fastify.post('/api/tags/synonyms', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['tagId', 'synonym'],
        properties: {
          tagId:   { type: 'string' },
          synonym: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { tagId, synonym } = request.body;
    const val = synonym.trim();
    const { rows } = await query(
      `INSERT INTO tag_synonyms (tag_id, synonym) VALUES ($1, $2)
       ON CONFLICT (tag_id, synonym) DO UPDATE SET synonym = EXCLUDED.synonym
       RETURNING *`,
      [tagId, val]
    );
    if (!rows[0]) return reply.code(409).send({ error: 'Synonymen finns redan' });
    return reply.code(201).send({ data: rows[0] });
  });

  // ── DELETE /api/tags/synonyms/:id ─────────────────────────────────────────
  fastify.delete('/api/tags/synonyms/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (request, reply) => {
    await query('DELETE FROM tag_synonyms WHERE id = $1', [request.params.id]);
    return reply.send({ data: { deleted: true } });
  });
}
