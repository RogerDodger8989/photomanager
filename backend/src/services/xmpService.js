import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { query } from '../db/pool.js';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);

/**
 * Skriver XMP-fält till bildfilen med exiftool.
 * fields: { rating, title, description }
 */
export async function writeMetaToFile(filePath, fields = {}) {
  const args = [];
  if ('rating' in fields) {
    const v = (fields.rating != null && fields.rating >= 1 && fields.rating <= 5) ? String(fields.rating) : '';
    args.push(`-Rating=${v}`);
  }
  if ('title' in fields) {
    args.push(`-Title=${fields.title ?? ''}`);
    args.push(`-XMP:Title=${fields.title ?? ''}`);
  }
  if ('description' in fields) {
    args.push(`-Description=${fields.description ?? ''}`);
    args.push(`-XMP:Description=${fields.description ?? ''}`);
    args.push(`-IPTC:Caption-Abstract=${fields.description ?? ''}`);
  }
  if (!args.length) return;
  args.push('-overwrite_original', filePath);
  await execFileAsync('exiftool', args);
}

/**
 * Läser alla faces för en asset från DB och skriver dem som MWG XMP-regioner till filen.
 * Anropas efter create/delete/patch face.
 */
export async function syncFacesToFile(assetId) {
  try {
    const { rows: assetRows } = await query(
      'SELECT file_path FROM assets WHERE id = $1', [assetId]
    );
    if (!assetRows[0]?.file_path) return;

    const { rows: faces } = await query(
      `SELECT f.region_x, f.region_y, f.region_w, f.region_h, p.name AS person_name
       FROM faces f
       LEFT JOIN persons p ON p.id = f.person_id
       WHERE f.asset_id = $1`,
      [assetId]
    );

    const filePath = resolve(config.media.photosPath,assetRows[0].file_path);

    // Bygg MWG XMP-block (tom Bag om inga faces → rensar regioner i filen)
    const regionItems = faces.map(f => {
      const cx = (f.region_x + f.region_w / 2).toFixed(8);
      const cy = (f.region_y + f.region_h / 2).toFixed(8);
      const name = (f.person_name ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&/g, '&amp;');
      return `
              <rdf:li rdf:parseType="Resource">
                <mwg-rs:Name>${name}</mwg-rs:Name>
                <mwg-rs:Type>Face</mwg-rs:Type>
                <mwg-rs:Area rdf:parseType="Resource">
                  <stArea:x>${cx}</stArea:x>
                  <stArea:y>${cy}</stArea:y>
                  <stArea:w>${parseFloat(f.region_w.toFixed(8))}</stArea:w>
                  <stArea:h>${parseFloat(f.region_h.toFixed(8))}</stArea:h>
                  <stArea:unit>normalized</stArea:unit>
                </mwg-rs:Area>
              </rdf:li>`;
    }).join('');

    const bagContent = faces.length ? `${regionItems}\n            ` : '';
    const xmpContent = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:mwg-rs="http://www.metadataworkinggroup.com/schemas/regions/"
      xmlns:stArea="http://ns.adobe.com/xmp/sType/Area#">
      <mwg-rs:Regions>
        <rdf:Description>
          <mwg-rs:RegionList>
            <rdf:Bag>${bagContent}</rdf:Bag>
          </mwg-rs:RegionList>
        </rdf:Description>
      </mwg-rs:Regions>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

    const tmpFile = join(tmpdir(), `pm-faces-${Date.now()}.xmp`);
    try {
      await writeFile(tmpFile, xmpContent, 'utf8');
      await execFileAsync('exiftool', ['-overwrite_original', `-XMP<=${tmpFile}`, filePath]);
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  } catch (err) {
    console.warn(`syncFacesToFile misslyckades för ${assetId}:`, err.message);
  }
}
