import sharp from 'sharp';
import ExifReader from 'exifr';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { isRaw } from '../services/metadataService.js';

const THUMB_SMALL = 400;   // px bred, proportionell höjd
const THUMB_LARGE = 1200;

// Extraherar inbäddad JPEG-preview ur en RAW-fil via exifr.
// Returnerar sökväg till en temporär fil, eller null om ingen preview hittades.
async function extractRawPreview(filePath) {
  try {
    const buf = await ExifReader.thumbnail(filePath);
    if (!buf || buf.byteLength === 0) return null;
    const tmpPath = join(tmpdir(), `raw-preview-${uuidv4()}.jpg`);
    await writeFile(tmpPath, Buffer.from(buf));
    return tmpPath;
  } catch {
    return null;
  }
}

export async function generateThumbnails(assetId, sourceFilePath, mimeType) {
  const dir = join(config.media.thumbsPath, assetId);
  await mkdir(dir, { recursive: true });

  const smallPath = join(dir, 'small.webp');
  const largePath = join(dir, 'large.webp');

  let workPath = sourceFilePath;
  let tmpPreview = null;

  if (isRaw(mimeType)) {
    tmpPreview = await extractRawPreview(sourceFilePath);
    if (!tmpPreview) {
      console.warn(`Ingen inbäddad preview i RAW-fil: ${sourceFilePath}`);
      return { smallPath: null, largePath: null };
    }
    workPath = tmpPreview;
  }

  const sharpInstance = sharp(workPath, { failOn: 'none' });

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

  if (tmpPreview) await unlink(tmpPreview).catch(() => {});

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
