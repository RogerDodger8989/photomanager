-- Mapp→tagg-regler: kopplar mappmönster till taggar automatiskt vid indexering
CREATE TABLE IF NOT EXISTS folder_tag_rules (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pattern     TEXT NOT NULL,
  tag_id      UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  match_type  TEXT NOT NULL DEFAULT 'folder_name',
              -- 'folder_name' | 'folder_name_contains' | 'folder_path_contains' | 'glob'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(pattern, tag_id)
);

-- Tagg-synonymer: alternativa namn som matchas vid sökning
CREATE TABLE IF NOT EXISTS tag_synonyms (
  id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tag_id  UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  synonym TEXT NOT NULL,
  UNIQUE(tag_id, synonym)
);

CREATE INDEX IF NOT EXISTS idx_tag_synonyms_tag_id ON tag_synonyms(tag_id);
CREATE INDEX IF NOT EXISTS idx_tag_synonyms_synonym_trgm ON tag_synonyms USING GIN(synonym gin_trgm_ops);
