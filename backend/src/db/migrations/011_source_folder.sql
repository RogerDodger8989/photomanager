ALTER TABLE assets ADD COLUMN IF NOT EXISTS source_folder TEXT;

-- Restore paths corrupted by earlier mistake: re-add ../Bilder/ prefix
-- and set source_folder for all existing assets that came from /media/Bilder
UPDATE assets
SET file_path     = '../Bilder/' || file_path,
    source_folder = '/media/Bilder'
WHERE file_path NOT LIKE '../%'
  AND file_path NOT LIKE '/%';
