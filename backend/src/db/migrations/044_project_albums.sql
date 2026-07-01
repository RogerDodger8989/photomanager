ALTER TABLE albums ADD COLUMN IF NOT EXISTS album_type VARCHAR(20) NOT NULL DEFAULT 'manual';

CREATE TABLE IF NOT EXISTS project_chapters (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  album_id      UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  title         VARCHAR(255) NOT NULL DEFAULT '',
  description   TEXT,
  cover_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chapter_assets (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chapter_id   UUID NOT NULL REFERENCES project_chapters(id) ON DELETE CASCADE,
  asset_id     UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  sort_order   INT NOT NULL DEFAULT 0,
  UNIQUE(chapter_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_project_chapters_album ON project_chapters(album_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_chapter_assets_chapter ON chapter_assets(chapter_id, sort_order);
