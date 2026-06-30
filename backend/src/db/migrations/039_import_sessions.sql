CREATE TABLE IF NOT EXISTS import_sessions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source      VARCHAR(50) NOT NULL DEFAULT 'watcher',
  source_path TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ,
  total       INT NOT NULL DEFAULT 0,
  imported    INT NOT NULL DEFAULT 0,
  skipped     INT NOT NULL DEFAULT 0,
  errors      INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_import_sessions_started ON import_sessions(started_at DESC);
