-- Standardkonfiguration för vattenstämpel vid export
INSERT INTO system_settings (key, value)
VALUES ('watermark', '{
  "text":     "© PhotoManager",
  "position": "southeast",
  "opacity":  0.65
}'::jsonb)
ON CONFLICT (key) DO NOTHING;
