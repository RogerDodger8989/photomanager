-- Utöka tags-tabellen med hierarki, färg, ikon, persondata och exportflaggor

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS parent_id          UUID REFERENCES tags(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS path               TEXT,
  ADD COLUMN IF NOT EXISTS color              TEXT,
  ADD COLUMN IF NOT EXISTS icon_thumb         TEXT,
  ADD COLUMN IF NOT EXISTS is_face_tag        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS export_only_leaf   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS show_lifespan      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS birth_year         SMALLINT,
  ADD COLUMN IF NOT EXISTS death_year         SMALLINT,
  ADD COLUMN IF NOT EXISTS sort_order         INT NOT NULL DEFAULT 0;

-- Index för trädnavigering och sökvägsuppslag
CREATE INDEX IF NOT EXISTS idx_tags_parent_id  ON tags(parent_id);
CREATE INDEX IF NOT EXISTS idx_tags_path_trgm  ON tags USING GIN(path gin_trgm_ops);

-- Initialisera path till name för befintliga taggar (platt, ingen hierarki ännu)
UPDATE tags SET path = name WHERE path IS NULL;
