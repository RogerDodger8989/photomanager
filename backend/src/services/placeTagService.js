import { query } from '../db/pool.js';

// Skapar/hittar en tag med given namn och parent. Returnerar id.
async function upsertTag(name, parentId, parentPath) {
  const path = parentPath ? `${parentPath}/${name}` : `/${name}`;

  const { rows } = await query(
    `INSERT INTO tags (name, path, parent_id, source)
     VALUES ($1, $2, $3, 'geo')
     ON CONFLICT (path) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name, path, parentId ?? null]
  );
  return rows[0].id;
}

// Skapar ortstagg-hierarki för ett asset baserat på Nominatim-adressdata.
// Bygger: /Platser/{country}/{state}/{city} (hoppar nivåer som saknas).
export async function ensurePlaceTagsForAsset(assetId, { country, state, city }) {
  if (!country && !state && !city) return;

  const levels = [
    { name: 'Platser', parent: null, path: '' },
  ];
  if (country) levels.push({ name: country });
  if (state && state !== country) levels.push({ name: state });
  if (city && city !== state && city !== country) levels.push({ name: city });

  if (levels.length <= 1) return;

  let parentId = null;
  let parentPath = '';
  let deepestId = null;

  for (const level of levels) {
    const tagId = await upsertTag(level.name, parentId, parentPath).catch(() => null);
    if (!tagId) return;
    parentPath = parentPath ? `${parentPath}/${level.name}` : `/${level.name}`;
    parentId = tagId;
    deepestId = tagId;
  }

  if (!deepestId) return;

  await query(
    `INSERT INTO asset_tags (asset_id, tag_id, source)
     VALUES ($1, $2, 'geo')
     ON CONFLICT (asset_id, tag_id) DO NOTHING`,
    [assetId, deepestId]
  ).catch(() => {});
}
