-- Kamerafält på assets för statistik-histograms
ALTER TABLE assets ADD COLUMN IF NOT EXISTS iso            INT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS aperture       NUMERIC(5,1);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS shutter_speed  VARCHAR(20);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS focal_length_mm INT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS lens_model     TEXT;

-- Index för snabb aggregering
CREATE INDEX IF NOT EXISTS idx_assets_iso       ON assets(iso)       WHERE iso IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_aperture  ON assets(aperture)  WHERE aperture IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_lens      ON assets(lens_model) WHERE lens_model IS NOT NULL;

-- Backfill från befintlig asset_metadata (EXIF tag-IDs som text)
-- ExposureTime (33434): decimalsekunder → "1/X" eller "Xs"
-- FNumber (33437): f-bländare
-- ISOSpeedRatings (34855): ISO-känslighet
-- FocalLength (37386): brännvidd i mm
-- LensModel (42036): objektiv-modell

UPDATE assets a SET
  iso = (
    SELECT CASE
      WHEN m.value ~ '^[0-9]+(\.[0-9]+)?$'
        THEN ROUND(m.value::NUMERIC)::INT
    END
    FROM asset_metadata m
    WHERE m.asset_id = a.id AND m.source = 'exif' AND m.key = '34855'
    LIMIT 1
  ),
  aperture = (
    SELECT CASE
      WHEN m.value ~ '^[0-9]+(\.[0-9]+)?$'
        THEN ROUND(m.value::NUMERIC, 1)
    END
    FROM asset_metadata m
    WHERE m.asset_id = a.id AND m.source = 'exif' AND m.key = '33437'
    LIMIT 1
  ),
  shutter_speed = (
    SELECT CASE
      WHEN m.value ~ '^[0-9]+(\.[0-9]+)?$' THEN
        CASE
          WHEN m.value::NUMERIC >= 1
            THEN CONCAT(ROUND(m.value::NUMERIC)::TEXT, 's')
          WHEN m.value::NUMERIC > 0
            THEN CONCAT('1/', ROUND(1.0 / m.value::NUMERIC)::TEXT)
        END
    END
    FROM asset_metadata m
    WHERE m.asset_id = a.id AND m.source = 'exif' AND m.key = '33434'
    LIMIT 1
  ),
  focal_length_mm = (
    SELECT CASE
      WHEN m.value ~ '^[0-9]+(\.[0-9]+)?$'
        THEN ROUND(m.value::NUMERIC)::INT
    END
    FROM asset_metadata m
    WHERE m.asset_id = a.id AND m.source = 'exif' AND m.key = '37386'
    LIMIT 1
  ),
  lens_model = (
    SELECT NULLIF(TRIM(BOTH '"' FROM TRIM(m.value)), '')
    FROM asset_metadata m
    WHERE m.asset_id = a.id AND m.source = 'exif' AND m.key = '42036'
    LIMIT 1
  )
WHERE EXISTS (
  SELECT 1 FROM asset_metadata m
  WHERE m.asset_id = a.id AND m.source = 'exif'
);
