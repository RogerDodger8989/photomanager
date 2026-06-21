ALTER TABLE faces ADD COLUMN IF NOT EXISTS cluster_group_id UUID;
CREATE INDEX IF NOT EXISTS idx_faces_cluster_group_id ON faces(cluster_group_id) WHERE cluster_group_id IS NOT NULL;
