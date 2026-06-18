import { pool } from './pool.js';

const { rows } = await pool.query(
  `INSERT INTO jobs (job_type, asset_id)
   SELECT 'thumbnail', id FROM assets WHERE thumb_small_path IS NULL
   RETURNING id`
);
console.log(`Skapade ${rows.length} thumbnail-jobb`);
await pool.end();
