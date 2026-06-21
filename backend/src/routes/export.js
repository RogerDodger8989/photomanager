import { createReadStream, existsSync } from 'fs';
import { join, resolve, extname, basename } from 'path';
import archiver from 'archiver';
import { query } from '../db/pool.js';
import { config } from '../config.js';

function buildXmp(asset, tags, persons) {
  const subjects = tags.map((t) => `      <rdf:li>${escXml(t)}</rdf:li>`).join('\n');
  const creators = persons.map((p) => `      <rdf:li>${escXml(p)}</rdf:li>`).join('\n');

  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:exif="http://ns.adobe.com/exif/1.0/">
      <dc:title>${escXml(asset.file_name)}</dc:title>
      ${asset.location_label ? `<dc:description>${escXml(asset.location_label)}</dc:description>` : ''}
      ${asset.taken_at ? `<xmp:CreateDate>${asset.taken_at.toISOString()}</xmp:CreateDate>` : ''}
      ${subjects ? `<dc:subject>\n        <rdf:Bag>\n${subjects}\n        </rdf:Bag>\n      </dc:subject>` : ''}
      ${creators ? `<dc:creator>\n        <rdf:Seq>\n${creators}\n        </rdf:Seq>\n      </dc:creator>` : ''}
      ${asset.latitude != null ? `<exif:GPSLatitude>${asset.latitude}</exif:GPSLatitude>` : ''}
      ${asset.longitude != null ? `<exif:GPSLongitude>${asset.longitude}</exif:GPSLongitude>` : ''}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function escXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default async function exportRoutes(fastify) {

  // POST /api/export/zip
  // Body: { assetIds: [...] }  — max 500 bilder per export
  fastify.post('/api/export/zip', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { assetIds } = request.body ?? {};
    if (!Array.isArray(assetIds) || assetIds.length === 0) {
      return reply.status(400).send({ error: 'assetIds krävs' });
    }
    if (assetIds.length > 500) {
      return reply.status(400).send({ error: 'Max 500 bilder per export' });
    }

    // Hämta assets med taggar och personer
    const placeholders = assetIds.map((_, i) => `$${i + 1}`).join(',');
    const { rows: assets } = await query(`
      SELECT
        a.id, a.file_name, a.file_path, a.taken_at, a.location_label,
        ST_Y(a.location::geometry) AS latitude,
        ST_X(a.location::geometry) AS longitude,
        COALESCE(
          array_agg(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), '{}'
        ) AS tags,
        COALESCE(
          array_agg(DISTINCT p.name) FILTER (WHERE p.name IS NOT NULL), '{}'
        ) AS persons
      FROM assets a
      LEFT JOIN asset_tags at2 ON at2.asset_id = a.id
      LEFT JOIN tags t ON t.id = at2.tag_id
      LEFT JOIN faces f ON f.asset_id = a.id
      LEFT JOIN persons p ON p.id = f.person_id
      WHERE a.id = ANY(ARRAY[${placeholders}]::uuid[])
        AND a.status = 'active'
      GROUP BY a.id
    `, assetIds);

    if (assets.length === 0) {
      return reply.status(404).send({ error: 'Inga assets hittades' });
    }

    reply.raw.setHeader('Content-Type', 'application/zip');
    reply.raw.setHeader(
      'Content-Disposition',
      `attachment; filename="photomanager-export-${Date.now()}.zip"`
    );

    const archive = archiver('zip', { zlib: { level: 0 } }); // level 0 = ingen komprimering (bilder är redan komprimerade)
    archive.pipe(reply.raw);

    for (const asset of assets) {
      const filePath = resolve(config.media.photosPath,asset.file_path);
      if (!existsSync(filePath)) continue;

      // Originalfil
      archive.file(filePath, { name: asset.file_name });

      // XMP sidecar
      const xmp = buildXmp(asset, asset.tags, asset.persons);
      const xmpName = basename(asset.file_name, extname(asset.file_name)) + '.xmp';
      archive.append(xmp, { name: xmpName });
    }

    await archive.finalize();
  });

  // POST /api/export/album/:id — exportera alla bilder i ett album som ZIP
  fastify.post('/api/export/album/:id', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;

    const { rows: albumRows } = await query(
      'SELECT name FROM albums WHERE id = $1 AND owner_id = $2',
      [id, request.user.id]
    );
    if (!albumRows[0]) return reply.status(404).send({ error: 'Album hittades inte' });

    const { rows: assets } = await query(`
      SELECT
        a.id, a.file_name, a.file_path, a.taken_at, a.location_label,
        ST_Y(a.location::geometry) AS latitude,
        ST_X(a.location::geometry) AS longitude,
        COALESCE(array_agg(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), '{}') AS tags,
        COALESCE(array_agg(DISTINCT p.name) FILTER (WHERE p.name IS NOT NULL), '{}') AS persons
      FROM album_assets aa
      JOIN assets a ON a.id = aa.asset_id AND a.status = 'active'
      LEFT JOIN asset_tags at2 ON at2.asset_id = a.id
      LEFT JOIN tags t ON t.id = at2.tag_id
      LEFT JOIN faces f ON f.asset_id = a.id
      LEFT JOIN persons p ON p.id = f.person_id
      WHERE aa.album_id = $1
      GROUP BY a.id
      LIMIT 500
    `, [id]);

    if (!assets.length) return reply.status(404).send({ error: 'Albumet är tomt' });

    const safeName = albumRows[0].name.replace(/[^a-zA-Z0-9\-_åäöÅÄÖ ]/g, '').trim() || 'album';
    reply.raw.setHeader('Content-Type', 'application/zip');
    reply.raw.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);

    const archive = archiver('zip', { zlib: { level: 0 } });
    archive.pipe(reply.raw);

    for (const asset of assets) {
      const filePath = resolve(config.media.photosPath,asset.file_path);
      if (!existsSync(filePath)) continue;
      archive.file(filePath, { name: asset.file_name });
      const xmp = buildXmp(asset, asset.tags, asset.persons);
      const xmpName = basename(asset.file_name, extname(asset.file_name)) + '.xmp';
      archive.append(xmp, { name: xmpName });
    }

    await archive.finalize();
  });

}
