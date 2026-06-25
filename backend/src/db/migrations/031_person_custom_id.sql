-- Eget ID-nummer per person (t.ex. familjekod eller löpnummer)
ALTER TABLE persons ADD COLUMN IF NOT EXISTS custom_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS persons_custom_id_unique ON persons (custom_id) WHERE custom_id IS NOT NULL;
