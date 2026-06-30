import { query } from '../db/pool.js';
import { startJob, completeJob, failJob, getPendingJobs } from '../services/jobService.js';
import { transcodeVideo } from './transcoder.js';
import { generateThumbnails } from './thumbnailer.js';
import { computeAndStorePHash } from '../services/pHashService.js';
import { detectAndTagAsset } from '../services/objectDetectionService.js';
import { config } from '../config.js';
import { join, resolve } from 'path';
import { broadcast } from '../services/sseService.js';

const MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 5_000; // Kolla efter nya jobb var 5:e sekund

let running = false;

async function processPendingJobs() {
  if (running) return; // Förhindra överlapp
  running = true;

  try {
    // Hämta transcode-jobb
    const transcodeJobs = await getPendingJobs('transcode', 3);
    for (const job of transcodeJobs) {
      await runTranscodeJob(job);
    }

    // Hämta thumbnail-retry-jobb (misslyckade vid indexering)
    const thumbJobs = await getPendingJobs('thumbnail', 5);
    for (const job of thumbJobs) {
      await runThumbnailJob(job);
    }

    // Hämta phash-backfill-jobb
    const phashJobs = await getPendingJobs('phash', 10);
    for (const job of phashJobs) {
      await runPhashJob(job);
    }

    // Hämta objektdetektion-jobb (2 åt gången — tyngre än phash)
    const odJobs = await getPendingJobs('object_detection', 2);
    for (const job of odJobs) {
      await runObjectDetectionJob(job);
    }
  } finally {
    running = false;
  }
}

async function runTranscodeJob(job) {
  // Kontrollera att vi inte har nått max försök
  if (job.attempts >= MAX_ATTEMPTS) {
    await failJob(job.id, `Max antal försök (${MAX_ATTEMPTS}) uppnått`);
    return;
  }

  await startJob(job.id);

  try {
    // Hämta filsökväg från asset
    const { rows } = await query(
      "SELECT file_path FROM assets WHERE id = $1 AND status != 'deleted'",
      [job.asset_id]
    );

    if (!rows[0]) {
      await failJob(job.id, 'Asset hittades inte');
      return;
    }

    console.log(`Transkoderar: ${rows[0].file_path}`);
    const resultPath = await transcodeVideo(job.asset_id, rows[0].file_path);
    await completeJob(job.id, resultPath);
    broadcast('asset.transcoded', { assetId: job.asset_id });
    console.log(`Transkodning klar: ${rows[0].file_path}`);
  } catch (err) {
    console.error(`Transkodningsfel (job ${job.id}):`, err.message);

    // Återkö om vi inte nått max försök
    if (job.attempts + 1 < MAX_ATTEMPTS) {
      await query(
        "UPDATE jobs SET status = 'pending', error_msg = $2 WHERE id = $1",
        [job.id, err.message]
      );
    } else {
      await failJob(job.id, err.message);
    }
  }
}

async function runThumbnailJob(job) {
  if (job.attempts >= MAX_ATTEMPTS) {
    await failJob(job.id, `Max antal försök uppnått`);
    return;
  }

  await startJob(job.id);

  try {
    const { rows } = await query(
      'SELECT file_path, mime_type FROM assets WHERE id = $1',
      [job.asset_id]
    );
    if (!rows[0]) {
      await failJob(job.id, 'Asset hittades inte');
      return;
    }

    const absPath = resolve(config.media.photosPath,rows[0].file_path);
    await generateThumbnails(job.asset_id, absPath, rows[0].mime_type);
    await completeJob(job.id);
  } catch (err) {
    if (job.attempts + 1 < MAX_ATTEMPTS) {
      await query(
        "UPDATE jobs SET status = 'pending', error_msg = $2 WHERE id = $1",
        [job.id, err.message]
      );
    } else {
      await failJob(job.id, err.message);
    }
  }
}

async function runPhashJob(job) {
  if (job.attempts >= MAX_ATTEMPTS) {
    await failJob(job.id, 'Max antal försök uppnått');
    return;
  }
  await startJob(job.id);
  try {
    const { rows } = await query(
      "SELECT file_path FROM assets WHERE id = $1 AND status != 'deleted'",
      [job.asset_id]
    );
    if (!rows[0]) { await failJob(job.id, 'Asset hittades inte'); return; }
    const absPath = resolve(config.media.photosPath, rows[0].file_path);
    await computeAndStorePHash(job.asset_id, absPath);
    await completeJob(job.id);
  } catch (err) {
    if (job.attempts + 1 < MAX_ATTEMPTS) {
      await query(
        "UPDATE jobs SET status = 'pending', error_msg = $2 WHERE id = $1",
        [job.id, err.message]
      );
    } else {
      await failJob(job.id, err.message);
    }
  }
}

async function runObjectDetectionJob(job) {
  if (job.attempts >= MAX_ATTEMPTS) {
    await failJob(job.id, 'Max antal försök uppnått');
    return;
  }
  await startJob(job.id);
  try {
    const { rows } = await query(
      "SELECT file_path FROM assets WHERE id = $1 AND status != 'deleted'",
      [job.asset_id]
    );
    if (!rows[0]) { await failJob(job.id, 'Asset hittades inte'); return; }
    const absPath = resolve(config.media.photosPath, rows[0].file_path);
    const count = await detectAndTagAsset(job.asset_id, absPath);
    await completeJob(job.id, count > 0 ? `${count} klasser detekterade` : 'Inga objekt');
  } catch (err) {
    if (job.attempts + 1 < MAX_ATTEMPTS) {
      await query(
        "UPDATE jobs SET status = 'pending', error_msg = $2 WHERE id = $1",
        [job.id, err.message]
      );
    } else {
      await failJob(job.id, err.message);
    }
  }
}

export function startJobRunner() {
  // Kör direkt, sedan var 5:e sekund
  processPendingJobs().catch(console.error);
  setInterval(() => processPendingJobs().catch(console.error), POLL_INTERVAL_MS);
  console.log('JobRunner: startat (polling var 5s)');
}
