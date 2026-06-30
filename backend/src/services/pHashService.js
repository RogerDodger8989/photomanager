import sharp from 'sharp';
import { join } from 'path';
import { config } from '../config.js';
import { query } from '../db/pool.js';

/**
 * Beräknar ett dHash (difference hash) — 64 bitar.
 * Jämför angränsande pixlar horisontellt i en 9×8 grayscale-resize.
 * Returnerar ett signed BigInt (int64) redo att lagras som PostgreSQL BIGINT.
 */
export async function computePHash(imagePath) {
  const { data } = await sharp(imagePath, { failOn: 'none' })
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = 0n;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left  = data[row * 9 + col];
      const right = data[row * 9 + col + 1];
      hash = (hash << 1n) | (left < right ? 1n : 0n);
    }
  }
  // Konvertera till signed int64 (two's complement) för PostgreSQL BIGINT
  return BigInt.asIntN(64, hash);
}

/**
 * Beräknar och lagrar pHash för ett asset.
 * Använder den lilla thumbnail-filen om den finns, annars originalfilen.
 */
export async function computeAndStorePHash(assetId, originalPath) {
  const thumbPath = join(config.media.thumbsPath, assetId, 'small.webp');

  let sourcePath = thumbPath;
  try {
    // Kontrollera att thumbnail finns (kan saknas vid fel)
    const { access } = await import('fs/promises');
    await access(thumbPath);
  } catch {
    sourcePath = originalPath;
  }

  try {
    const hash = await computePHash(sourcePath);
    await query('UPDATE assets SET phash = $1 WHERE id = $2', [hash.toString(), assetId]);
  } catch (err) {
    console.warn(`pHash misslyckades för ${assetId}:`, err.message);
  }
}

/**
 * Beräknar Hamming-distansen mellan två pHash-värden.
 * Används för JS-sida jämförelse av enstaka par.
 */
export function hammingDistance(a, b) {
  let tmp = BigInt.asUintN(64, BigInt(a) ^ BigInt(b));
  let count = 0;
  while (tmp !== 0n) { tmp &= tmp - 1n; count++; }
  return count;
}
