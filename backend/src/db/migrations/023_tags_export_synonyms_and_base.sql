-- Add export_synonyms flag to tags
ALTER TABLE tags ADD COLUMN IF NOT EXISTS export_synonyms BOOLEAN NOT NULL DEFAULT TRUE;

-- Ensure unique constraint on path exists before using ON CONFLICT
CREATE UNIQUE INDEX IF NOT EXISTS tags_path_unique ON tags(path);

-- Ensure base tag "Personer" exists
INSERT INTO tags (name, path, is_face_tag, export_only_leaf, show_lifespan, export_synonyms)
VALUES ('Personer', 'Personer', TRUE, TRUE, TRUE, TRUE)
ON CONFLICT (path) DO NOTHING;
