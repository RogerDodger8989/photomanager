import { stat, open } from 'fs/promises';
import { join, resolve, dirname, basename } from 'path';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { logAudit } from '../services/authService.js';

// Hittar startpositionen för den inbäddade MP4:an i en Samsung/Google Motion Photo JPEG.
//
// Samsung GContainer-format (nyare):
//   <Container:Item Item:Mime="video/mp4" Item:Length="2356890" .../>
//   → videoStart = fileSize - 2356890
//
// Google MicroVideo-format (äldre):
//   GCamera:MicroVideoOffset="2356890"
//   → videoStart = fileSize - 2356890
//
// Båda formaten anger hur många bytes från slutet av filen videon börjar.
// Gemensam hjälpfunktion: extrahera ett positivt tal från XMP som är rimligt som videostorlek.
function xmpVideoLen(str, fileSize) {
  const n = parseInt(str, 10);
  // Videodelen av en Motion Photo är vanligtvis 1 MB–11 MB (minst 10 % av filen, max 95 %).
  return n >= 1_000_000 && n < fileSize * 0.95 ? n : null;
}

async function findMotionVideoOffset(filePath, fileSize) {
  try {
    // === Steg 1: XMP-baserad sökning ===
    // Läs de första 128 KB (XMP-metadata är alltid i JPEG APP1-markören, max 65 535 bytes).
    const readSize = Math.min(131072, fileSize);
    const fd = await open(filePath, 'r');
    const buf = Buffer.alloc(readSize);
    const { bytesRead } = await fd.read(buf, 0, readSize, 0);
    await fd.close();
    const xmp = buf.subarray(0, bytesRead).toString('latin1');

    // 1a. GContainer: specifikt Item:Semantic="MotionPhoto" + Item:Length (korrektast)
    for (const m of xmp.matchAll(/Item:Semantic=["']MotionPhoto["'][^<]{0,400}?Item:Length=["'](\d+)["']/gs)) {
      const vl = xmpVideoLen(m[1], fileSize);
      if (vl) { console.log(`Motion Photo XMP (GContainer Semantic): offset=${fileSize-vl}`); return fileSize - vl; }
    }
    // Omvänd ordning i XMP: Item:Length innan Semantic
    for (const m of xmp.matchAll(/Item:Length=["'](\d+)["'][^<]{0,400}?Item:Semantic=["']MotionPhoto["']/gs)) {
      const vl = xmpVideoLen(m[1], fileSize);
      if (vl) { console.log(`Motion Photo XMP (GContainer rev): offset=${fileSize-vl}`); return fileSize - vl; }
    }
    // 1b. GContainer: Item:Mime="video/..." + Item:Length
    for (const m of xmp.matchAll(/Item:Mime=["']video\/[^"']+["'][^<]{0,400}?Item:Length=["'](\d+)["']/gs)) {
      const vl = xmpVideoLen(m[1], fileSize);
      if (vl) { console.log(`Motion Photo XMP (GContainer Mime): offset=${fileSize-vl}`); return fileSize - vl; }
    }
    // 1c. Google MicroVideo: MicroVideoOffset="<bytes-from-end>"
    for (const m of xmp.matchAll(/MicroVideoOffset=["'](\d+)["']/g)) {
      const vl = xmpVideoLen(m[1], fileSize);
      if (vl) { console.log(`Motion Photo XMP (MicroVideoOffset): offset=${fileSize-vl}`); return fileSize - vl; }
    }

    // === Steg 2: Binär sökning efter MP4 ftyp-box ===
    // Samsung/OnePlus Motion Photos: JPEG-data följt direkt av råa MP4-bytes.
    // Varje MP4 börjar med: [4-bytes box-size][4-bytes "ftyp"][4-bytes brand]...
    // Vi scannar de sista 10 MB och letar efter ftyp med känt MP4-brand.
    // Kravet att videoSize > 1 MB filtrerar bort falska träffar i JPEG-komprimerad data.
    const KNOWN_MP4_BRANDS = new Set([
      'isom', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4A ', 'f4v ',
      'qt  ', 'MSNV', 'heic', 'mif1', 'crx ', '3gp4', '3gp5',
    ]);
    const scanWindow = Math.min(10 * 1024 * 1024, fileSize);
    const scanOff   = fileSize - scanWindow;
    const fd2       = await open(filePath, 'r');
    const scanBuf   = Buffer.alloc(scanWindow);
    const { bytesRead: sb } = await fd2.read(scanBuf, 0, scanWindow, scanOff);
    await fd2.close();

    const ftypMagic = Buffer.from([0x66, 0x74, 0x79, 0x70]); // 'ftyp'
    let idx = scanBuf.indexOf(ftypMagic, 4);
    while (idx !== -1 && idx < sb - 8) {
      const boxSize    = scanBuf.readUInt32BE(idx - 4);
      const brand      = scanBuf.subarray(idx + 4, idx + 8).toString('ascii');
      const videoStart = scanOff + idx - 4;
      const videoSize  = fileSize - videoStart;
      if (boxSize >= 8 && boxSize <= 512 && KNOWN_MP4_BRANDS.has(brand) && videoSize >= 1_000_000) {
        console.log(`Motion Photo ftyp via binär scan: offset=${videoStart} brand=${brand} videoSize=${videoSize}`);
        return videoStart;
      }
      idx = scanBuf.indexOf(ftypMagic, idx + 1);
    }

    console.warn(`findMotionVideoOffset: ingen offset hittad i ${filePath}`);
  } catch (err) {
    console.error('findMotionVideoOffset fel:', err.message);
  }
  return -1;
}

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
      filePath = resolve(config.media.photosPath,asset.file_path);
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

    const filePath = resolve(config.media.photosPath,asset.file_path);

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

  // GET /api/assets/:id/live-video — streamar tillhörande Live Photo-video (.mov/.mp4 med samma basename)
  fastify.get('/api/assets/:id/live-video', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;

    const { rows } = await query(
      `SELECT live_video_path FROM assets WHERE id = $1 AND status = 'active'`,
      [id]
    );
    const asset = rows[0];
    if (!asset?.live_video_path) {
      return reply.status(404).send({ error: 'Ingen Live Photo-video' });
    }

    const filePath = resolve(config.media.photosPath, asset.live_video_path);
    let fileSize;
    try {
      const s = await stat(filePath);
      fileSize = s.size;
    } catch {
      return reply.status(404).send({ error: 'Videofil ej tillgänglig' });
    }

    const rangeHeader = request.headers['range'];
    const contentType = asset.live_video_path.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4';

    if (!rangeHeader) {
      reply.header('Content-Type', contentType);
      reply.header('Content-Length', fileSize);
      reply.header('Accept-Ranges', 'bytes');
      const fd = await open(filePath, 'r');
      return reply.send(fd.createReadStream());
    }

    const [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-');
    const start = parseInt(startStr, 10);
    const end   = endStr ? parseInt(endStr, 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize || start > end) {
      reply.header('Content-Range', `bytes */${fileSize}`);
      return reply.status(416).send({ error: 'Range not satisfiable' });
    }

    reply.status(206);
    reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Length', end - start + 1);
    reply.header('Content-Type', contentType);

    const fd = await open(filePath, 'r');
    return reply.send(fd.createReadStream({ start, end }));
  });

  // GET /api/assets/:id/motion-video — extraherar och streamar den inbäddade MP4:an i en Motion Photo
  fastify.get('/api/assets/:id/motion-video', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;

    const { rows } = await query(
      `SELECT file_path, trash_path, is_motion_photo FROM assets
       WHERE id = $1 AND status IN ('active', 'trashed')`,
      [id]
    );
    const asset = rows[0];
    if (!asset || !asset.is_motion_photo) {
      return reply.status(404).send({ error: 'Ingen Motion Photo-video' });
    }

    // Trashade filer: använd trash_path (absolut) om det finns, annars file_path
    let filePath = asset.trash_path
      ? asset.trash_path
      : resolve(config.media.photosPath,asset.file_path);
    let fileSize;
    try {
      const s = await stat(filePath);
      fileSize = s.size;
    } catch {
      // Fallback: filen kan ha hamnat i .trash utan att trash_path uppdaterades
      const trashFallback = join(dirname(filePath), '.trash', basename(filePath));
      try {
        const s2 = await stat(trashFallback);
        fileSize = s2.size;
        filePath = trashFallback;
      } catch {
        return reply.status(404).send({ error: 'Fil ej tillgänglig' });
      }
    }

    // Hitta starten på den inbäddade MP4:an
    const videoStart = await findMotionVideoOffset(filePath, fileSize);
    if (videoStart < 0 || videoStart >= fileSize) {
      return reply.status(404).send({ error: 'Kunde inte extrahera video' });
    }

    const videoSize = fileSize - videoStart;
    const rangeHeader = request.headers['range'];

    if (!rangeHeader) {
      reply.header('Content-Type', 'video/mp4');
      reply.header('Content-Length', videoSize);
      reply.header('Accept-Ranges', 'bytes');
      const fd = await open(filePath, 'r');
      return reply.send(fd.createReadStream({ start: videoStart, end: fileSize - 1 }));
    }

    const [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-');
    const relStart = parseInt(startStr, 10);
    const relEnd   = endStr ? parseInt(endStr, 10) : videoSize - 1;

    if (relStart >= videoSize || relEnd >= videoSize || relStart > relEnd) {
      reply.header('Content-Range', `bytes */${videoSize}`);
      return reply.status(416).send({ error: 'Range not satisfiable' });
    }

    const absStart = videoStart + relStart;
    const absEnd   = videoStart + relEnd;
    reply.status(206);
    reply.header('Content-Range', `bytes ${relStart}-${relEnd}/${videoSize}`);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Length', relEnd - relStart + 1);
    reply.header('Content-Type', 'video/mp4');
    const fd = await open(filePath, 'r');
    return reply.send(fd.createReadStream({ start: absStart, end: absEnd }));
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
    await query('UPDATE shares SET view_count = view_count + 1, last_viewed_at = NOW() WHERE token = $1', [token]);

    // Återanvänd streaming-logiken via intern redirect
    request.params.id = share.id;

    // Sätt ett temporärt user-objekt för logging
    request.user = { id: null };
    return reply.redirect(`/api/assets/${share.id}/stream`);
  });
}
