import { existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { query } from '../db/pool.js';
import { addWatchedFolder, removeWatchedFolder, getWatchedPaths } from '../workers/fileWatcher.js';

export default async function foldersAdminRoutes(fastify) {

  // Alla routes kräver admin
  fastify.addHook('onRequest', fastify.requireAdmin);

  // GET /api/admin/browse?path=/ — bläddra i serverns filsystem
  fastify.get('/api/admin/browse', async (request, reply) => {
    const rawPath = (request.query.path || '/').toString();

    // Förhindra path traversal — normalisera utan resolve() som kan misslyckas
    const safePath = ('/' + rawPath.replace(/\.\./g, '').replace(/\/+/g, '/')).replace(/(.+)\/$/, '$1') || '/';

    if (!existsSync(safePath)) {
      return reply.status(404).send({ error: `Mappen finns inte: ${safePath}` });
    }

    let dirs = [];
    try {
      dirs = readdirSync(safePath, { withFileTypes: true })
        .filter((d) => {
          try { return d.isDirectory() && !d.name.startsWith('.'); } catch { return false; }
        })
        .map((d) => ({ name: d.name, path: `${safePath === '/' ? '' : safePath}/${d.name}` }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      // Åtkomst nekad till mapp — returnera tom lista
    }

    const parent = safePath === '/' ? null : safePath.substring(0, safePath.lastIndexOf('/')) || '/';

    return reply.send({ data: { path: safePath, parent, dirs } });
  });

  // GET /api/admin/watched-folders
  fastify.get('/api/admin/watched-folders', async (request, reply) => {
    const { rows } = await query(
      `SELECT wf.*, u.username AS added_by_username
       FROM watched_folders wf
       LEFT JOIN users u ON u.id = wf.added_by
       ORDER BY wf.created_at ASC`
    );

    // Standardmappen visas alltid överst
    const activePaths = getWatchedPaths();
    return reply.send({ data: rows, meta: { activePaths } });
  });

  // POST /api/admin/watched-folders — lägg till mapp
  fastify.post('/api/admin/watched-folders', {
    schema: {
      body: {
        type: 'object',
        required: ['path'],
        properties: {
          path:  { type: 'string', minLength: 1 },
          label: { type: 'string', default: '' },
        },
      },
    },
  }, async (request, reply) => {
    const { path: folderPath, label = '' } = request.body;

    // Sanera sökvägen mot path traversal
    if (folderPath.includes('..')) {
      return reply.status(400).send({ error: 'Ogiltig sökväg' });
    }

    if (!existsSync(folderPath)) {
      return reply.status(400).send({
        error: `Mappen finns inte: ${folderPath}. Kontrollera att den är monterad i Docker.`,
      });
    }

    const { rows } = await query(
      `INSERT INTO watched_folders (path, label, added_by, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (path) DO UPDATE SET label = $2, enabled = true
       RETURNING *`,
      [folderPath, label, request.user.id]
    );

    // Starta bevakning direkt
    try {
      await addWatchedFolder(folderPath);
    } catch (err) {
      await query(
        `UPDATE watched_folders SET status = 'error', error_msg = $1 WHERE path = $2`,
        [err.message, folderPath]
      );
      return reply.status(400).send({ error: err.message });
    }

    return reply.status(201).send({ data: rows[0] });
  });

  // PATCH /api/admin/watched-folders/:id — aktivera/inaktivera
  fastify.patch('/api/admin/watched-folders/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          label:   { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { enabled, label } = request.body;

    const { rows } = await query(
      `UPDATE watched_folders
       SET enabled  = COALESCE($1, enabled),
           label    = COALESCE($2, label)
       WHERE id = $3
       RETURNING *`,
      [enabled, label, id]
    );
    if (!rows.length) return reply.status(404).send({ error: 'Inte hittad' });

    const folder = rows[0];
    if (enabled === false) {
      await removeWatchedFolder(folder.path);
    } else if (enabled === true && existsSync(folder.path)) {
      await addWatchedFolder(folder.path);
    }

    return reply.send({ data: folder });
  });

  // DELETE /api/admin/watched-folders/:id — ta bort mapp
  fastify.delete('/api/admin/watched-folders/:id', async (request, reply) => {
    const { id } = request.params;
    const { rows } = await query(
      `DELETE FROM watched_folders WHERE id = $1 RETURNING path`,
      [id]
    );
    if (!rows.length) return reply.status(404).send({ error: 'Inte hittad' });

    await removeWatchedFolder(rows[0].path);
    return reply.status(204).send();
  });

}
