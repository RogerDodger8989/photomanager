import { stat, open } from 'fs/promises';
import { join } from 'path';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { logAudit } from '../services/authService.js';

export default async function streamRoutes(fastify) {

  // GET /api/assets/:id/stream
  // Stöder HTTP Range requests så att videospelaren kan söka i filmen
  fastify.get('/api/assets/:id/stream', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;

    const { rows } = await query(
      `SELECT file_path, mime_type, file_size, transcoded_path, transcode_status
       FROM assets WHERE id = $1 AND status = 'active'`,
      [id]
    );

    const asset = rows[0];
    if (!asset) return reply.status(404).send({ error: 'Hittades inte' });

    // Välj källa: transkodad MP4 om tillgänglig, annars original
    let filePath;
    let contentType;

    if (asset.transcoded_path && asset.transcode_status === 'done') {
      filePath = join(config.media.transcodePath, asset.transcoded_path);
      contentType = 'video/mp4';
    } else {
      filePath = join(config.media.photosPath, asset.file_path);
      contentType = asset.mime_type ?? 'application/octet-stream';
    }

    // Hämta faktisk filstorlek (kan skilja från DB om transkodad)
    let fileSize;
    try {
      const s = await stat(filePath);
      fileSize = s.size;
    } catch {
      return reply.status(404).send({ error: 'Mediafil ej tillgänglig' });
    }

    const rangeHeader = request.headers['range'];

    if (!rangeHeader) {
      // Ingen range — skicka hela filen
      reply.header('Content-Type', contentType);
      reply.header('Content-Length', fileSize);
      reply.header('Accept-Ranges', 'bytes');
      const fd = await open(filePath, 'r');
      return reply.send(fd.createReadStream());
    }

    // Parse: "bytes=start-end"
    const [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-');
    const start = parseInt(startStr, 10);
    const end   = endStr ? parseInt(endStr, 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize || start > end) {
      reply.header('Content-Range', `bytes */${fileSize}`);
      return reply.status(416).send({ error: 'Range not satisfiable' });
    }

    const chunkSize = end - start + 1;

    reply.status(206); // Partial Content
    reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Length', chunkSize);
    reply.header('Content-Type', contentType);

    const fd = await open(filePath, 'r');
    return reply.send(fd.createReadStream({ start, end }));
  });

  // GET /api/assets/:id/original — ladda ner originalfil
  fastify.get('/api/assets/:id/original', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;

    const { rows } = await query(
      "SELECT file_path, file_name, mime_type FROM assets WHERE id = $1 AND status = 'active'",
      [id]
    );

    const asset = rows[0];
    if (!asset) return reply.status(404).send({ error: 'Hittades inte' });

    const filePath = join(config.media.photosPath, asset.file_path);

    let fileSize;
    try {
      const s = await stat(filePath);
      fileSize = s.size;
    } catch {
      return reply.status(404).send({ error: 'Fil ej tillgänglig' });
    }

    await logAudit(request.user.id, 'download', id, 'asset', null, request.ip);

    reply.header('Content-Disposition', `attachment; filename="${asset.file_name}"`);
    reply.header('Content-Type', asset.mime_type ?? 'application/octet-stream');
    reply.header('Content-Length', fileSize);

    const fd = await open(filePath, 'r');
    return reply.send(fd.createReadStream());
  });

  // GET /share/:token/stream — streaming för publika delade videolänkar
  fastify.get('/share/:token/stream', async (request, reply) => {
    const { token } = request.params;

    const { rows } = await query(
      `SELECT a.id, a.file_path, a.mime_type, a.transcoded_path, a.transcode_status,
              s.expires_at, s.max_views, s.view_count
       FROM shares s
       JOIN assets a ON a.id = s.asset_id
       WHERE s.token = $1 AND s.share_type = 'public_link' AND a.status = 'active'`,
      [token]
    );

    const share = rows[0];
    if (!share) return reply.status(404).send({ error: 'Länk hittades inte' });

    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return reply.status(410).send({ error: 'Länken har gått ut' });
    }

    if (share.max_views && share.view_count >= share.max_views) {
      return reply.status(410).send({ error: 'Länkens maxvisningar uppnått' });
    }

    // Öka vy-räknaren för delningen
    await query('UPDATE shares SET view_count = view_count + 1 WHERE token = $1', [token]);

    // Återanvänd streaming-logiken via intern redirect
    request.params.id = share.id;

    // Sätt ett temporärt user-objekt för logging
    request.user = { id: null };
    return reply.redirect(`/api/assets/${share.id}/stream`);
  });
}
