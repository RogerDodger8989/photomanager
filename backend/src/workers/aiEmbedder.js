/**
 * AI-embedder — körs som en Node.js worker_thread.
 * Håller ONNX-sessionerna laddade i minnet mellan anrop.
 *
 * Nödvändiga modell-filer (placeras i /models/ mappen):
 *   SCRFD_500M_bnkps_shape640x640.onnx  — ansiktsdetektor (RetinaFace-familjen)
 *   w600k_r50.onnx                      — ArcFace 512-dim embedding-modell
 *
 * Ladda ner:
 *   Detektor:   https://github.com/deepinsight/insightface  (SCRFD-modeller)
 *   ArcFace:    https://github.com/deepinsight/insightface  (model zoo, buffalo_l)
 */

import { workerData, parentPort } from 'worker_threads';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';

const DETECTOR_INPUT_SIZE = 640;
const RECOGNIZER_INPUT_SIZE = 112;
const SCORE_THRESHOLD = 0.5;

let detectorSession = null;
let recognizerSession = null;

async function loadModels() {
  const opts = {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    enableCpuMemArena: true,
  };

  detectorSession    = await ort.InferenceSession.create(workerData.detectorPath, opts);
  recognizerSession  = await ort.InferenceSession.create(workerData.recognizerPath, opts);
}

// === ANSIKTSDETEKTION ===
// Returnerar [{ x, y, w, h, score }] i pixlar (absoluta koordinater)
async function detectFaces(imagePath) {
  const { data: pixels, info } = await sharp(imagePath)
    .rotate()                                  // rätta upp EXIF-rotation
    .resize(DETECTOR_INPUT_SIZE, DETECTOR_INPUT_SIZE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const scaleX = info.width  / DETECTOR_INPUT_SIZE;
  const scaleY = info.height / DETECTOR_INPUT_SIZE;

  // CHW float32, normaliserat till [-1, 1]
  const float32 = new Float32Array(3 * DETECTOR_INPUT_SIZE * DETECTOR_INPUT_SIZE);
  for (let i = 0; i < DETECTOR_INPUT_SIZE * DETECTOR_INPUT_SIZE; i++) {
    float32[i]                                        = (pixels[i * 3]     - 127.5) / 128;
    float32[i + DETECTOR_INPUT_SIZE * DETECTOR_INPUT_SIZE]     = (pixels[i * 3 + 1] - 127.5) / 128;
    float32[i + 2 * DETECTOR_INPUT_SIZE * DETECTOR_INPUT_SIZE] = (pixels[i * 3 + 2] - 127.5) / 128;
  }

  const tensor = new ort.Tensor('float32', float32, [1, 3, DETECTOR_INPUT_SIZE, DETECTOR_INPUT_SIZE]);
  const results = await detectorSession.run({ input: tensor });

  // Hämta bounding boxes + scores från output (format beror på SCRFD-variant)
  const scores = results['score']?.data ?? results[Object.keys(results)[0]]?.data ?? [];
  const boxes  = results['bbox']?.data  ?? results[Object.keys(results)[1]]?.data ?? [];

  const faces = [];
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] < SCORE_THRESHOLD) continue;
    const x1 = boxes[i * 4]     / DETECTOR_INPUT_SIZE;
    const y1 = boxes[i * 4 + 1] / DETECTOR_INPUT_SIZE;
    const x2 = boxes[i * 4 + 2] / DETECTOR_INPUT_SIZE;
    const y2 = boxes[i * 4 + 3] / DETECTOR_INPUT_SIZE;
    faces.push({
      regionX: x1,
      regionY: y1,
      regionW: x2 - x1,
      regionH: y2 - y1,
      score: scores[i],
    });
  }

  return faces;
}

// === EMBEDDING-GENERERING ===
// Klipper ut ansiktsregionen och kör ArcFace → 512-dim vektor
async function generateEmbedding(imagePath, regionX, regionY, regionW, regionH) {
  const { width: imgW, height: imgH } = await sharp(imagePath).rotate().metadata();

  // Lägg till lite padding runt ansiktet (20%)
  const pad   = 0.2;
  const left   = Math.max(0, Math.floor((regionX - regionW * pad) * imgW));
  const top    = Math.max(0, Math.floor((regionY - regionH * pad) * imgH));
  const width  = Math.min(imgW - left, Math.floor((regionW + 2 * regionW * pad) * imgW));
  const height = Math.min(imgH - top,  Math.floor((regionH + 2 * regionH * pad) * imgH));

  const { data: pixels } = await sharp(imagePath)
    .rotate()
    .extract({ left, top, width, height })
    .resize(RECOGNIZER_INPUT_SIZE, RECOGNIZER_INPUT_SIZE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // CHW float32, normaliserat [0,1]
  const size = RECOGNIZER_INPUT_SIZE * RECOGNIZER_INPUT_SIZE;
  const float32 = new Float32Array(3 * size);
  for (let i = 0; i < size; i++) {
    float32[i]          = pixels[i * 3]     / 255;
    float32[i + size]   = pixels[i * 3 + 1] / 255;
    float32[i + size*2] = pixels[i * 3 + 2] / 255;
  }

  const tensor = new ort.Tensor('float32', float32, [1, 3, RECOGNIZER_INPUT_SIZE, RECOGNIZER_INPUT_SIZE]);
  const result = await recognizerSession.run({ input: tensor });

  const embedding = Array.from(result['output']?.data ?? result[Object.keys(result)[0]]?.data ?? []);

  // L2-normalisering
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  return embedding.map((v) => v / norm);
}

// === MEDDELANDEHANTERING ===
// parentPort.postMessage({ type: 'detect', imagePath }) → [faces]
// parentPort.postMessage({ type: 'embed', imagePath, regionX, regionY, regionW, regionH }) → [floats]

loadModels()
  .then(() => parentPort.postMessage({ ready: true }))
  .catch((err) => parentPort.postMessage({ error: err.message }));

parentPort.on('message', async (msg) => {
  try {
    if (msg.type === 'detect') {
      const faces = await detectFaces(msg.imagePath);
      parentPort.postMessage({ id: msg.id, result: faces });

    } else if (msg.type === 'embed') {
      const embedding = await generateEmbedding(
        msg.imagePath, msg.regionX, msg.regionY, msg.regionW, msg.regionH
      );
      parentPort.postMessage({ id: msg.id, result: embedding });
    }
  } catch (err) {
    parentPort.postMessage({ id: msg.id, error: err.message });
  }
});
