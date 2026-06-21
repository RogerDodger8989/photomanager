import { createWriteStream, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { join, extname } from 'path';
import { pipeline } from 'stream/promises';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { logAudit } from '../services/authService.js';
import { computeFileHash } from '../services/hashService.js';

// Tillåtna MIME-typer
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'image/heic', 'image/heif', 'image/tiff',
  // RAW-format
  'image/x-canon-cr2', 'image/x-canon-cr3',
  'image/x-nikon-nef',
  'image/x-sony-arw',
  'image/x-adobe-dng',
  'image/x-olympus-orf',
  'image/x-panasonic-rw2',
  'image/x-fujifilm-raf',
  'image/x-pentax-pef',
  // Video
  'video/mp4', 'video/quicktime', 'video/x-msvideo',
  'video/x-matroska', 'video/mpeg',
]);

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB

export default async function uploadRoutes(fastify) {

  // POST /api/upload — ladda upp en eller flera filer
  fastify.post('/api/upload', {
    onRequest: [fastify.authenticate],
    config: { bodyLimit: MAX_FILE_SIZE },
  }, async (request, reply) => {
    const parts = request.parts({ limits: { fileSize: MAX_FILE_SIZE } });
    const uploaded = [];
    const errors   = [];

    // Valfri subfolder skickas som form-fält
    let subfolder = '';

    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'subfolder') {
        // Sanera subfolder: inga .. eller absoluta sökvägar
        subfolder = part.value
          .replace(/\.\./g, '')
          .replace(/^\/+/, '')
          .replace(/[<>:"|?*]/g, '')
          .slice(0, 200);
        continue;
      }

      if (part.type !== 'file') continue;

      const mime = part.mimetype;
      if (!ALLOWED_MIME.has(mime)) {
        await part.file.resume(); // konsumera strömmen
        errors.push(`${part.filename}: filtyp ej tillåten (${mime})`);
        continue;
      }

      // Unikt filnamn för att undvika konflikter
      const ext      = extname(part.filename) || '.bin';
      const safeName = `${uuidv4()}${ext}`;
      const destDir  = subfolder
        ? join(config.media.photosPath, subfolder)
        : config.media.photosPath;

      mkdirSync(destDir, { recursive: true });
      const destPath = join(destDir, safeName);

      try {
        await pipeline(part.file, createWriteStream(destPath));

        uploaded.push({ original: part.filename, saved: safeName });
      } catch (err) {
        errors.push(`${part.filename}: ${err.message}`);
      }
    }

    await logAudit(request.user.id, 'upload', null, request.ip, request.headers['user-agent']);

    return reply.send({
      data: { uploaded, errors },
      meta: { count: uploaded.length },
    });
  });

}
