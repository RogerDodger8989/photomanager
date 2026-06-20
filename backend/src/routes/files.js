import { query } from '../db/pool.js';
import { rename, copyFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { basename, join, dirname, relative } from 'path';
import { config } from '../config.js';

function toRelPath(absolutePath) {
  const root = config.media.photosPath.replace(/\\/g, '/').replace(/\/$/, '');
  const abs  = absolutePath.replace(/\\/g, '/').replace(/\/$/, '');
  return relative(root, abs).replace(/\\/g, '/');
}

export default async function filesRoutes(fastify) {

  // GET /api/folders/tree — bevakade mappar + undermappar (alla inloggade)
  fastify.get('/api/folders/tree', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';

    const { rows: folders } = await query(
      `SELECT path, label, status FROM watched_folders ORDER BY path`
    );

    // Unika mappar per bevakad mapp — groupera på directory-delen av file_path
    // file_path är relativ till photosPath; source_folder är absolut
    const { rows: dirs } = await query(
      `SELECT
         source_folder,
         regexp_replace(file_path, '/[^/]+$', '') AS file_dir,
         COUNT(*)::int AS cnt
       FROM assets
       WHERE status = 'active'
         AND ($1 OR owner_id = $2)
       GROUP BY source_folder, file_dir
       ORDER BY source_folder, file_dir`,
      [isAdmin, userId]
    );

    // Beräkna relativa sökvägar i JS (undviker problem med absolut source_folder vs relativ file_path)
    const photosRoot = config.media.photosPath.replace(/\\/g, '/').replace(/\/$/, '');

    const result = folders.map((wf) => {
      // Relativ sökväg för denna bevakade mapp (samma format som file_path i DB)
      const relWf = relative(photosRoot, wf.path.replace(/\\/g, '/')).replace(/\\/g, '/');

      const myDirs    = dirs.filter((d) => d.source_folder === wf.path);
      const totalCount = myDirs.reduce((s, d) => s + d.cnt, 0);

      // Expandera leaf-sökvägar till alla mellannivåer
      const pathCounts = new Map();
      myDirs.forEach((d) => {
        const fileDir = (d.file_dir ?? '').replace(/\\/g, '/');
        // Beräkna sökvägen relativt till bevakad mapp
        let relDir;
        if (fileDir === relWf) {
          relDir = ''; // filen ligger direkt i bevakad mapp
        } else if (fileDir.startsWith(relWf + '/')) {
          relDir = fileDir.slice(relWf.length + 1);
        } else {
          return; // hör inte till denna bevakade mapp
        }
        if (!relDir) return;
        const parts = relDir.split('/');
        parts.forEach((_, i) => {
          const p = parts.slice(0, i + 1).join('/');
          pathCounts.set(p, (pathCounts.get(p) || 0) + Number(d.cnt));
        });
      });

      const subfolders = [...pathCounts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, cnt]) => ({ path, label: path.split('/').pop(), assetCount: cnt }));

      return {
        watchedFolder: wf.path,
        label: wf.label || wf.path.split('/').pop(),
        status: wf.status,
        totalAssetCount: totalCount,
        subfolders,
      };
    });

    return reply.send({ data: result });
  });

  // POST /api/files/move — flytta filer på disk och uppdatera databasen
  fastify.post('/api/files/move', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['assetIds', 'targetFolder'],
        properties: {
          assetIds:     { type: 'array', items: { type: 'string' }, minItems: 1 },
          targetFolder: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { assetIds, targetFolder } = request.body;
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';

    // Validera: målmappen måste vara en bevakad mapp
    const { rows: wfRows } = await query(
      'SELECT path FROM watched_folders WHERE path = $1', [targetFolder]
    );
    if (!wfRows.length) {
      return reply.status(400).send({ error: 'Målmappen är inte en bevakad mapp' });
    }

    if (!existsSync(targetFolder)) {
      return reply.status(400).send({ error: 'Målmappen finns inte på disk' });
    }

    const { rows: assets } = await query(
      `SELECT id, file_path, source_folder FROM assets
       WHERE id = ANY($1::uuid[])
         AND status = 'active'
         AND ($2 OR owner_id = $3)`,
      [assetIds, isAdmin, userId]
    );

    if (assets.length === 0) {
      return reply.status(404).send({ error: 'Inga filer hittades' });
    }

    const errors = [];
    const moved  = [];

    for (const asset of assets) {
      const fileName = basename(asset.file_path);
      const newPath  = join(targetFolder, fileName);

      if (asset.file_path === newPath) continue;

      if (existsSync(newPath)) {
        errors.push({ id: asset.id, error: `Fil med samma namn finns redan: ${fileName}` });
        continue;
      }

      try {
        await rename(asset.file_path, newPath);
      } catch (err) {
        if (err.code === 'EXDEV') {
          // Korsenhetsflytt: kopiera + ta bort
          await copyFile(asset.file_path, newPath);
          await unlink(asset.file_path);
        } else {
          errors.push({ id: asset.id, error: err.message });
          continue;
        }
      }

      await query(
        `UPDATE assets SET file_path = $1, source_folder = $2 WHERE id = $3`,
        [newPath, targetFolder, asset.id]
      );
      moved.push(asset.id);
    }

    return reply.send({ data: { moved, errors } });
  });

  // POST /api/files/create-folder — skapar en ny undermapp på disk
  fastify.post('/api/files/create-folder', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['parentPath', 'folderName'],
        properties: {
          parentPath: { type: 'string', minLength: 1 },
          folderName: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { parentPath, folderName } = request.body;
    const isAdmin = request.user.role === 'admin';
    if (!isAdmin) return reply.status(403).send({ error: 'Kräver admin' });

    const { rows: wfRows } = await query('SELECT path FROM watched_folders');
    const isWatched = wfRows.some((wf) => parentPath.startsWith(wf.path + '/') || parentPath === wf.path);
    if (!isWatched) return reply.status(400).send({ error: 'Föräldern är inte under en bevakad mapp' });

    if (!existsSync(parentPath)) return reply.status(404).send({ error: 'Föräldermappen finns inte på disk' });

    const safeName = folderName.replace(/[/\\]/g, '').replace(/^\.*$/, '').trim();
    if (!safeName) return reply.status(400).send({ error: 'Ogiltigt mappnamn' });

    const newPath = join(parentPath, safeName);
    if (existsSync(newPath)) return reply.status(409).send({ error: 'En mapp med det namnet finns redan' });

    await mkdir(newPath, { recursive: true });

    return reply.send({ data: { path: newPath } });
  });

  // PATCH /api/files/rename-folder — byter namn på en undermapp på disk + uppdaterar DB
  fastify.patch('/api/files/rename-folder', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['oldPath', 'newName'],
        properties: {
          oldPath: { type: 'string', minLength: 1 },
          newName: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { oldPath, newName } = request.body;
    const isAdmin = request.user.role === 'admin';
    if (!isAdmin) return reply.status(403).send({ error: 'Kräver admin' });

    // Validera att oldPath är under en bevakad mapp
    const { rows: wfRows } = await query('SELECT path FROM watched_folders');
    const isWatched = wfRows.some((wf) => oldPath.startsWith(wf.path + '/') || oldPath === wf.path);
    if (!isWatched) return reply.status(400).send({ error: 'Mappen är inte under en bevakad mapp' });

    if (!existsSync(oldPath)) return reply.status(404).send({ error: 'Mappen finns inte på disk' });

    // Sanitera nytt namn — inga slashar eller .
    const safeName = newName.replace(/[/\\]/g, '').replace(/^\.*$/, '').trim();
    if (!safeName) return reply.status(400).send({ error: 'Ogiltigt mappnamn' });

    const newPath = join(dirname(oldPath), safeName);
    if (existsSync(newPath)) return reply.status(409).send({ error: 'Ett mappnamn med det namnet finns redan' });

    await rename(oldPath, newPath);

    // file_path i DB är relativ till photosPath — konvertera sökvägar
    const relOld = toRelPath(oldPath);
    const relNew = toRelPath(newPath);
    await query(
      `UPDATE assets SET
         file_path     = $2 || substring(file_path from length($1)+1),
         source_folder = CASE WHEN source_folder = $3 THEN $4 ELSE source_folder END
       WHERE file_path LIKE $5`,
      [relOld, relNew, oldPath, newPath, relOld + '/%']
    );

    return reply.send({ data: { oldPath, newPath } });
  });

  // POST /api/files/move-folder — flyttar en undermapp till en annan bevakad mapp
  fastify.post('/api/files/move-folder', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['folderPath', 'targetRoot'],
        properties: {
          folderPath: { type: 'string', minLength: 1 },
          targetRoot: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { folderPath, targetRoot } = request.body;
    const isAdmin = request.user.role === 'admin';
    if (!isAdmin) return reply.status(403).send({ error: 'Kräver admin' });

    const { rows: wfRows } = await query('SELECT path FROM watched_folders WHERE path = $1', [targetRoot]);
    if (!wfRows.length) return reply.status(400).send({ error: 'Målmappen är inte en bevakad mapp' });

    if (!existsSync(folderPath)) return reply.status(404).send({ error: 'Källmappen finns inte' });
    if (!existsSync(targetRoot)) return reply.status(400).send({ error: 'Målmappen finns inte på disk' });

    const folderName = basename(folderPath);
    const newPath = join(targetRoot, folderName);
    if (existsSync(newPath)) return reply.status(409).send({ error: 'En mapp med samma namn finns redan i målmappen' });

    try {
      await rename(folderPath, newPath);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      // Cross-device: rekursiv kopiera + ta bort (enkel implementation)
      return reply.status(400).send({ error: 'Flytt mellan enheter stöds inte för mappar' });
    }

    // file_path i DB är relativ till photosPath — konvertera sökvägar
    const relOld = toRelPath(folderPath);
    const relNew = toRelPath(newPath);
    await query(
      `UPDATE assets SET
         file_path     = $2 || substring(file_path from length($1)+1),
         source_folder = $3
       WHERE file_path LIKE $4`,
      [relOld, relNew, targetRoot, relOld + '/%']
    );

    return reply.send({ data: { folderPath, newPath } });
  });

  // POST /api/files/trash-folder — skickar alla foton i mappen till papperskorgen
  fastify.post('/api/files/trash-folder', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['folderPath'],
        properties: {
          folderPath: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { folderPath } = request.body;
    const isAdmin = request.user.role === 'admin';
    if (!isAdmin) return reply.status(403).send({ error: 'Kräver admin' });

    const { rows: wfRows } = await query('SELECT path FROM watched_folders');
    const isWatched = wfRows.some((wf) => folderPath.startsWith(wf.path + '/') || folderPath === wf.path);
    if (!isWatched) return reply.status(400).send({ error: 'Mappen är inte under en bevakad mapp' });

    const relFolder = toRelPath(folderPath);
    const { rows } = await query(
      `UPDATE assets SET status = 'trashed', trashed_at = NOW()
       WHERE file_path LIKE $1 AND status = 'active'
       RETURNING id`,
      [relFolder + '/%']
    );

    return reply.send({ data: { trashedCount: rows.length } });
  });
}
