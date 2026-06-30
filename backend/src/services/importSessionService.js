import { query } from '../db/pool.js';
import { v4 as uuidv4 } from 'uuid';

export async function createSession(source, sourcePath = null) {
  const { rows } = await query(
    `INSERT INTO import_sessions (id, source, source_path)
     VALUES ($1, $2, $3) RETURNING id`,
    [uuidv4(), source, sourcePath],
  );
  return rows[0].id;
}

export async function recordResult(sessionId, outcome) {
  if (!sessionId) return;
  const col = outcome === 'imported' ? 'imported' : outcome === 'error' ? 'errors' : 'skipped';
  await query(
    `UPDATE import_sessions
     SET total = total + 1, ${col} = ${col} + 1
     WHERE id = $1`,
    [sessionId],
  ).catch(() => {});
}

export async function closeSession(sessionId) {
  if (!sessionId) return;
  await query(
    `UPDATE import_sessions SET ended_at = NOW() WHERE id = $1`,
    [sessionId],
  ).catch(() => {});
}

export async function getRecentSessions(limit = 50) {
  const { rows } = await query(
    `SELECT id, source, source_path, started_at, ended_at,
            total, imported, skipped, errors
     FROM import_sessions
     ORDER BY started_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows;
}
