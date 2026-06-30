import { ExifTool } from 'exiftool-vendored';

const et = new ExifTool({ taskTimeoutMillis: 30_000 });

// Stäng exiftool-processen när Node avslutas
process.on('exit',    () => et.end());
process.on('SIGINT',  () => et.end());
process.on('SIGTERM', () => et.end());

// tags: { dateTimeOriginal?: string (ISO), gpsLat?: number, gpsLon?: number, model?: string }
export async function writeExif(filePath, tags = {}) {
  const payload = {};

  if (tags.dateTimeOriginal) {
    const dt = new Date(tags.dateTimeOriginal);
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = `${dt.getFullYear()}:${pad(dt.getMonth() + 1)}:${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
    payload.DateTimeOriginal = fmt;
    payload.CreateDate       = fmt;
    payload.ModifyDate       = fmt;
  }

  if (tags.gpsLat != null && tags.gpsLon != null) {
    const lat = parseFloat(tags.gpsLat);
    const lon = parseFloat(tags.gpsLon);
    payload.GPSLatitude     = Math.abs(lat);
    payload.GPSLatitudeRef  = lat >= 0 ? 'N' : 'S';
    payload.GPSLongitude    = Math.abs(lon);
    payload.GPSLongitudeRef = lon >= 0 ? 'E' : 'W';
  }

  if (tags.model != null) {
    payload.Model = tags.model;
  }

  if (Object.keys(payload).length === 0) return { ok: true };

  try {
    await et.write(filePath, payload, ['-overwrite_original']);
    return { ok: true };
  } catch (err) {
    console.error('ExifTool write error:', err.message);
    return { ok: false, reason: err.message };
  }
}
