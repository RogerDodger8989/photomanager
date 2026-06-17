import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { query } from '../db/pool.js';

export function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export async function findDuplicateByHash(hash) {
  const { rows } = await query(
    "SELECT id, file_path FROM assets WHERE file_hash = $1 AND status != 'deleted' LIMIT 1",
    [hash]
  );
  return rows[0] ?? null;
}
