import { pool } from './pool.js';
const { rows: [asset] } = await pool.query(
  `SELECT id FROM assets WHERE file_name='IMG20250416171406.jpg'`
);
const { rows } = await pool.query(
  `SELECT source, key, value FROM asset_metadata WHERE asset_id=$1 ORDER BY source, key`, [asset.id]
);
// Visa bara exif-rader med numeriska nycklar (TIFF-taggar)
const exif = rows.filter(r => r.source === 'exif');
console.log('EXIF keys:', JSON.stringify(exif.map(r => ({k: r.key, v: r.value})), null, 2));
await pool.end();
