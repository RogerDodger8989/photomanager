import ExifReader from 'exifr';
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

    // Bildstorlek
    result.width  = raw.ExifImageWidth  ?? raw.ImageWidth  ?? raw.PixelXDimension ?? null;
    result.height = raw.ExifImageHeight ?? raw.ImageHeight ?? raw.PixelYDimension ?? null;

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

    // Nyckelord (taggar) från IPTC Keywords eller XMP dc:subject
    const kwRaw = raw.Keywords ?? raw['dc:subject'] ?? null;
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
    // Filen kan sakna EXIF — det är OK
    if (!err.message?.includes('No Exif data')) {
      console.warn(`Metadata-varning för ${filePath}:`, err.message);
    }
  }

  return result;
}

function parseFaceRegions(raw, imgWidth, imgHeight) {
  const faces = [];

  // exifr levererar XMP face regions under olika nyckelnamn beroende på version
  // Vi söker efter de vanligaste strukturerna från DigiKam och Lightroom
  const regionSources = [
    raw['mwg-rs:Regions'],
    raw['Regions'],
    raw['RegionInfo'],
  ].filter(Boolean);

  for (const regionInfo of regionSources) {
    // Normalisera till array av region-objekt
    let regionList =
      regionInfo?.['mwg-rs:RegionList']?.['mwg-rs:Region'] ??
      regionInfo?.RegionList?.Region ??
      regionInfo?.['rdf:Bag']?.['rdf:li'] ??
      null;

    if (!regionList) continue;
    if (!Array.isArray(regionList)) regionList = [regionList];

    for (const region of regionList) {
      // Namn på person
      const name =
        region['mwg-rs:Name'] ??
        region.Name ??
        region['lr:name'] ??
        null;

      // Koordinater — exifr kan ge dem normaliserade (0–1) eller i pixlar
      const area =
        region['mwg-rs:Area'] ??
        region.Area ??
        null;

      if (!area) continue;

      // mwg-rs:Area använder x, y som centrum och w, h som storlek (alla 0–1)
      const cx = parseFloat(area['stArea:x'] ?? area.x ?? 0);
      const cy = parseFloat(area['stArea:y'] ?? area.y ?? 0);
      const w  = parseFloat(area['stArea:w'] ?? area.w ?? 0);
      const h  = parseFloat(area['stArea:h'] ?? area.h ?? 0);

      if (!w || !h) continue;

      // Konvertera centrum+storlek → övre vänstra hörnet (x, y, w, h)
      const regionX = cx - w / 2;
      const regionY = cy - h / 2;

      // Detektera källa baserat på metadata
      const source = detectFaceSource(region, raw);

      faces.push({
        name: name ?? null,
        regionX: Math.max(0, regionX),
        regionY: Math.max(0, regionY),
        regionW: w,
        regionH: h,
        source,
      });
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
