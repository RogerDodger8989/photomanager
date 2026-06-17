import ffmpeg from 'fluent-ffmpeg';
import { mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { generateVideoThumbnail } from './thumbnailer.js';

// Maximala upplösningen vi transkoderar till (behåller proportioner)
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;

export async function transcodeVideo(assetId, sourceRelPath) {
  const sourcePath = join(config.media.photosPath, sourceRelPath);
  const outDir = join(config.media.transcodePath, assetId);
  const outPath = join(outDir, 'video.mp4');
  const screenshotPath = join(outDir, 'thumb.png');

  await mkdir(outDir, { recursive: true });

  // Uppdatera status
  await query(
    "UPDATE assets SET transcode_status = 'processing' WHERE id = $1",
    [assetId]
  );

  // Hämta video-metadata (duration, width, height) via ffprobe
  const probe = await probeVideo(sourcePath);

  try {
    // Steg 1: Extrahera screenshot vid 10% av filmen för thumbnail
    await extractScreenshot(sourcePath, screenshotPath, probe.duration);

    // Steg 2: Transkoda
    await runTranscode(sourcePath, outPath, probe);

    // Steg 3: Generera thumbnails från screenshot
    await generateVideoThumbnail(assetId, screenshotPath);

    // Städa bort screenshot (behövs inte längre)
    await unlink(screenshotPath).catch(() => {});

    const relTranscoded = `${assetId}/video.mp4`;

    // Uppdatera asset med transcode-sökväg, duration och dimensioner
    await query(
      `UPDATE assets
       SET transcode_status = 'done',
           transcoded_path  = $2,
           duration         = $3,
           width            = COALESCE(width, $4),
           height           = COALESCE(height, $5)
       WHERE id = $1`,
      [assetId, relTranscoded, probe.duration, probe.width, probe.height]
    );

    return relTranscoded;
  } catch (err) {
    await query(
      "UPDATE assets SET transcode_status = 'failed' WHERE id = $1",
      [assetId]
    );
    throw err;
  }
}

function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);

      const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
      resolve({
        duration: metadata.format.duration ?? 0,
        width:    videoStream?.width  ?? null,
        height:   videoStream?.height ?? null,
        codec:    videoStream?.codec_name ?? '',
        rotation: getRotation(videoStream),
      });
    });
  });
}

function getRotation(videoStream) {
  // Mobiltelefoner (iOS/Android) kodar ofta med en rotationstaggesida
  const rotate = videoStream?.tags?.rotate ?? videoStream?.side_data_list?.[0]?.rotation;
  return rotate ? parseInt(rotate) : 0;
}

function extractScreenshot(sourcePath, outputPath, duration) {
  return new Promise((resolve, reject) => {
    const seekTime = Math.max(0, duration * 0.1); // 10% in i filmen
    ffmpeg(sourcePath)
      .seekInput(seekTime)
      .frames(1)
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

function runTranscode(sourcePath, outPath, probe) {
  return new Promise((resolve, reject) => {
    // Beräkna skalning — bibehåll proportioner, max 1080p
    const scaleFilter = buildScaleFilter(probe.width, probe.height, probe.rotation);

    ffmpeg(sourcePath)
      // Video: H.264, CRF 23 (bra balans mellan kvalitet och filstorlek)
      .videoCodec('libx264')
      .addOption('-crf', '23')
      .addOption('-preset', 'fast')
      .addOption('-profile:v', 'high')
      .addOption('-level', '4.1')
      // Säkerställ jämna dimensioner (krävs av H.264)
      .addOption('-vf', scaleFilter)
      // Audio: AAC, stereo, 128kbps
      .audioCodec('aac')
      .audioBitrate('128k')
      .audioChannels(2)
      // Flytta moov-atom till början (snabbare streaming)
      .addOption('-movflags', '+faststart')
      // Mata ut som MP4
      .format('mp4')
      .output(outPath)
      .on('progress', (progress) => {
        if (progress.percent) {
          process.stdout.write(`\r  Transkoderar: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', () => {
        process.stdout.write('\n');
        resolve();
      })
      .on('error', (err) => {
        process.stdout.write('\n');
        reject(err);
      })
      .run();
  });
}

function buildScaleFilter(width, height, rotation) {
  // Om bilden är roterad 90/270 grader, byt bredd och höjd
  const isRotated = rotation === 90 || rotation === 270;
  const w = isRotated ? height : width;
  const h = isRotated ? width  : height;

  if (!w || !h) {
    // Okänd storlek — skala ner till max 1080p utan att förstorar
    return `scale='min(${MAX_WIDTH},iw)':'-2',scale='-2':'min(${MAX_HEIGHT},ih)'`;
  }

  if (w <= MAX_WIDTH && h <= MAX_HEIGHT) {
    // Redan inom gränsen — säkerställ bara jämna dimensioner
    return "scale=trunc(iw/2)*2:trunc(ih/2)*2";
  }

  // Skala ner proportionerligt
  const ratioW = MAX_WIDTH  / w;
  const ratioH = MAX_HEIGHT / h;
  const ratio  = Math.min(ratioW, ratioH);
  const newW   = Math.floor(w * ratio / 2) * 2; // jämnt tal
  const newH   = Math.floor(h * ratio / 2) * 2;

  return `scale=${newW}:${newH}`;
}
