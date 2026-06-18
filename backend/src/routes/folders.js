import { existsSync, readdirSync } from 'fs';
import { query } from '../db/pool.js';
import { addWatchedFolder, removeWatchedFolder, getWatchedPaths } from '../workers/fileWatcher.js';
import { mountCifsShare, unmountShare } from '../services/mountService.js';

export default async function foldersAdminRoutes(fastify) {

  fastify.addHook('onRequest', fastify.requireAdmin);

  // GET /api/admin/browse?path=/ — bläddra i serverns filsystem
  fastify.get('/api/admin/browse', async (request, reply) => {
    const rawPath  = (request.query.path || '/').toString();
    const safePath = ('/' + rawPath.replace(/\.\./g, '').replace(/\/+/g, '/')).replace(/(.+)\/$/, '$1') || '/';

    if (!existsSync(safePath)) {
      return reply.status(404).send({ error: `Mappen finns inte: ${safePath}` });
    }

    let dirs = [];
    try {
      dirs = readdirSync(safePath, { withFileTypes: true })
        .filter((d) => { try { return d.isDirectory() && !d.name.startsWith('.'); } catch { return false; } })
        .map((d) => ({ name: d.name, path: `${safePath === '/' ? '' : safePath}/${d.name}` }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {}

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
    const activePaths = getWatchedPaths();
    return reply.send({ data: rows, meta: { activePaths } });
  });

  // POST /api/admin/watched-folders — lägg till lokal mapp
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
    if (folderPath.includes('..')) return reply.status(400).send({ error: 'Ogiltig sökväg' });

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

    try {
      await addWatchedFolder(folderPath);
    } catch (err) {
      await query(`UPDATE watched_folders SET status = 'error', error_msg = $1 WHERE path = $2`, [err.message, folderPath]);
      return reply.status(400).send({ error: err.message });
    }

    return reply.status(201).send({ data: rows[0] });
  });

  // POST /api/admin/watched-folders/mount — montera nätverksresurs (CIFS/SMB) och bevaka
  fastify.post('/api/admin/watched-folders/mount', {
    schema: {
      body: {
        type: 'object',
        required: ['uncPath', 'mountName'],
        properties: {
          uncPath:    { type: 'string', minLength: 3 },
          mountName:  { type: 'string', minLength: 1 },
          username:   { type: 'string', default: '' },
          password:   { type: 'string', default: '' },
          label:      { type: 'string', default: '' },
        },
      },
    },
  }, async (request, reply) => {
    const { uncPath, mountName, username = '', password = '', label = '' } = request.body;

    // Sanitera mount-punkt-namn (bara alfanumeriskt, bindestreck, understreck)
    const safeName = mountName.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64);
    if (!safeName) return reply.status(400).send({ error: 'Ogiltigt mount-namn' });

    const mountPoint = `/mnt/${safeName}`;
    const folderLabel = label || safeName;

    // Montera nätverksresursen
    try {
      await mountCifsShare({ uncPath, mountPoint, username: username || null, password: password || null });
    } catch (err) {
      const msg = err.stderr || err.message || 'Montering misslyckades';
      return reply.status(400).send({ error: formatMountError(msg) });
    }

    // Spara i databasen
    const { rows } = await query(
      `INSERT INTO watched_folders (path, label, added_by, status, mount_type, unc_path, cifs_username, cifs_password)
       VALUES ($1, $2, $3, 'pending', 'cifs', $4, $5, $6)
       ON CONFLICT (path) DO UPDATE
         SET label = $2, enabled = true, unc_path = $4, cifs_username = $5, cifs_password = $6
       RETURNING *`,
      [mountPoint, folderLabel, request.user.id, uncPath, username || null, password || null]
    );

    try {
      await addWatchedFolder(mountPoint);
    } catch (err) {
      await query(`UPDATE watched_folders SET status = 'error', error_msg = $1 WHERE path = $2`, [err.message, mountPoint]);
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
       SET enabled = COALESCE($1, enabled), label = COALESCE($2, label)
       WHERE id = $3 RETURNING *`,
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

  // DELETE /api/admin/watched-folders/:id — ta bort mapp (+ unmonta om CIFS)
  fastify.delete('/api/admin/watched-folders/:id', async (request, reply) => {
    const { id } = request.params;
    const { rows } = await query(
      `DELETE FROM watched_folders WHERE id = $1 RETURNING path, mount_type`,
      [id]
    );
    if (!rows.length) return reply.status(404).send({ error: 'Inte hittad' });

    const { path: folderPath, mount_type } = rows[0];
    await removeWatchedFolder(folderPath);
    if (mount_type === 'cifs') {
      await unmountShare(folderPath);
    }

    return reply.status(204).send();
  });
}

function formatMountError(raw) {
  if (raw.includes('No such host')) return 'Servern hittades inte. Kontrollera sökvägen.';
  if (raw.includes('Permission denied') || raw.includes('EACCES')) return 'Åtkomst nekad. Kontrollera användarnamn och lösenord.';
  if (raw.includes('No route to host')) return 'Kan inte nå servern. Kontrollera nätverket.';
  if (raw.includes('Connection timed out')) return 'Anslutningen tog för lång tid. Kontrollera att servern är igång.';
  if (raw.includes('mount error(13)') || raw.includes('13)')) return 'Fel lösenord eller nekad åtkomst.';
  if (raw.includes('mount error(2)')) return 'Delningen hittades inte på servern.';
  if (raw.includes('mount error(112)')) return 'Servern är inte tillgänglig.';
  return raw.split('\n')[0].replace(/^mount error.*?: /, '');
}
