import { query } from '../db/pool.js';

// Lagra GPS som PostGIS GEOGRAPHY-punkt
export async function upsertAssetLocation(assetId, lat, lon) {
  await query(
    `UPDATE assets
     SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
     WHERE id = $1`,
    [assetId, lon, lat]  // PostGIS: (longitude, latitude)
  );
}

// Hämta kluster för kartvyn
export async function getMapClusters(bounds, zoom, userId, isAdmin) {
  const radiusMeters = zoomToRadius(zoom);
  const ownerFilter = isAdmin ? 'TRUE' : `owner_id = '${userId}'`;

  const { rows } = await query(
    `SELECT
       cluster_id,
       COUNT(*)::int                                                    AS count,
       ST_Y(ST_Centroid(ST_Collect(location::geometry)))               AS lat,
       ST_X(ST_Centroid(ST_Collect(location::geometry)))               AS lon,
       (array_agg(id            ORDER BY id))[1]                       AS sample_asset_id,
       (array_agg(thumb_small_path ORDER BY id))[1]                    AS sample_thumb
     FROM (
       SELECT
         id, location, thumb_small_path,
         ST_ClusterDBSCAN(location::geometry, eps := $5, minpoints := 1)
           OVER () AS cluster_id
       FROM assets
       WHERE status = 'active'
         AND location IS NOT NULL
         AND ${ownerFilter}
         AND location && ST_MakeEnvelope($1, $2, $3, $4, 4326)
     ) clustered
     GROUP BY cluster_id
     ORDER BY count DESC`,
    [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat, radiusMeters / 111_320]
  );

  return rows.map((r) => ({
    clusterId:     r.cluster_id,
    count:         r.count,
    lat:           r.lat,
    lon:           r.lon,
    sampleAssetId: r.sample_asset_id,
    sampleThumb:   r.sample_thumb,
  }));
}

// Hämta enskilda assets inom en bounding box (vid hög zoom)
export async function getAssetsInBounds(bounds, userId, isAdmin, limit = 200) {
  const ownerFilter = isAdmin ? 'TRUE' : `owner_id = '${userId}'`;
  const { rows } = await query(
    `SELECT id, file_name, thumb_small_path,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lon,
            taken_at
     FROM assets
     WHERE status = 'active'
       AND location IS NOT NULL
       AND ${ownerFilter}
       AND location && ST_MakeEnvelope($1, $2, $3, $4, 4326)
     ORDER BY taken_at DESC
     LIMIT $5`,
    [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat, limit]
  );
  return rows;
}

// Bounding box för alla foton med GPS — används för auto-centrering
export async function getMapExtent(userId, isAdmin) {
  const { rows } = await query(
    `SELECT
       ST_YMin(ST_Extent(location::geometry)) AS min_lat,
       ST_YMax(ST_Extent(location::geometry)) AS max_lat,
       ST_XMin(ST_Extent(location::geometry)) AS min_lon,
       ST_XMax(ST_Extent(location::geometry)) AS max_lon,
       COUNT(*)::int AS total
     FROM assets
     WHERE status = 'active'
       AND location IS NOT NULL
       AND ($2 OR owner_id = $1)`,
    [userId, isAdmin]
  );
  return rows[0];
}

// Foton inom en given radial area — används för kluster-panelen
export async function getClusterPhotos(lat, lon, radiusMeters, userId, isAdmin) {
  const { rows } = await query(
    `SELECT id, thumb_small_path, taken_at, file_name,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lon
     FROM assets
     WHERE status = 'active'
       AND location IS NOT NULL
       AND ($5 OR owner_id = $4)
       AND ST_DWithin(location, ST_MakePoint($2, $1)::geography, $3)
     ORDER BY taken_at DESC
     LIMIT 30`,
    [lat, lon, radiusMeters, userId, isAdmin]
  );
  return rows;
}

// Reverse geocoding via Nominatim (OpenStreetMap, ingen API-nyckel krävs)
export async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PhotoManager/1.0 (self-hosted)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();

    const addr = data.address ?? {};
    const parts = [
      addr.city ?? addr.town ?? addr.village ?? addr.county,
      addr.country,
    ].filter(Boolean);

    return parts.join(', ') || null;
  } catch {
    return null;
  }
}

function zoomToRadius(zoom) {
  const radii = {
    1: 5_000_000, 2: 2_000_000, 3: 1_000_000, 4: 500_000,
    5: 200_000,   6: 100_000,   7: 50_000,    8: 20_000,
    9: 10_000,    10: 5_000,    11: 2_000,    12: 1_000,
    13: 500,      14: 200,      15: 100,      16: 50,
  };
  return radii[Math.min(Math.max(zoom, 1), 16)] ?? 1000;
}
