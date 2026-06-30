-- Lägg till source-kolumn på tags (manual | ai | xmp | folder_rule)
ALTER TABLE tags ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual';

-- Lägg till confidence och source på asset_tags
ALTER TABLE asset_tags ADD COLUMN IF NOT EXISTS confidence REAL;
ALTER TABLE asset_tags ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual';

-- Nytt job_type för objektdetektion
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'object_detection';

-- Index för att snabbt hitta AI-skapade asset_tags
CREATE INDEX IF NOT EXISTS idx_asset_tags_source ON asset_tags(source);
