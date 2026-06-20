/**
 * aiService.js — ansiktsigenkänning via InsightFace Python-tjänst.
 *
 * Arkitektur:
 *   InsightFace-processen (insightface_server.py) körs parallellt med
 *   Fastify via PM2. Den laddar buffalo_l-modellen EN gång och lyssnar
 *   på http://127.0.0.1:5000.
 *
 *   Vid Fastify-start pollar initAiWorker() /health tills Python är redo
 *   (max 60 s). Om Python aldrig svarar degraderas AI-funktionen tyst.
 *
 * Modellsökväg:
 *   Styrs av INSIGHTFACE_HOME (sätts i pm2.config.js → /app/models).
 *   Mappa /app/models som Docker Volume i Unraid så att ~300 MB
 *   buffalo_l-modellen inte laddas ner på nytt vid varje omstart.
 *
 * Cosine-similaritet-tröskel för person-matchning (0–1, högre = strängare):
 */

import { query } from '../db/pool.js';
import { analyzeFaces, waitForInsightFace, toVectorString } from './faceRecognition.js';

const MATCH_THRESHOLD = 0.6;

let aiReady = false;

export function isAiAvailable() {
  return aiReady;
}

/**
 * Anropas av server.js vid uppstart.
 * Pollar Python-tjänsten i upp till 60 s och markerar AI som aktiv när den svarar.
 * Blockerar INTE Fastify — server.js anropar detta utan await om så önskas.
 */
export async function initAiWorker() {
  console.log('AI: väntar på InsightFace-tjänsten (max 60 s) …');
  const ready = await waitForInsightFace(60_000);

  if (!ready) {
    console.log('AI: InsightFace-tjänsten svarade inte inom 60 s — ansiktsigenkänning inaktiverad.');
    console.log('    Kontrollera att /app/models är monterat och att pm2-processen "insightface" körs.');
    return;
  }

  aiReady = true;
  console.log('AI: InsightFace aktiv — ansiktsigenkänning aktiverad.');
}

/**
 * Komplett pipeline för en bild:
 *   1. Fråga InsightFace om bounding-boxes + embeddings
 *   2. Spara nya faces i DB (eller fyll i saknade embeddings)
 *   3. Jämför varje embedding mot kända persons → spara ai_suggestions
 *
 * @param {string} assetId       — UUID för assets-raden
 * @param {string} absolutePath  — absolut sökväg till bildfilen på servern
 */
export async function processAssetFaces(assetId, absolutePath) {
  if (!aiReady) return;

  // --- Hämta befintliga faces för denna asset ---
  const { rows: existingFaces } = await query(
    'SELECT * FROM faces WHERE asset_id = $1',
    [assetId]
  );

  let facesToProcess = existingFaces;

  // --- Bilder utan EXIF/XMP face-data: kör InsightFace-detektion ---
  if (existingFaces.length === 0) {
    let detected;
    try {
      detected = await analyzeFaces(absolutePath);
    } catch (err) {
      console.warn(`AI: detektion misslyckades för ${absolutePath}: ${err.message}`);
      return;
    }

    if (detected.face_count === 0) return;

    // Spara detekterade ansikten i DB och samla ihop för embedding-steget
    facesToProcess = [];
    for (const face of detected.faces) {
      // Spara embedding direkt — InsightFace ger oss bbox + embedding i ett anrop
      const vectorStr = face.embedding.length === 512
        ? toVectorString(face.embedding)
        : null;

      const { rows } = await query(
        `INSERT INTO faces (asset_id, source, region_x, region_y, region_w, region_h, embedding)
         VALUES ($1, 'ai', $2, $3, $4, $5, $6::vector)
         RETURNING *`,
        [assetId, face.region_x, face.region_y, face.region_w, face.region_h, vectorStr]
      );
      facesToProcess.push(rows[0]);
    }
  } else {
    // --- Befintliga faces (från XMP/DigiKam) som saknar embedding ---
    // Kör InsightFace EN gång för hela bilden och matcha mot befintliga regioner
    const facesWithoutEmbedding = existingFaces.filter((f) => !f.embedding);
    if (facesWithoutEmbedding.length === 0) {
      // Alla har redan embeddings — gå direkt till matchning
      facesToProcess = existingFaces;
    } else {
      let detected;
      try {
        detected = await analyzeFaces(absolutePath);
      } catch (err) {
        console.warn(`AI: embedding-anrop misslyckades för ${absolutePath}: ${err.message}`);
        return;
      }

      // Matcha XMP-face mot närmaste InsightFace-face med IoU > 0.3
      for (const dbFace of facesWithoutEmbedding) {
        const best = findBestMatchingDetection(dbFace, detected.faces);
        if (!best || best.embedding.length !== 512) continue;

        await query(
          'UPDATE faces SET embedding = $1::vector WHERE id = $2',
          [toVectorString(best.embedding), dbFace.id]
        );
        dbFace.embedding = best.embedding; // uppdatera lokalt för matchning nedan
      }
      facesToProcess = existingFaces;
    }
  }

  // --- Person-matchning via pgvector för varje face med embedding ---
  for (const face of facesToProcess) {
    // embedding kan vara en sträng (från DB) eller array (nyss beräknad)
    const embeddingArr = parseEmbedding(face.embedding);
    if (!embeddingArr || embeddingArr.length !== 512) continue;

    const suggestion = await findClosestPerson(embeddingArr, face.id);
    if (!suggestion) continue;

    await query(
      `INSERT INTO ai_suggestions (face_id, person_id, confidence)
       VALUES ($1, $2, $3)
       ON CONFLICT (face_id) DO UPDATE
         SET person_id  = EXCLUDED.person_id,
             confidence = EXCLUDED.confidence,
             reviewed   = false`,
      [face.id, suggestion.personId, suggestion.confidence]
    );
  }
}

// ---------------------------------------------------------------------------
// Hjälpfunktioner
// ---------------------------------------------------------------------------

/**
 * Cosine-sökning via pgvector — hitta närmaste känd person.
 * Exakt samma logik som i originalet, oförändrad.
 *
 * @param {number[]} embedding  — 512-dim vektor
 * @param {string}   excludeFaceId — den egna face-raden (exkluderas från sökning)
 */
async function findClosestPerson(embedding, excludeFaceId) {
  const vectorStr = toVectorString(embedding);

  // <=> = cosine distance (0 = identisk, 2 = motsatt)
  // 1 - distance = cosine similarity (1 = identisk)
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

  const candidates = rows.filter((r) => parseFloat(r.similarity) >= MATCH_THRESHOLD);
  if (candidates.length === 0) return null;

  // Rösta: person med högst summerad similarity bland kandidaterna vinner
  const votes = {};
  for (const r of candidates) {
    votes[r.person_id] = (votes[r.person_id] ?? 0) + parseFloat(r.similarity);
  }

  const [bestPersonId] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  const best = candidates.find((r) => r.person_id === bestPersonId);

  return {
    personId: bestPersonId,
    personName: best.name,
    confidence: parseFloat(best.similarity),
  };
}

/**
 * Matchar en befintlig DB-face-region mot en InsightFace-detektion via IoU.
 * Används när XMP-faces saknar embedding men bilden redan är analyserad.
 *
 * @param {object}   dbFace    — rad från faces-tabellen (region_x/y/w/h)
 * @param {object[]} detected  — faces från InsightFace /analyze
 * @returns {object|null}      — bäst matchande detection eller null
 */
function findBestMatchingDetection(dbFace, detected) {
  let bestIou = 0.3; // minsta acceptabla överlappning
  let bestFace = null;

  for (const det of detected) {
    const iou = computeIoU(
      dbFace.region_x, dbFace.region_y, dbFace.region_w, dbFace.region_h,
      det.region_x,   det.region_y,   det.region_w,   det.region_h
    );
    if (iou > bestIou) {
      bestIou = iou;
      bestFace = det;
    }
  }

  return bestFace;
}

/** Intersection over Union för normaliserade rektanglar. */
function computeIoU(ax, ay, aw, ah, bx, by, bw, bh) {
  const ix = Math.max(ax, bx);
  const iy = Math.max(ay, by);
  const iw = Math.min(ax + aw, bx + bw) - ix;
  const ih = Math.min(ay + ah, by + bh) - iy;
  if (iw <= 0 || ih <= 0) return 0;
  const intersection = iw * ih;
  const union = aw * ah + bw * bh - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Konverterar en embedding till number[] oavsett om den kommer som
 * pgvector-sträng '[0.1,0.2,...]', JSON-array-sträng eller redan är en array.
 */
function parseEmbedding(embedding) {
  if (!embedding) return null;
  if (Array.isArray(embedding)) return embedding;
  try {
    // pgvector returnerar strängen '[0.1,-0.2,...]'
    return JSON.parse(embedding);
  } catch {
    return null;
  }
}

/** Ingen ONNX-worker att stänga ner — behålls för bakåtkompatibilitet med server.js */
export async function shutdownAiWorker() {
  aiReady = false;
}
