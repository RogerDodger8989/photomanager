ALTER TABLE watched_folders
  ADD COLUMN IF NOT EXISTS mount_type    TEXT NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS unc_path      TEXT,
  ADD COLUMN IF NOT EXISTS cifs_username TEXT,
  ADD COLUMN IF NOT EXISTS cifs_password TEXT;
