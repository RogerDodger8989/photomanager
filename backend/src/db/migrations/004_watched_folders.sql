CREATE TABLE IF NOT EXISTS watched_folders (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  path       TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL DEFAULT '',
  enabled    BOOLEAN NOT NULL DEFAULT true,
  status     TEXT NOT NULL DEFAULT 'pending',  -- pending | watching | error
  error_msg  TEXT,
  added_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
