CREATE TABLE IF NOT EXISTS backup_configs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(255) NOT NULL,
  remote_name   VARCHAR(100) NOT NULL,
  rclone_config TEXT NOT NULL,
  dest_path     VARCHAR(500) NOT NULL DEFAULT 'PhotoManager',
  schedule      VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (schedule IN ('manual', 'daily', 'weekly')),
  enabled       BOOLEAN NOT NULL DEFAULT true,
  last_run      TIMESTAMPTZ,
  last_status   VARCHAR(20),
  last_log      TEXT,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
