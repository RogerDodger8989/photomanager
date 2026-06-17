import { query } from '../db/pool.js';

export async function createJob(jobType, assetId = null, userId = null, payload = null) {
  const { rows } = await query(
    `INSERT INTO jobs (job_type, asset_id, user_id, payload)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [jobType, assetId, userId, payload ? JSON.stringify(payload) : null]
  );
  return rows[0].id;
}

export async function startJob(jobId) {
  await query(
    "UPDATE jobs SET status = 'running', started_at = NOW(), attempts = attempts + 1 WHERE id = $1",
    [jobId]
  );
}

export async function completeJob(jobId, resultPath = null) {
  await query(
    "UPDATE jobs SET status = 'done', finished_at = NOW(), result_path = $2 WHERE id = $1",
    [jobId, resultPath]
  );
}

export async function failJob(jobId, errorMsg) {
  await query(
    "UPDATE jobs SET status = 'failed', finished_at = NOW(), error_msg = $2 WHERE id = $1",
    [jobId, errorMsg]
  );
}

export async function getPendingJobs(jobType, limit = 10) {
  const { rows } = await query(
    `SELECT * FROM jobs
     WHERE job_type = $1 AND status = 'pending'
     ORDER BY created_at ASC
     LIMIT $2`,
    [jobType, limit]
  );
  return rows;
}

export async function getJobStats() {
  const { rows } = await query(
    `SELECT job_type, status, COUNT(*)::int AS count
     FROM jobs
     GROUP BY job_type, status
     ORDER BY job_type, status`
  );
  return rows;
}
