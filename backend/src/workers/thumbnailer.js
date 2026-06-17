import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from '../config.js';
import { query } from '../db/pool.js';

const THUMB_SMALL = 400;   // px bred, proportionell höjd
const THUMB_LARGE = 1200;

export async function generateThumbnails(assetId, sourceFilePath, mimeType) {
  const dir = join(config.media.thumbsPath, assetId);
  await mkdir(dir, { recursive: true });

  const smallPath = join(dir, 'small.webp');
  const largePath = join(dir, 'large.webp');

  const sharpInstance = sharp(sourceFilePath, { failOn: 'none' });

  // HEIC/HEIF hanteras automatiskt av sharp/libvips
  // Rotera korrekt baserat på EXIF-orientering
  const base = sharpInstance.rotate();

  await Promise.all([
    base.clone()
      .resize(THUMB_SMALL, THUMB_SMALL, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(smallPath),

    base.clone()
      .resize(THUMB_LARGE, THUMB_LARGE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toFile(largePath),
  ]);

  // Relativa sökvägar (relativa från thumbsPath-roten)
  const relSmall = `${assetId}/small.webp`;
  const relLarge = `${assetId}/large.webp`;

  await query(
    'UPDATE assets SET thumb_small_path = $1, thumb_large_path = $2 WHERE id = $3',
    [relSmall, relLarge, assetId]
  );

  return { smallPath: relSmall, largePath: relLarge };
}

export async function generateVideoThumbnail(assetId, screenshotPath) {
  // screenshotPath = PNG skapad av FFmpeg (se transcoder.js)
  const dir = join(config.media.thumbsPath, assetId);
  await mkdir(dir, { recursive: true });

  const smallPath = join(dir, 'small.webp');
  const largePath = join(dir, 'large.webp');

  await Promise.all([
    sharp(screenshotPath)
      .resize(THUMB_SMALL, THUMB_SMALL, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(smallPath),

    sharp(screenshotPath)
      .resize(THUMB_LARGE, THUMB_LARGE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toFile(largePath),
  ]);

  const relSmall = `${assetId}/small.webp`;
  const relLarge = `${assetId}/large.webp`;

  await query(
    'UPDATE assets SET thumb_small_path = $1, thumb_large_path = $2 WHERE id = $3',
    [relSmall, relLarge, assetId]
  );

  return { smallPath: relSmall, largePath: relLarge };
}
