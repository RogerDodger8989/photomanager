import ExifReader from 'exifr';
import sharp from 'sharp';
import { stat } from 'fs/promises';

// Filtyper som stöds
const IMAGE_MIMES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'image/heic', 'image/heif', 'image/tiff', 'image/gif',
  'image/avif', 'image/bmp',
]);

const VIDEO_MIMES = new Set([
  'video/mp4', 'video/quicktime', 'video/x-msvideo',
  'video/x-matroska', 'video/webm', 'video/mpeg',
  'video/3gpp', 'video/x-ms-wmv',
]);

export function getMimeType(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
    tiff: 'image/tiff', tif: 'image/tiff', gif: 'image/gif',
    avif: 'image/avif', bmp: 'image/bmp',
    mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
    mkv: 'video/x-matroska', webm: 'video/webm', mpg: 'video/mpeg',
    mpeg: 'video/mpeg', '3gp': 'video/3gpp', wmv: 'video/x-ms-wmv',
    m4v: 'video/mp4',
  };
  return map[ext] ?? 'application/octet-stream';
}

export function isImage(mimeType) { return IMAGE_MIMES.has(mimeType); }
export function isVideo(mimeType) { return VIDEO_MIMES.has(mimeType); }

export async function extractMetadata(filePath) {
  const mimeType = getMimeType(filePath);
  const fileStat = await stat(filePath);

  const result = {
    mimeType,
    fileSize: fileStat.size,
    fileCreatedAt: fileStat.birthtime,
    takenAt: null,
    width: null,
    height: null,
    gps: null,         // { lat, lon }
    exif: {},          // råa exif-värden
    iptc: {},
    xmp: {},
    faces: [],         // [{ name, regionX, regionY, regionW, regionH, source }]
    tags: [],          // nyckelord från IPTC/XMP
    rating: null,      // 1–5 från XMP:Rating
    title: null,       // XMP:Title / IPTC:ObjectName
    description: null, // XMP:Description / IPTC:Caption-Abstract
  };

  if (!isImage(mimeType)) return result;

  try {
    const raw = await ExifReader.parse(filePath, {
      tiff: true,
      exif: true,
      iptc: true,
      xmp: true,
      gps: true,
      icc: false,
      interop: false,
      translateKeys: false,
      translateValues: false,
      reviveValues: true,
    });

    // Tidsstämpel: prioritetsordning
    result.takenAt =
      raw.DateTimeOriginal
      ?? raw.CreateDate
      ?? raw.ModifyDate
      ?? null;

    // Konvertera till Date om exifr gav ett objekt med nested value
    if (result.takenAt != null && !(result.takenAt instanceof Date)) {
      const v = result.takenAt?.value ?? result.takenAt;
      result.takenAt = v instanceof Date ? v : (typeof v === 'string' ? new Date(v) : null);
      if (result.takenAt instanceof Date && isNaN(result.takenAt.getTime())) result.takenAt = null;
    }

    // Bildstorlek (exifr-nycklar varierar beroende på fil)
    result.width  = raw.ExifImageWidth  ?? raw.ImageWidth  ?? raw.PixelXDimension
                 ?? raw.ImageWidthInPixels ?? raw.OutputImageWidth ?? null;
    result.height = raw.ExifImageHeight ?? raw.ImageHeight ?? raw.PixelYDimension
                 ?? raw.ImageLengthInPixels ?? raw.OutputImageHeight ?? null;

    // GPS
    if (raw.latitude != null && raw.longitude != null) {
      result.gps = { lat: raw.latitude, lon: raw.longitude };
    }

    // Råa metadata-par (flattade)
    for (const [key, val] of Object.entries(raw)) {
      if (val == null) continue;
      const str = typeof val === 'object' ? JSON.stringify(val) : String(val);

      // Grov kategorisering baserat på kända prefix/nycklar
      if (key.startsWith('IPTC') || ['Keywords', 'Caption', 'Headline', 'Credit'].includes(key)) {
        result.iptc[key] = str;
      } else if (key.startsWith('dc:') || key.startsWith('xmp') || key.includes('Regions')) {
        result.xmp[key] = str;
      } else {
        result.exif[key] = str;
      }
    }

    // Hjälpfunktion: XMP language alternative → sträng
    const xmpStr = (val) => {
      if (val == null) return null;
      if (typeof val === 'string') return val.trim() || null;
      // Language alternative: { 'x-default': 'text' } eller { value: 'text' }
      if (typeof val === 'object') {
        const s = val['x-default'] ?? val.value ?? Object.values(val)[0] ?? null;
        return s ? String(s).trim() || null : null;
      }
      return null;
    };

    // Titel: XMP dc:title / IPTC ObjectName
    const titleRaw = raw['dc:title'] ?? raw.Title ?? raw.ObjectName ?? raw['xmp:Title'] ?? null;
    result.title = xmpStr(titleRaw);

    // Beskrivning: XMP dc:description / IPTC Caption-Abstract
    const descRaw = raw['dc:description'] ?? raw.Description ?? raw['Caption-Abstract'] ?? raw.ImageDescription ?? raw['xmp:Description'] ?? null;
    result.description = xmpStr(descRaw);

    // Betyg: XMP Rating (standard 1–5)
    const ratingRaw = raw.Rating ?? raw['xmp:Rating'] ?? null;
    if (ratingRaw != null) {
      const r = parseInt(ratingRaw, 10);
      if (r >= 1 && r <= 5) result.rating = r;
    }

    // Nyckelord: XMP subject (UTF-8) prioriteras över IPTC tag 25 (Latin-1)
    const kwRaw = raw.subject ?? raw[25] ?? raw.Keywords ?? raw['dc:subject'] ?? null;
    if (kwRaw) {
      const arr = Array.isArray(kwRaw) ? kwRaw : [kwRaw];
      result.tags = arr.map((k) => String(k).toLowerCase().trim()).filter(Boolean);
    }

    // === FACE REGIONS ===
    // DigiKam sparar i XMP mwg-rs:Regions / mwg-rs:RegionList
    // Lightroom sparar i XMP lr:hierarchicalSubject och mwg-rs:Regions
    // exifr exponerar dessa som raw['mwg-rs:Regions'] eller raw.Regions
    result.faces = parseFaceRegions(raw, result.width, result.height);

  } catch (err) {
    if (!err.message?.includes('No Exif data')) {
      console.warn(`Metadata-varning för ${filePath}:`, err.message);
    }
  }

  // Sharp-fallback för dimensioner + ansiktskoordinat-korrigering baserat på EXIF-orientering
  // Sharp genererar thumbnails med rotationen inbakad (auto-roterar).
  // Ansiktskoordinater från exifr är i det LAGRADE (ej roterade) koordinatrymden
  // och måste transformeras till VISNINGSUTRYMMET för att matcha thumbnails.
  if (isImage(result.mimeType)) {
    try {
      const sharpMeta = await sharp(filePath).metadata();
      result.width  = result.width  ?? sharpMeta.width  ?? null;
      result.height = result.height ?? sharpMeta.height ?? null;
      const orient = sharpMeta.orientation ?? 1;
      if (orient !== 1 && result.faces.length > 0) {
        result.faces = result.faces.map(f => applyOrientationToFace(f, orient));
      }
    } catch {}
  }

  // Fallback 1: parsa datum ur filnamnet (Android, Windows Phone, etc.)
  if (!result.takenAt) {
    result.takenAt = parseDateFromFilename(filePath);
  }

  // Fallback 2: mtime är mer tillförlitlig än birthtime i Docker/Linux
  const EPOCH = new Date('1970-01-02');
  if (!result.fileCreatedAt || result.fileCreatedAt < EPOCH) {
    result.fileCreatedAt = fileStat.mtime;
  }
  // Om takenAt fortfarande saknas, använd mtime
  if (!result.takenAt && fileStat.mtime > EPOCH) {
    result.takenAt = fileStat.mtime;
  }

  return result;
}

// Parsar datum ur vanliga mobilfilnamn:
//   IMG20250416171406.jpg  → 2025-04-16 17:14:06
//   VID20250720184659.mp4  → 2025-07-20 18:46:59
//   IMG_20250416_171406    → 2025-04-16 17:14:06  (Samsung)
//   20250416_171406        → 2025-04-16 17:14:06
//   2025-04-16 17.14.06    → 2025-04-16 17:14:06  (Windows)
//   2025-04-16_17-14-06    → 2025-04-16 17:14:06
function parseDateFromFilename(filePath) {
  const name = filePath.split(/[\\/]/).pop() ?? '';

  const patterns = [
    // YYYYMMDDHHMMSS  (Android Camera, Huawei, etc.)
    /(\d{4})(\d{2})(\d{2})[\s_\-T]?(\d{2})(\d{2})(\d{2})/,
    // YYYY-MM-DD_HH-MM-SS  eller  YYYY-MM-DD HH.MM.SS
    /(\d{4})[.\-](\d{2})[.\-](\d{2})[\s_T](\d{2})[.:h](\d{2})[.:m](\d{2})/,
  ];

  for (const re of patterns) {
    const m = name.match(re);
    if (!m) continue;
    const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
    const dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
    if (!isNaN(dt.getTime()) && dt.getFullYear() > 1900 && dt.getFullYear() <= new Date().getFullYear() + 1) {
      return dt;
    }
  }
  return null;
}

function parseFaceRegions(raw, imgWidth, imgHeight) {
  const faces = [];

  // ── MWG-format (DigiKam, Lightroom, exifr) ──────────────────────────────
  // raw.Regions eller raw['mwg-rs:Regions']
  const mwgSource = raw['mwg-rs:Regions'] ?? raw['Regions'] ?? null;
  if (mwgSource) {
    let regionList =
      mwgSource?.['mwg-rs:RegionList']?.['mwg-rs:Region'] ??
      mwgSource?.RegionList ??          // exifr: RegionList ÄR regionen/listan
      mwgSource?.['rdf:Bag']?.['rdf:li'] ??
      null;

    if (regionList) {
      if (!Array.isArray(regionList)) regionList = [regionList];

      for (const region of regionList) {
        const name =
          region['mwg-rs:Name'] ?? region.Name ?? region['lr:name'] ?? null;

        const area = region['mwg-rs:Area'] ?? region.Area ?? null;
        if (!area) continue;

        // MWG: x/y = centrum, w/h = storlek (normaliserade 0–1)
        const cx = parseFloat(area['stArea:x'] ?? area.x ?? 0);
        const cy = parseFloat(area['stArea:y'] ?? area.y ?? 0);
        const w  = parseFloat(area['stArea:w'] ?? area.w ?? 0);
        const h  = parseFloat(area['stArea:h'] ?? area.h ?? 0);
        if (!w || !h) continue;

        faces.push({
          name: name ?? null,
          regionX: Math.max(0, cx - w / 2),
          regionY: Math.max(0, cy - h / 2),
          regionW: w,
          regionH: h,
          source: detectFaceSource(region, raw),
        });
      }
    }
  }

  // ── Windows Photos-format ────────────────────────────────────────────────
  // raw.RegionInfo.Regions  →  { PersonDisplayName, Rectangle: "left,top,w,h" }
  const winSource = raw['RegionInfo'] ?? null;
  if (winSource && faces.length === 0) {
    let regions = winSource.Regions ?? null;
    if (regions && !Array.isArray(regions)) regions = [regions];
    if (regions) {
      for (const r of regions) {
        const name = r.PersonDisplayName ?? null;
        const rect = r.Rectangle;         // "0.325, 0.088, 0.484, 0.826"
        if (!rect) continue;
        const parts = String(rect).split(',').map(Number);
        if (parts.length < 4) continue;
        const [left, top, w, h] = parts;
        if (!w || !h) continue;
        faces.push({
          name: name ?? null,
          regionX: Math.max(0, left),
          regionY: Math.max(0, top),
          regionW: w,
          regionH: h,
          source: 'windows',
        });
      }
    }
  }

  return faces;
}

function detectFaceSource(region, raw) {
  // DigiKam sätter oftast digikam:TagsList eller har specifika XMP-namnrymder
  if (raw['digiKam:TagsList'] != null) return 'digikam';
  // Lightroom använder lr:hierarchicalSubject
  if (raw['lr:hierarchicalSubject'] != null) return 'lightroom';
  return 'manual';
}

// Transformerar ansiktskoordinater (normaliserade 0-1, lagrad pixelrymd) till
// den visningsrymd som Sharp-genererade thumbnails använder (rotation inbakad).
// EXIF orientation 1-8 — vi hanterar de vanligaste: 1, 3, 6, 8.
function applyOrientationToFace(face, orientation) {
  const cx = face.regionX + face.regionW / 2;
  const cy = face.regionY + face.regionH / 2;
  const w  = face.regionW;
  const h  = face.regionH;

  let nx, ny, nw, nh;
  switch (orientation) {
    case 3: // 180°
      nx = 1 - cx; ny = 1 - cy; nw = w; nh = h;
      break;
    case 6: // 90° CW (liggande → stående)  px = 1-cy, py = cx
      nx = 1 - cy; ny = cx; nw = h; nh = w;
      break;
    case 8: // 90° CCW (liggande → stående)  px = cy, py = 1-cx
      nx = cy; ny = 1 - cx; nw = h; nh = w;
      break;
    default:
      return face;
  }

  return {
    ...face,
    regionX: Math.max(0, Math.min(1, nx - nw / 2)),
    regionY: Math.max(0, Math.min(1, ny - nh / 2)),
    regionW: Math.min(nw, 1),
    regionH: Math.min(nh, 1),
  };
}
