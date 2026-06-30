CREATE TABLE IF NOT EXISTS system_settings (
  key        VARCHAR(100) PRIMARY KEY,
  value      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Standardkonfiguration för digital fotoram
INSERT INTO system_settings (key, value)
VALUES ('frame', '{
  "enabled":   false,
  "source":    "random",
  "album_id":  null,
  "interval":  10,
  "show_info": true,
  "token":     null
}'::jsonb)
ON CONFLICT (key) DO NOTHING;
