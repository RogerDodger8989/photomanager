/**
 * AI-service — hanterar kommunikationen med aiEmbedder-workern
 * och pgvector-baserad person-matchning.
 *
 * Modellsökvägar konfigureras via miljövariabler:
 *   AI_DETECTOR_PATH  = /models/SCRFD_500M_bnkps_shape640x640.onnx
 *   AI_RECOGNIZER_PATH = /models/w600k_r50.onnx
 *
 * Om modell-filer saknas stängs AI-funktionen av tyst (graceful degradation).
 */

import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { query } from '../db/pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Cosine similarity-tröskel för person-matchning (0–1, högre = strängare)
const MATCH_THRESHOLD = 0.6;

let worker = null;
let workerReady = false;
let pendingCallbacks = new Map();
let msgIdCounter = 0;

export function isAiAvailable() {
  return workerReady;
}

export async function initAiWorker() {
  const detectorPath   = process.env.AI_DETECTOR_PATH   ?? '/models/SCRFD_500M_bnkps_shape640x640.onnx';
  const recognizerPath = process.env.AI_RECOGNIZER_PATH ?? '/models/w600k_r50.onnx';

  if (!existsSync(detectorPath) || !existsSync(recognizerPath)) {
    console.log('AI: modell-filer saknas — ansiktsigenkänning inaktiverad.');
    console.log(`  Väntat: ${detectorPath}`);
    console.log(`  Väntat: ${recognizerPath}`);
    return;
  }

  worker = new Worker(
    join(__dirname, '../workers/aiEmbedder.js'),
    { workerData: { detectorPath, recognizerPath } }
  );

  await new Promise((resolve, reject) => {
    worker.once('message', (msg) => {
      if (msg.error) { reject(new Error(msg.error)); return; }
      if (msg.ready) { workerReady = true; resolve(); }
    });
    worker.once('error', reject);
  });

  worker.on('message', (msg) => {
    if (!msg.id) return;
    const cb = pendingCallbacks.get(msg.id);
    if (!cb) return;
    pendingCallbacks.delete(msg.id);
    if (msg.error) cb.reject(new Error(msg.error));
    else cb.resolve(msg.result);
  });

  console.log('AI: ONNX-modeller laddade, ansiktsigenkänning aktiv.');
}

function callWorker(payload) {
  if (!workerReady) throw new Error('AI-worker är inte redo');
  const id = ++msgIdCounter;
  return new Promise((resolve, reject) => {
    pendingCallbacks.set(id, { resolve, reject });
    worker.postMessage({ ...payload, id });
  });
}

// Detektera ansikten i en bild (för bilder utan EXIF face-data)
export async function detectFaces(imagePath) {
  return callWorker({ type: 'detect', imagePath });
}

// Generera 512-dim embedding för ett ansikte
export async function generateEmbedding(imagePath, regionX, regionY, regionW, regionH) {
  return callWorker({ type: 'embed', imagePath, regionX, regionY, regionW, regionH });
}

// === KOMPLETT PIPELINE FÖR EN BILD ===
// 1. Om bilden har faces utan embedding → generera embedding
// 2. Om bilden saknar faces → detektera + spara + generera embedding
// 3. Jämför embeddings mot kända persons → föreslå matchningar
export async function processAssetFaces(assetId, absolutePath) {
  if (!workerReady) return;

  // Hämta befintliga faces för denna asset
  const { rows: existingFaces } = await query(
    'SELECT * FROM faces WHERE asset_id = $1',
    [assetId]
  );

  let facesToEmbed = existingFaces;

  // Bilder utan EXIF face-data: kör automatisk detektion
  if (existingFaces.length === 0) {
    let detected;
    try {
      detected = await detectFaces(absolutePath);
    } catch (err) {
      console.warn(`AI-detektion misslyckades för ${absolutePath}:`, err.message);
      return;
    }

    if (detected.length === 0) return;

    // Spara detekterade ansikten i DB
    for (const face of detected) {
      const { rows } = await query(
        `INSERT INTO faces (asset_id, source, region_x, region_y, region_w, region_h)
         VALUES ($1, 'ai', $2, $3, $4, $5) RETURNING *`,
        [assetId, face.regionX, face.regionY, face.regionW, face.regionH]
      );
      facesToEmbed.push(rows[0]);
    }
  }

  // Generera embeddings för alla faces som saknar det
  for (const face of facesToEmbed) {
    if (face.embedding) continue; // Redan beräknad

    let embedding;
    try {
      embedding = await generateEmbedding(
        absolutePath, face.region_x, face.region_y, face.region_w, face.region_h
      );
    } catch (err) {
      console.warn(`AI-embedding misslyckades för face ${face.id}:`, err.message);
      continue;
    }

    // Spara embedding i pgvector-kolonnen
    await query(
      'UPDATE faces SET embedding = $1 WHERE id = $2',
      [`[${embedding.join(',')}]`, face.id]
    );

    // Hitta närmaste matchande person
    const suggestion = await findClosestPerson(embedding, face.id);
    if (suggestion) {
      await query(
        `INSERT INTO ai_suggestions (face_id, person_id, confidence)
         VALUES ($1, $2, $3)
         ON CONFLICT (face_id) DO UPDATE
           SET person_id = EXCLUDED.person_id, confidence = EXCLUDED.confidence`,
        [face.id, suggestion.personId, suggestion.confidence]
      );
    }
  }
}

// Cosine similarity-sökning via pgvector — hitta närmaste känd person
async function findClosestPerson(embedding, excludeFaceId) {
  const vectorStr = `[${embedding.join(',')}]`;

  // Hitta de 5 närmaste ansiktena med känd person
  const { rows } = await query(
    `SELECT f.person_id, p.name,
            1 - (f.embedding <=> $1::vector) AS similarity
     FROM faces f
     JOIN persons p ON p.id = f.person_id
     WHERE f.embedding IS NOT NULL
       AND f.person_id IS NOT NULL
       AND f.id != $2
     ORDER BY f.embedding <=> $1::vector
     LIMIT 5`,
    [vectorStr, excludeFaceId]
  );

  if (rows.length === 0) return null;

  // Rösta: vanligaste person bland top-5 med hög similarity
  const candidates = rows.filter((r) => r.similarity >= MATCH_THRESHOLD);
  if (candidates.length === 0) return null;

  const votes = {};
  for (const r of candidates) {
    votes[r.person_id] = (votes[r.person_id] ?? 0) + r.similarity;
  }

  const [bestPersonId] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  const bestCandidate  = candidates.find((r) => r.person_id === bestPersonId);

  return {
    personId: bestPersonId,
    personName: bestCandidate.name,
    confidence: bestCandidate.similarity,
  };
}

export async function shutdownAiWorker() {
  if (worker) await worker.terminate();
}
