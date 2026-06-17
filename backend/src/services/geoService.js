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
// bounds = { minLat, maxLat, minLon, maxLon }, zoom avgör kluster-radien
export async function getMapClusters(bounds, zoom) {
  // Klusterradie i meter baserat på zoom-nivå
  const radiusMeters = zoomToRadius(zoom);

  const { rows } = await query(
    `SELECT
       cluster_id,
       COUNT(*)::int                                           AS count,
       ST_Y(ST_Centroid(ST_Collect(location::geometry)))      AS lat,
       ST_X(ST_Centroid(ST_Collect(location::geometry)))      AS lon,
       MIN(id)                                                AS sample_asset_id
     FROM (
       SELECT
         id,
         location,
         ST_ClusterDBSCAN(location::geometry, eps := $5, minpoints := 1)
           OVER () AS cluster_id
       FROM assets
       WHERE status = 'active'
         AND location IS NOT NULL
         AND location && ST_MakeEnvelope($1, $2, $3, $4, 4326)
     ) clustered
     GROUP BY cluster_id
     ORDER BY count DESC`,
    [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat, radiusMeters / 111_320]
  );

  return rows.map((r) => ({
    clusterId: r.cluster_id,
    count: r.count,
    lat: r.lat,
    lon: r.lon,
    sampleAssetId: r.sample_asset_id,
  }));
}

// Hämta enskilda assets inom en bounding box (vid hög zoom)
export async function getAssetsInBounds(bounds, limit = 200) {
  const { rows } = await query(
    `SELECT id, file_name, thumb_small_path,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lon,
            taken_at
     FROM assets
     WHERE status = 'active'
       AND location IS NOT NULL
       AND location && ST_MakeEnvelope($1, $2, $3, $4, 4326)
     ORDER BY taken_at DESC
     LIMIT $5`,
    [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat, limit]
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
  // Approximate cluster radius in meters per zoom level
  const radii = {
    1: 5_000_000, 2: 2_000_000, 3: 1_000_000, 4: 500_000,
    5: 200_000,   6: 100_000,   7: 50_000,    8: 20_000,
    9: 10_000,    10: 5_000,    11: 2_000,    12: 1_000,
    13: 500,      14: 200,      15: 100,      16: 50,
  };
  return radii[Math.min(Math.max(zoom, 1), 16)] ?? 1000;
}
