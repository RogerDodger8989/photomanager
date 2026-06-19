import { query } from '../db/pool.js';

// "För N år sedan idag" — bilder tagna samma dag tidigare år
export async function getOnThisDay(userId, isAdmin) {
  const today = new Date();
  const month = today.getMonth() + 1;
  const day   = today.getDate();

  const ownerFilter = isAdmin ? '' : `AND a.owner_id = '${userId}'`;

  const { rows } = await query(
    `SELECT
       EXTRACT(YEAR FROM a.taken_at)::int AS year,
       COUNT(*)::int AS count,
       json_agg(
         json_build_object(
           'id', a.id, 'thumb_small_path', a.thumb_small_path,
           'taken_at', a.taken_at, 'location_label', a.location_label
         ) ORDER BY RANDOM()
       ) AS samples
     FROM assets a
     WHERE a.status = 'active'
       AND a.taken_at IS NOT NULL
       AND EXTRACT(MONTH FROM a.taken_at) = $1
       AND EXTRACT(DAY   FROM a.taken_at) = $2
       AND EXTRACT(YEAR  FROM a.taken_at) < EXTRACT(YEAR FROM NOW())
       ${ownerFilter}
     GROUP BY year
     ORDER BY year DESC`,
    [month, day]
  );

  return rows.map((r) => ({
    year: r.year,
    yearsAgo: today.getFullYear() - r.year,
    count: r.count,
    samples: r.samples,
  }));
}

// Händelse-gruppering: bilder inom 24h + max 200km avstånd = en händelse
// Algoritm: tidsfönster-baserad clustering
export async function buildEvents(ownerId = null) {
  const ownerFilter = ownerId ? `AND a.owner_id = '${ownerId}'` : '';

  // Hämta alla aktiva bilder med tidpunkt och plats, sorterade kronologiskt
  const { rows: assets } = await query(
    `SELECT
       a.id, a.taken_at, a.location_label,
       ST_Y(a.location::geometry) AS lat,
       ST_X(a.location::geometry) AS lon
     FROM assets a
     WHERE a.status = 'active'
       AND a.taken_at IS NOT NULL
       ${ownerFilter}
     ORDER BY a.taken_at ASC`
  );

  if (assets.length === 0) return [];

  const MAX_GAP_HOURS = 24;
  const MAX_DIST_KM   = 200;

  const events = [];
  let current  = [assets[0]];

  for (let i = 1; i < assets.length; i++) {
    const prev = current[current.length - 1];
    const curr = assets[i];

    const gapHours = (new Date(curr.taken_at) - new Date(prev.taken_at)) / 3_600_000;
    const distKm   = haversineKm(prev.lat, prev.lon, curr.lat, curr.lon);

    // Ny händelse om tidsgap > 24h ELLER avstånd > 200km
    if (gapHours > MAX_GAP_HOURS || (prev.lat && curr.lat && distKm > MAX_DIST_KM)) {
      if (current.length >= 3) events.push(current); // Ignorera händelser med < 3 bilder
      current = [curr];
    } else {
      current.push(curr);
    }
  }
  if (current.length >= 3) events.push(current);

  // Spara händelser i DB (upsert baserat på tidsintervall)
  const saved = [];
  for (const group of events) {
    const dateFrom = group[0].taken_at;
    const dateTo   = group[group.length - 1].taken_at;
    const label    = mostCommonLabel(group);
    const sample   = group[Math.floor(group.length / 2)]; // mitt-bilden som cover

    // Kolla om händelsen redan finns
    const { rows: existing } = await query(
      `SELECT id FROM events
       WHERE date_from = $1 AND date_to = $2 AND ($3::uuid IS NULL OR owner_id = $3)`,
      [dateFrom, dateTo, ownerId]
    );

    let eventId;
    if (existing[0]) {
      eventId = existing[0].id;
    } else {
      const { rows } = await query(
        `INSERT INTO events (date_from, date_to, location_label, cover_asset_id, owner_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [dateFrom, dateTo, label, sample.id, ownerId]
      );
      eventId = rows[0].id;

      // Koppla bilder till händelsen
      for (const asset of group) {
        await query(
          'INSERT INTO event_assets (event_id, asset_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [eventId, asset.id]
        );
      }
    }

    saved.push({ eventId, dateFrom, dateTo, label, count: group.length, coverId: sample.id });
  }

  return saved;
}

// Hämta befintliga händelse-samlingar för explore-vyn
export async function getExploreCollections(userId, isAdmin) {
  const ownerFilter = isAdmin ? '' : `AND e.owner_id = '${userId}'`;

  const { rows } = await query(
    `SELECT
       e.id, e.name, e.date_from, e.date_to, e.location_label,
       e.cover_asset_id,
       a.thumb_large_path AS cover_thumb,
       COUNT(ea.asset_id)::int AS asset_count
     FROM events e
     LEFT JOIN event_assets ea ON ea.event_id = e.id
     LEFT JOIN assets a ON a.id = e.cover_asset_id
     WHERE 1=1 ${ownerFilter}
     GROUP BY e.id, a.thumb_large_path
     ORDER BY e.date_from DESC
     LIMIT 50`
  );

  return rows;
}

// Generera ett mänskligt läsbart eventnamn
export function generateEventName(locationLabel, dateFrom, dateTo) {
  const from = new Date(dateFrom);
  const to   = new Date(dateTo);
  const diffDays = Math.round((to - from) / 86_400_000);

  const monthName = from.toLocaleString('sv-SE', { month: 'long' });
  const year      = from.getFullYear();

  if (diffDays <= 1) return locationLabel ? `En dag i ${locationLabel}` : `${monthName} ${year}`;
  if (diffDays <= 3) return locationLabel ? `En helg i ${locationLabel}` : `Helgen ${monthName} ${year}`;
  return locationLabel ? `${monthName} i ${locationLabel}` : `${monthName} ${year}`;
}

// Haversine-formel: avstånd i km mellan två GPS-koordinater
function haversineKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lat2 == null) return 0;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) { return deg * (Math.PI / 180); }

function mostCommonLabel(group) {
  const freq = {};
  for (const a of group) {
    if (a.location_label) freq[a.location_label] = (freq[a.location_label] ?? 0) + 1;
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
