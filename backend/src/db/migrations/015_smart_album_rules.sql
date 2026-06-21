ALTER TABLE albums ADD COLUMN IF NOT EXISTS rule_logic TEXT NOT NULL DEFAULT 'ALL';

CREATE TABLE IF NOT EXISTS smart_album_rules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id   UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  rule_type  TEXT NOT NULL,
  value      JSONB NOT NULL DEFAULT '{}',
  sort_order INT  NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS smart_album_rules_album_idx ON smart_album_rules (album_id);
