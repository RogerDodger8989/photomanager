// Fixar taken_at och file_created_at för befintliga assets
import { stat } from 'fs/promises';
import { join } from 'path';
import { pool } from './pool.js';
import { config } from '../config.js';

const EPOCH = new Date('1970-01-02');

function parseDateFromFilename(name) {
  const patterns = [
    /(\d{4})(\d{2})(\d{2})[\s_\-T]?(\d{2})(\d{2})(\d{2})/,
    /(\d{4})[.\-](\d{2})[.\-](\d{2})[\s_T](\d{2})[.:h](\d{2})[.:m](\d{2})/,
  ];
  for (const re of patterns) {
    const m = name.match(re);
    if (!m) continue;
    const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
    const dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
    if (!isNaN(dt.getTime()) && dt.getFullYear() > 1900 && dt.getFullYear() <= new Date().getFullYear() + 1) {
      return dt;
    }
  }
  return null;
}

const { rows } = await pool.query(
  `SELECT id, file_name, file_path, taken_at, file_created_at FROM assets`
);

let updated = 0;
for (const row of rows) {
  let newTakenAt     = row.taken_at;
  let newCreatedAt   = row.file_created_at;
  let changed        = false;

  // Försök hämta mtime från disk
  let mtime = null;
  try {
    const absPath = join(config.media.photosPath, row.file_path);
    const s = await stat(absPath);
    if (s.mtime > EPOCH) mtime = s.mtime;
  } catch {}

  // Fixa file_created_at om det är epoch
  if (!newCreatedAt || new Date(newCreatedAt) < EPOCH) {
    newCreatedAt = mtime ?? null;
    if (newCreatedAt) changed = true;
  }

  // Fixa taken_at om det saknas
  if (!newTakenAt) {
    newTakenAt = parseDateFromFilename(row.file_name) ?? mtime ?? null;
    if (newTakenAt) changed = true;
  }

  if (changed) {
    await pool.query(
      `UPDATE assets SET taken_at = $1, file_created_at = $2 WHERE id = $3`,
      [newTakenAt, newCreatedAt, row.id]
    );
    console.log(`Uppdaterade ${row.file_name}: taken_at=${newTakenAt?.toISOString() ?? 'null'}`);
    updated++;
  }
}

console.log(`\nKlart — uppdaterade ${updated} av ${rows.length} assets.`);
await pool.end();
