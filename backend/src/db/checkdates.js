import { pool } from './pool.js';

const { rows } = await pool.query(
  `SELECT file_name, taken_at, file_created_at, mime_type
   FROM assets ORDER BY indexed_at DESC LIMIT 10`
);
console.log(JSON.stringify(rows, null, 2));
await pool.end();
