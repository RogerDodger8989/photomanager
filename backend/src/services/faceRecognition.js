/**
 * faceRecognition.js — HTTP-klient mot InsightFace Python-tjänsten.
 *
 * Python-tjänsten körs på localhost:5000 (PM2 håller den uppe).
 * Den laddar buffalo_l-modellen EN gång vid start och svarar sedan
 * blixtsnabbt på varje /analyze-anrop utan att starta om Python.
 *
 * Publikt API:
 *   analyzeFaces(absoluteImagePath) → { face_count, faces[] }
 *   waitForInsightFace(maxMs)       → boolean (true = redo)
 */

const PYTHON_URL = process.env.INSIGHTFACE_URL ?? 'http://127.0.0.1:5000';

// Timeout per bildanalys. Stora bilder med många ansikten kan ta några sekunder.
const ANALYZE_TIMEOUT_MS = 30_000;

// Timeout per hälsokontroll vid polling
const HEALTH_TIMEOUT_MS = 2_000;

/**
 * Skickar en bild till InsightFace för analys.
 *
 * @param {string} absoluteImagePath — absolut sökväg på serverns filsystem
 * @returns {Promise<{ face_count: number, faces: Array<{
 *   region_x: number, region_y: number, region_w: number, region_h: number,
 *   embedding: number[]   // 512 floats (ArcFace-vektor)
 * }> }>}
 * @throws Om Python-tjänsten inte svarar eller returnerar ett fel
 */
export async function analyzeFaces(absoluteImagePath) {
  let res;
  try {
    res = await fetch(`${PYTHON_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: absoluteImagePath }),
      signal: AbortSignal.timeout(ANALYZE_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`InsightFace nåbar inte (${PYTHON_URL}): ${err.message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`InsightFace svarade HTTP ${res.status}: ${text}`);
  }

  return res.json();
}

/**
 * Pollar /health tills Python-tjänsten är uppe eller timeout nås.
 * Anropas från aiService.initAiWorker() vid Fastify-start.
 *
 * @param {number} maxMs — maximal väntetid i millisekunder (default 60 s)
 * @returns {Promise<boolean>} true om tjänsten svarade OK inom timeout
 */
export async function waitForInsightFace(maxMs = 60_000) {
  const deadline = Date.now() + maxMs;

  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${PYTHON_URL}/health`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (r.ok) return true;
    } catch {
      // Tjänsten är ännu inte redo — försök igen om 2 s
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  return false;
}

/**
 * Formaterar en embedding-array till en sträng som pgvector förstår.
 *
 * pgvector kräver formatet '[0.123, -0.456, ...]' — dvs. en JSON-array
 * utan extra whitespace. Används vid INSERT/UPDATE i faces-tabellen.
 *
 * Exempel:
 *   toVectorString([0.1, -0.2, 0.3]) → '[0.1,-0.2,0.3]'
 *
 * @param {number[]} embedding — array med 512 floats
 * @returns {string}
 */
export function toVectorString(embedding) {
  return `[${embedding.join(',')}]`;
}
