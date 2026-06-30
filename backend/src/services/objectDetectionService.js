import { resolve, dirname } from 'path';
import { mkdirSync } from 'fs';
import sharp from 'sharp';
import { query } from '../db/pool.js';
import { config } from '../config.js';

// Ladda ner från Ultralytics officiella releases:
// https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx
// (~6 MB, CPU-inferens ~0.5–2 sek/bild beroende på server)
const MODEL_DOWNLOAD_URL =
  process.env.YOLO_MODEL_URL ??
  'https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx';

export const MODEL_PATH = resolve(config.models.path, 'yolov8n.onnx');
const CONF_THRESHOLD = parseFloat(process.env.YOLO_CONF_THRESHOLD ?? '0.50');
const INPUT_SIZE = 640;
const NUM_CLASSES = 80;
const NUM_BOXES = 8400; // 80×80 + 40×40 + 20×20 = 8400 ankare

// COCO 80 klasser → svenska namn (index = COCO class-id)
const COCO_SV = [
  'person', 'cykel', 'bil', 'motorcykel', 'flygplan', 'buss', 'tåg', 'lastbil', 'båt',
  'trafikljus', 'brandpost', 'stoppskylt', 'parkeringsautomat', 'bänk', 'fågel', 'katt',
  'hund', 'häst', 'får', 'ko', 'elefant', 'björn', 'zebra', 'giraff', 'ryggsäck',
  'paraply', 'handväska', 'slips', 'resväska', 'frisbee', 'skidor', 'snowboard', 'boll',
  'drake', 'basebollträ', 'basebollhandske', 'skateboard', 'surfbräda', 'tennisracket',
  'flaska', 'vinglas', 'kopp', 'gaffel', 'kniv', 'sked', 'skål', 'banan', 'äpple',
  'smörgås', 'apelsin', 'broccoli', 'morot', 'korvbröd', 'pizza', 'munk', 'tårta',
  'stol', 'soffa', 'krukväxt', 'säng', 'matbord', 'toalett', 'tv', 'laptop', 'datormus',
  'fjärrkontroll', 'tangentbord', 'mobiltelefon', 'mikrovågsugn', 'ugn', 'brödrost',
  'diskho', 'kylskåp', 'bok', 'klocka', 'vas', 'sax', 'teddybjörn', 'hårtork', 'tandborste',
];

let _session = null;

// ── Modellstatus ──────────────────────────────────────────────────────────────

export async function getModelStatus() {
  const { stat } = await import('fs/promises');
  try {
    const s = await stat(MODEL_PATH);
    return { ready: true, sizeBytes: s.size };
  } catch {
    return { ready: false, sizeBytes: 0 };
  }
}

// ── Nedladdning ───────────────────────────────────────────────────────────────

export async function downloadModel() {
  const { mkdir } = await import('fs/promises');
  const { createWriteStream } = await import('fs');
  const { Readable } = await import('stream');

  await mkdir(dirname(MODEL_PATH), { recursive: true });

  const res = await fetch(MODEL_DOWNLOAD_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} vid nedladdning av modell`);

  await new Promise((resolveFn, reject) => {
    const file = createWriteStream(MODEL_PATH);
    Readable.fromWeb(/** @type {any} */ (res.body)).pipe(file);
    file.on('finish', () => file.close(resolveFn));
    file.on('error', reject);
  });

  // Nollställ session-cache så att ny modell laddas vid nästa inferens
  _session = null;

  const { stat } = await import('fs/promises');
  const s = await stat(MODEL_PATH);
  return { ok: true, sizeBytes: s.size };
}

// ── ONNX-session ──────────────────────────────────────────────────────────────

async function loadSession() {
  if (_session) return _session;

  const { access } = await import('fs/promises');
  try { await access(MODEL_PATH); } catch { return null; }

  const ort = await import('onnxruntime-node');
  _session = await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });
  console.log('ObjectDetection: YOLOv8n modell laddad (CPU).');
  return _session;
}

// ── Inferens ──────────────────────────────────────────────────────────────────

/**
 * Kör YOLOv8-nano på en bild.
 * Returnerar array av { label: string, confidence: number }.
 * Returnerar [] om modellen inte finns eller bilden inte kan läsas.
 */
export async function detectObjects(imagePath) {
  const sess = await loadSession();
  if (!sess) return [];

  // Förbehandling: 640×640 RGB float32 [0,1] i CHW-layout (channels first)
  let pixels;
  try {
    ({ data: pixels } = await sharp(imagePath, { failOn: 'none' })
      .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }));
  } catch {
    return [];
  }

  const inputData = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const stride = INPUT_SIZE * INPUT_SIZE;
  for (let i = 0; i < stride; i++) {
    inputData[i]            = pixels[i * 3]     / 255.0; // R
    inputData[stride + i]   = pixels[i * 3 + 1] / 255.0; // G
    inputData[stride * 2 + i] = pixels[i * 3 + 2] / 255.0; // B
  }

  const ort = await import('onnxruntime-node');
  const inputName  = sess.inputNames[0];
  const outputName = sess.outputNames[0];
  const tensor = new ort.Tensor('float32', inputData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const out    = await sess.run({ [inputName]: tensor });
  const raw    = /** @type {Float32Array} */ (out[outputName].data);
  // raw har layout [1, 84, 8400] → rad = kanal, kolumn = ankare

  // Hitta högsta konfidenspoäng per klass (vi vill bara ha klass-etiketter, inte bbox)
  const best = new Map(); // classIdx → max confidence
  for (let box = 0; box < NUM_BOXES; box++) {
    for (let cls = 0; cls < NUM_CLASSES; cls++) {
      const score = raw[(4 + cls) * NUM_BOXES + box];
      if (score >= CONF_THRESHOLD) {
        if ((best.get(cls) ?? 0) < score) best.set(cls, score);
      }
    }
  }

  return [...best.entries()].map(([cls, conf]) => ({
    label: COCO_SV[cls] ?? `class_${cls}`,
    confidence: conf,
  }));
}

// ── DB-integration ────────────────────────────────────────────────────────────

/**
 * Kör detektion och sparar AI-taggar kopplade till asset i DB.
 * Returnerar antal nyligen detekterade klasser (0 = ingen detektion).
 */
export async function detectAndTagAsset(assetId, imagePath) {
  const detected = await detectObjects(imagePath);
  if (!detected.length) return 0;

  for (const { label, confidence } of detected) {
    // Upsert tagg — behåll 'manual' om den redan finns som manuell tagg
    const { rows: tagRows } = await query(
      `INSERT INTO tags (name, path, source)
       VALUES ($1, $1, 'ai')
       ON CONFLICT (path) DO UPDATE
         SET source = CASE WHEN tags.source = 'manual' THEN 'manual' ELSE 'ai' END
       RETURNING id`,
      [label]
    );
    const tagId = tagRows[0].id;

    // Länka asset → tagg med confidence (hoppa över om länk redan finns)
    await query(
      `INSERT INTO asset_tags (asset_id, tag_id, confidence, source)
       VALUES ($1, $2, $3, 'ai')
       ON CONFLICT (asset_id, tag_id) DO NOTHING`,
      [assetId, tagId, Math.round(confidence * 1000) / 1000]
    );
  }

  return detected.length;
}
