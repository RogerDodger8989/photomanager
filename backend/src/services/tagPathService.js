/**
 * Bygger och uppdaterar tag-sökvägar (path) enligt konventionerna:
 *  - Persontaggar: /Personer/<indexbokstav>/<Namn> [(födelseår–dödsår)]
 *  - Årstaggar:    /År/<decennium>-talet/<år>
 */

import { query } from '../db/pool.js';

/**
 * Returnerar path-sträng och indexbokstav för en persontagg.
 * name-fältet innehåller ALDRIG parenteser — bara rent namn.
 * Livstidsnotationen läggs till i path om birth_year/death_year är satta.
 *
 * @param {string} name - t.ex. "Anders Persson"
 * @param {number|null} birthYear
 * @param {number|null} deathYear
 * @returns {{ path: string, indexLetter: string }}
 */
export function buildPersonPath(name, birthYear, deathYear) {
  const words = name.trim().split(/\s+/);
  const lastWord = words[words.length - 1] ?? name;
  const indexLetter = lastWord[0]?.toUpperCase() ?? '#';

  let displayName = name;
  if (birthYear && deathYear) {
    displayName += ` (${birthYear}–${deathYear})`;
  } else if (birthYear) {
    displayName += ` (${birthYear}–)`;
  } else if (deathYear) {
    displayName += ` (–${deathYear})`;
  }

  return {
    path: `/Personer/${indexLetter}/${displayName}`,
    indexLetter,
  };
}

/**
 * Returnerar path-sträng för en årstagg.
 * 1989 → /År/1980-talet/1989
 *
 * @param {number|string} year
 * @returns {string}
 */
export function buildYearPath(year) {
  const y = Number(year);
  const decade = Math.floor(y / 10) * 10;
  return `/År/${decade}-talet/${y}`;
}

/**
 * Returnerar path för en vanlig tagg med given förälder.
 * Om ingen förälder → path = name.
 *
 * @param {string} name
 * @param {string|null} parentPath
 * @returns {string}
 */
export function buildPath(name, parentPath) {
  if (!parentPath) return name;
  return `${parentPath}/${name}`;
}

/**
 * Kontrollerar om en sträng ser ut som ett fyrsiffrigt år (1000–2999).
 * @param {string} name
 * @returns {boolean}
 */
export function looksLikeYear(name) {
  return /^[12]\d{3}$/.test(name.trim());
}

/**
 * Uppdaterar path-fältet rekursivt för en tagg och alla dess barn.
 * Anropas efter rename eller flytt av en nod i hierarkin.
 *
 * @param {string} tagId
 * @param {string} newPath
 */
export async function updatePathRecursive(tagId, newPath) {
  await query('UPDATE tags SET path = $1 WHERE id = $2', [newPath, tagId]);

  const { rows: children } = await query(
    'SELECT id, name FROM tags WHERE parent_id = $1',
    [tagId]
  );

  for (const child of children) {
    const childPath = `${newPath}/${child.name}`;
    await updatePathRecursive(child.id, childPath);
  }
}

/**
 * Hämtar hela trädet som en nestlad array.
 * Varje nod: { id, name, path, color, icon_thumb, is_face_tag, export_only_leaf,
 *              show_lifespan, birth_year, death_year, sort_order, asset_count, children[] }
 *
 * @param {string} userId
 * @param {boolean} isAdmin
 * @returns {Promise<Array>}
 */
export async function getTagTree(userId, isAdmin) {
  const ownerJoin = isAdmin
    ? ''
    : `AND at2.asset_id IN (SELECT id FROM assets WHERE owner_id = $1 AND status = 'active')`;

  const params = isAdmin ? [] : [userId];

  const { rows } = await query(
    `SELECT
       t.id, t.name, t.path, t.parent_id, t.color, t.icon_thumb,
       t.is_face_tag, t.export_only_leaf, t.show_lifespan,
       t.birth_year, t.death_year, t.custom_id, t.sort_order,
       COUNT(DISTINCT at2.asset_id)::int AS asset_count
     FROM tags t
     LEFT JOIN asset_tags at2 ON at2.tag_id = t.id ${ownerJoin}
     GROUP BY t.id
     ORDER BY t.sort_order, t.path`,
    params
  );

  return nestTagRows(rows);
}

/**
 * Omvandlar platt array med parent_id-relationer till nestlat träd.
 * @param {Array} rows
 * @returns {Array}
 */
function nestTagRows(rows) {
  /** @type {Map<string, any>} */
  const map = new Map();
  /** @type {Array} */
  const roots = [];

  for (const row of rows) {
    map.set(row.id, { ...row, children: [] });
  }

  for (const row of rows) {
    const node = map.get(row.id);
    if (row.parent_id && map.has(row.parent_id)) {
      map.get(row.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
