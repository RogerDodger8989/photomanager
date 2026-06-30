CREATE TABLE IF NOT EXISTS comments (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id   UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comments_asset ON comments(asset_id, created_at);

CREATE TABLE IF NOT EXISTS reactions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id   UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      VARCHAR(10) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(asset_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_reactions_asset ON reactions(asset_id);
